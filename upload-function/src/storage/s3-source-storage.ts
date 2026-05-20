import { Readable } from 'node:stream';

import {
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  NoSuchKey,
  NotFound,
  S3Client,
} from '@aws-sdk/client-s3';

import { UploadFunctionError } from '../errors.js';

export interface S3SourceObjectMetadata {
  readonly contentLength: number;
  readonly contentType: string | undefined;
}

export interface SourceStorage {
  getObjectMetadata(sourceUri: string): Promise<S3SourceObjectMetadata>;
  getObjectStream(sourceUri: string): Promise<Readable>;
  healthCheck(): Promise<void>;
}

export interface S3SourceStorageConfig {
  readonly endpoint: string;
  readonly region: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly allowedBuckets: readonly string[];
}

export const createS3SourceStorage = (config: S3SourceStorageConfig): SourceStorage => {
  const allowedBuckets = new Set(config.allowedBuckets);
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    forcePathStyle: true,
    maxAttempts: 1,
  });

  return {
    getObjectMetadata: async (sourceUri: string): Promise<S3SourceObjectMetadata> => {
      const source = parseSourceUri(sourceUri, allowedBuckets);

      try {
        const metadata = await retrySource(
          async () =>
            await client.send(new HeadObjectCommand({ Bucket: source.bucket, Key: source.key })),
        );

        if (metadata.ContentLength === undefined) {
          throw new UploadFunctionError({
            code: 'source_unavailable',
            status: 502,
            message: 'Source object did not report a content length.',
          });
        }

        return {
          contentLength: metadata.ContentLength,
          contentType: metadata.ContentType,
        };
      } catch (err: unknown) {
        throw mapSourceError(err, 'Unable to inspect source object.');
      }
    },

    getObjectStream: async (sourceUri: string): Promise<Readable> => {
      const source = parseSourceUri(sourceUri, allowedBuckets);

      try {
        const object = await retrySource(
          async () =>
            await client.send(new GetObjectCommand({ Bucket: source.bucket, Key: source.key })),
        );

        return readableFromS3Body(object.Body);
      } catch (err: unknown) {
        throw mapSourceError(err, 'Unable to read source object.');
      }
    },

    healthCheck: async (): Promise<void> => {
      try {
        await Promise.all(
          config.allowedBuckets.map(async (bucket) => {
            await retrySource(
              async () => await client.send(new HeadBucketCommand({ Bucket: bucket })),
            );
          }),
        );
      } catch (err: unknown) {
        throw mapSourceError(err, 'Configured S3 source is not reachable.');
      }
    },
  };
};

interface ParsedSourceUri {
  readonly bucket: string;
  readonly key: string;
}

const parseSourceUri = (
  sourceUri: string,
  allowedBuckets: ReadonlySet<string>,
): ParsedSourceUri => {
  if (!sourceUri.startsWith('s3://')) {
    throw new UploadFunctionError({
      code: 'invalid_source',
      status: 400,
      message: 'sourceUri must use the s3:// scheme.',
      details: { field: 'sourceUri' },
    });
  }

  let parsed: URL;
  try {
    parsed = new URL(sourceUri);
  } catch {
    throw new UploadFunctionError({
      code: 'invalid_source',
      status: 400,
      message: 'sourceUri is not a valid S3 URI.',
      details: { field: 'sourceUri' },
    });
  }

  const bucket = parsed.hostname;
  let key: string;
  try {
    key = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
  } catch {
    throw new UploadFunctionError({
      code: 'invalid_source',
      status: 400,
      message: 'sourceUri object key is not valid URL encoding.',
      details: { field: 'sourceUri' },
    });
  }

  if (bucket.length === 0 || key.length === 0) {
    throw new UploadFunctionError({
      code: 'invalid_source',
      status: 400,
      message: 'sourceUri must include a bucket and object key.',
      details: { field: 'sourceUri' },
    });
  }

  if (!allowedBuckets.has(bucket)) {
    throw new UploadFunctionError({
      code: 'invalid_source',
      status: 400,
      message: 'sourceUri bucket is not allowed.',
      details: { bucket },
    });
  }

  return { bucket, key };
};

const retrySource = async <Result>(operation: () => Promise<Result>): Promise<Result> => {
  try {
    return await operation();
  } catch (err: unknown) {
    if (!isRetryableSourceError(err)) {
      throw err;
    }
  }

  await sleep(500);
  return await operation();
};

const sleep = async (delayMs: number): Promise<void> =>
  await new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });

const readableFromS3Body = (body: unknown): Readable => {
  if (body instanceof Readable) {
    return body;
  }

  throw new UploadFunctionError({
    code: 'source_unavailable',
    status: 502,
    message: 'Source object body is not readable.',
  });
};

const mapSourceError = (err: unknown, message: string): UploadFunctionError => {
  if (err instanceof UploadFunctionError) {
    return err;
  }

  if (isSourceNotFoundError(err)) {
    return new UploadFunctionError({
      code: 'source_not_found',
      status: 404,
      message: 'Source object was not found.',
    });
  }

  const details = describeSourceError(err);
  return new UploadFunctionError({
    code: 'source_unavailable',
    status: 502,
    message,
    ...(details === undefined ? {} : { details }),
  });
};

const isSourceNotFoundError = (err: unknown): boolean => {
  if (err instanceof NoSuchKey || err instanceof NotFound) {
    return true;
  }

  if (typeof err !== 'object' || err === null) {
    return false;
  }

  if ('$metadata' in err && typeof err.$metadata === 'object' && err.$metadata !== null) {
    const meta = err.$metadata as { httpStatusCode?: unknown };
    if (meta.httpStatusCode === 404) {
      return true;
    }
  }

  if ('name' in err && (err.name === 'NoSuchKey' || err.name === 'NotFound')) {
    return true;
  }

  return false;
};

const isRetryableSourceError = (err: unknown): boolean => {
  if (typeof err !== 'object' || err === null || !('$metadata' in err)) {
    return true;
  }

  if (typeof err.$metadata !== 'object' || err.$metadata === null) {
    return true;
  }

  const meta = err.$metadata as { httpStatusCode?: unknown };
  if (typeof meta.httpStatusCode !== 'number') {
    return true;
  }

  return meta.httpStatusCode === 408 || meta.httpStatusCode === 429 || meta.httpStatusCode >= 500;
};

const describeSourceError = (err: unknown): Record<string, unknown> | undefined => {
  if (typeof err !== 'object' || err === null) {
    return undefined;
  }

  const description: Record<string, unknown> = {};

  if ('name' in err && typeof err.name === 'string') {
    description.sourceName = err.name;
  }

  if ('$metadata' in err && typeof err.$metadata === 'object' && err.$metadata !== null) {
    const meta = err.$metadata as { httpStatusCode?: unknown };
    if (typeof meta.httpStatusCode === 'number') {
      description.sourceStatusCode = meta.httpStatusCode;
    }
  }

  return Object.keys(description).length === 0 ? undefined : description;
};
