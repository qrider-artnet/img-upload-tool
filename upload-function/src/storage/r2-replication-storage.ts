import {
  DeleteObjectsCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

import { UploadFunctionError } from '../errors.js';
import type { ReplicationPutInput, ReplicationStorage } from './replication-storage.js';

/**
 * Configuration for the R2 replication adapter.
 */
export interface R2ReplicationStorageConfig {
  readonly accountId: string;
  readonly bucketName: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly maxRetries: number;
}

/**
 * Creates a Cloudflare R2-backed replication adapter using the S3 API.
 */
export const createR2ReplicationStorage = (
  config: R2ReplicationStorageConfig,
): ReplicationStorage => {
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    forcePathStyle: true,
    maxAttempts: 1,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });

  return {
    put: async (input: ReplicationPutInput): Promise<void> => {
      try {
        await retryTransient(config.maxRetries, async () => {
          const body = await input.bodyFactory();
          await client.send(
            new PutObjectCommand({
              Bucket: config.bucketName,
              Key: input.objectKey,
              Body: body,
              ...(input.cacheVersion === undefined
                ? {}
                : { Metadata: { 'cache-version': input.cacheVersion } }),
              ContentType: input.contentType,
              ContentLength: input.contentLength,
            }),
          );
        });
      } catch (err: unknown) {
        const details = describeR2Error(err);
        throw new UploadFunctionError({
          code: 'r2_unavailable',
          status: 503,
          message: 'Unable to replicate object to R2.',
          ...(details === undefined ? {} : { details }),
        });
      }
    },

    delete: async (objectKey: string): Promise<void> => {
      try {
        await retryTransient(config.maxRetries, async () => {
          await client.send(
            new DeleteObjectCommand({
              Bucket: config.bucketName,
              Key: objectKey,
            }),
          );
        });
      } catch (err: unknown) {
        if (isNotFoundError(err)) {
          return;
        }

        const details = describeR2Error(err);
        throw new UploadFunctionError({
          code: 'r2_unavailable',
          status: 503,
          message: 'Unable to delete object from R2.',
          ...(details === undefined ? {} : { details }),
        });
      }
    },

    deleteByPrefix: async (prefix: string): Promise<void> => {
      try {
        await retryTransient(config.maxRetries, async () => {
          await deleteAllObjectsByPrefix(client, config.bucketName, prefix);
        });
      } catch (err: unknown) {
        const details = describeR2Error(err);
        throw new UploadFunctionError({
          code: 'r2_unavailable',
          status: 503,
          message: 'Unable to delete objects from R2 by prefix.',
          ...(details === undefined ? {} : { details }),
        });
      }
    },

    healthCheck: async (): Promise<void> => {
      try {
        await retryTransient(config.maxRetries, async () => {
          await client.send(new HeadBucketCommand({ Bucket: config.bucketName }));
        });
      } catch (err: unknown) {
        const details = describeR2Error(err);
        throw new UploadFunctionError({
          code: 'r2_unavailable',
          status: 503,
          message: 'Configured R2 bucket is not reachable.',
          ...(details === undefined ? {} : { details }),
        });
      }
    },
  };
};

const deleteAllObjectsByPrefix = async (
  client: S3Client,
  bucketName: string,
  prefix: string,
): Promise<void> => {
  let continuationToken: string | undefined;

  do {
    const listInput =
      continuationToken === undefined
        ? { Bucket: bucketName, Prefix: prefix }
        : { Bucket: bucketName, Prefix: prefix, ContinuationToken: continuationToken };
    const listed = await client.send(new ListObjectsV2Command(listInput));
    const keys = (listed.Contents ?? [])
      .map((object) => object.Key)
      .filter((key): key is string => typeof key === 'string' && key.length > 0);

    if (keys.length > 0) {
      await client.send(
        new DeleteObjectsCommand({
          Bucket: bucketName,
          Delete: {
            Objects: keys.map((key) => ({ Key: key })),
            Quiet: true,
          },
        }),
      );
    }

    continuationToken = listed.IsTruncated === true ? listed.NextContinuationToken : undefined;
  } while (continuationToken !== undefined);
};

const RETRY_DELAYS_MS = [100, 400, 1600] as const;

const retryTransient = async (
  maxRetries: number,
  operation: () => Promise<void>,
): Promise<void> => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await operation();
      return;
    } catch (err: unknown) {
      if (attempt >= maxRetries || !isRetryableR2Error(err)) {
        throw err;
      }

      await sleep(retryDelayForAttempt(attempt));
    }
  }
};

const sleep = async (delayMs: number): Promise<void> =>
  await new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });

const retryDelayForAttempt = (attempt: number): number => {
  const delay = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
  return delay ?? 1600;
};

const isRetryableR2Error = (err: unknown): boolean => {
  if (typeof err !== 'object' || err === null) {
    return true;
  }

  if ('$metadata' in err && typeof err.$metadata === 'object' && err.$metadata !== null) {
    const meta = err.$metadata as { httpStatusCode?: unknown };
    if (typeof meta.httpStatusCode === 'number') {
      return (
        meta.httpStatusCode === 408 || meta.httpStatusCode === 429 || meta.httpStatusCode >= 500
      );
    }
  }

  return true;
};

const isNotFoundError = (err: unknown): boolean => {
  if (typeof err !== 'object' || err === null) {
    return false;
  }

  if ('$metadata' in err && typeof err.$metadata === 'object' && err.$metadata !== null) {
    const meta = err.$metadata as { httpStatusCode?: unknown };
    if (meta.httpStatusCode === 404) {
      return true;
    }
  }

  if ('name' in err && err.name === 'NoSuchKey') {
    return true;
  }

  return false;
};

const describeR2Error = (err: unknown): Record<string, unknown> | undefined => {
  if (typeof err !== 'object' || err === null) {
    return undefined;
  }

  const description: Record<string, unknown> = {};

  if ('name' in err && typeof err.name === 'string') {
    description.r2Name = err.name;
  }

  if ('$metadata' in err && typeof err.$metadata === 'object' && err.$metadata !== null) {
    const meta = err.$metadata as { httpStatusCode?: unknown };
    if (typeof meta.httpStatusCode === 'number') {
      description.r2StatusCode = meta.httpStatusCode;
    }
  }

  return Object.keys(description).length === 0 ? undefined : description;
};
