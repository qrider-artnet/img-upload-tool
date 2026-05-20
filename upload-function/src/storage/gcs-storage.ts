import type { Readable } from 'node:stream';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createHash } from 'node:crypto';

import { Storage } from '@google-cloud/storage';
import { z } from 'zod';

import { UploadFunctionError } from '../errors.js';
import type { Tombstone } from '../schemas.js';
import type { ObjectKey } from '../types.js';
import {
  buildTombstonePath,
  type ObjectMetadata,
  type SignedUploadUrl,
  type SignedUploadUrlInput,
  type UploadStorage,
  type WriteObjectInput,
  type WriteObjectResult,
} from './upload-storage.js';

const GcsMetadataSchema = z
  .object({
    contentType: z.string().optional(),
    size: z.union([z.string(), z.number()]),
    updated: z.string().optional(),
  })
  .passthrough();

/**
 * Configuration for the GCS storage adapter.
 */
export interface GcsUploadStorageConfig {
  readonly bucketName: string;
}

/**
 * Creates a GCS-backed storage adapter for presigned uploads.
 */
export const createGcsUploadStorage = (config: GcsUploadStorageConfig): UploadStorage => {
  const storage = new Storage();
  const bucket = storage.bucket(config.bucketName);

  return {
    createSignedUploadUrl: async (input: SignedUploadUrlInput): Promise<SignedUploadUrl> => {
      const file = bucket.file(input.objectKey);
      const contentLengthRange = `${input.contentLength},${input.contentLength}`;
      const [uploadUrl] = await file.getSignedUrl({
        action: 'write',
        contentType: input.contentType,
        expires: input.expiresAt,
        version: 'v4',
        extensionHeaders: {
          'x-goog-content-length-range': contentLengthRange,
        },
      });

      return { uploadUrl, contentLengthRange };
    },

    deleteObject: async (objectKey: ObjectKey): Promise<void> => {
      try {
        await retryTransient(async () => {
          await bucket.file(objectKey).delete();
        });
      } catch (err: unknown) {
        if (isNotFoundError(err)) {
          return;
        }

        const details = describeStorageError(err);
        throw new UploadFunctionError({
          code: 'storage_unavailable',
          status: 503,
          message: 'Unable to delete rejected GCS object.',
          ...(details === undefined ? {} : { details }),
        });
      }
    },

    getObjectMetadata: async (objectKey: ObjectKey): Promise<ObjectMetadata | undefined> => {
      try {
        const [metadata] = await bucket.file(objectKey).getMetadata();
        const parsed = GcsMetadataSchema.safeParse(metadata);

        if (!parsed.success) {
          throw new UploadFunctionError({
            code: 'storage_unavailable',
            status: 503,
            message: 'GCS returned unreadable object metadata.',
            details: { issues: parsed.error.issues },
          });
        }

        const size =
          typeof parsed.data.size === 'number'
            ? parsed.data.size
            : Number.parseInt(parsed.data.size, 10);

        if (!Number.isFinite(size)) {
          throw new UploadFunctionError({
            code: 'storage_unavailable',
            status: 503,
            message: 'GCS object metadata size is invalid.',
            details: { rawSize: parsed.data.size },
          });
        }

        return {
          contentType: parsed.data.contentType,
          size,
          updatedAt: parsed.data.updated === undefined ? undefined : new Date(parsed.data.updated),
        };
      } catch (err: unknown) {
        if (err instanceof UploadFunctionError) {
          throw err;
        }

        if (isNotFoundError(err)) {
          return undefined;
        }

        const details = describeStorageError(err);
        throw new UploadFunctionError({
          code: 'storage_unavailable',
          status: 503,
          message: 'Unable to read GCS object metadata.',
          ...(details === undefined ? {} : { details }),
        });
      }
    },

    getObjectStream: (objectKey: ObjectKey): Promise<Readable> => {
      const stream = bucket.file(objectKey).createReadStream();
      return Promise.resolve(stream);
    },

    healthCheck: async (): Promise<void> => {
      const [exists] = await bucket.exists();

      if (!exists) {
        throw new UploadFunctionError({
          code: 'storage_unavailable',
          status: 503,
          message: 'Configured GCS bucket is not reachable.',
        });
      }
    },

    tombstoneExists: async (objectKey: ObjectKey): Promise<boolean> => {
      try {
        const [exists] = await bucket.file(buildTombstonePath(objectKey)).exists();
        return exists;
      } catch (err: unknown) {
        const details = describeStorageError(err);
        throw new UploadFunctionError({
          code: 'storage_unavailable',
          status: 503,
          message: 'Unable to check tombstone existence.',
          ...(details === undefined ? {} : { details }),
        });
      }
    },

    writeObject: async (input: WriteObjectInput): Promise<WriteObjectResult> => {
      try {
        return await retryTransientWithResult(async () => {
          const hash = createHash('sha256');
          let bytesWritten = 0;
          const body = await input.bodyFactory();
          const hashStream = new Transform({
            transform(chunk: Buffer | string, _encoding, callback) {
              const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
              bytesWritten += bytes.byteLength;
              hash.update(bytes);
              callback(null, chunk);
            },
          });

          await pipeline(
            body,
            hashStream,
            bucket.file(input.objectKey).createWriteStream({
              contentType: input.contentType,
              resumable: false,
              metadata: {
                contentType: input.contentType,
              },
            }),
          );

          if (bytesWritten !== input.contentLength) {
            throw new UploadFunctionError({
              code: 'source_unavailable',
              status: 502,
              message: 'Source object stream ended before the expected content length.',
              details: { expected: input.contentLength, actual: bytesWritten },
            });
          }

          return {
            size: bytesWritten,
            sha256: hash.digest('hex'),
            uploadedAt: new Date(),
          };
        });
      } catch (err: unknown) {
        if (err instanceof UploadFunctionError) {
          throw err;
        }

        const details = describeStorageError(err);
        throw new UploadFunctionError({
          code: 'storage_unavailable',
          status: 503,
          message: 'Unable to write object to GCS.',
          ...(details === undefined ? {} : { details }),
        });
      }
    },

    writeTombstone: async (objectKey: ObjectKey, tombstone: Tombstone): Promise<void> => {
      try {
        await retryTransient(async () => {
          await bucket.file(buildTombstonePath(objectKey)).save(JSON.stringify(tombstone), {
            contentType: 'application/json',
            resumable: false,
          });
        });
      } catch (err: unknown) {
        const details = describeStorageError(err);
        throw new UploadFunctionError({
          code: 'tombstone_write_failed',
          status: 503,
          message: 'Unable to write tombstone for delete.',
          ...(details === undefined ? {} : { details }),
        });
      }
    },
  };
};

const MAX_TRANSIENT_RETRIES = 3;
const RETRY_DELAYS_MS = [100, 400, 1600] as const;

const retryTransient = async (operation: () => Promise<void>): Promise<void> => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await operation();
      return;
    } catch (err: unknown) {
      if (attempt >= MAX_TRANSIENT_RETRIES || !isRetryableStorageError(err)) {
        throw err;
      }

      await sleep(retryDelayForAttempt(attempt));
    }
  }
};

const retryTransientWithResult = async <Result>(
  operation: () => Promise<Result>,
): Promise<Result> => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (err: unknown) {
      if (err instanceof UploadFunctionError || attempt >= MAX_TRANSIENT_RETRIES) {
        throw err;
      }

      if (!isRetryableStorageError(err)) {
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

const isRetryableStorageError = (err: unknown): boolean => {
  if (typeof err !== 'object' || err === null) {
    return true;
  }

  if ('code' in err) {
    const code = normalizeStorageCode(err.code);
    if (code !== undefined) {
      return code === 408 || code === 429 || code >= 500;
    }
  }

  return true;
};

const isNotFoundError = (err: unknown): boolean => {
  if (typeof err !== 'object' || err === null) {
    return false;
  }

  if (!('code' in err)) {
    return false;
  }

  return normalizeStorageCode(err.code) === 404;
};

const normalizeStorageCode = (code: unknown): number | undefined => {
  if (typeof code === 'number') {
    return code;
  }

  if (typeof code === 'string') {
    const parsed = Number.parseInt(code, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
};

/**
 * Captures the underlying storage error's identifying fields so the API
 * envelope and operator logs retain the original cause.
 */
const describeStorageError = (err: unknown): Record<string, unknown> | undefined => {
  if (typeof err !== 'object' || err === null) {
    return undefined;
  }

  const description: Record<string, unknown> = {};

  if ('code' in err) {
    description.storageCode = err.code;
  }

  if ('name' in err && typeof err.name === 'string') {
    description.storageName = err.name;
  }

  return Object.keys(description).length === 0 ? undefined : description;
};
