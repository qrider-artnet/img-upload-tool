import { beforeEach, describe, expect, it, vi } from 'vitest';

import { parseObjectKey } from '../object-key.js';
import { buildTombstonePath } from './upload-storage.js';
import { createGcsUploadStorage } from './gcs-storage.js';

interface MockFile {
  readonly delete: ReturnType<typeof vi.fn<() => Promise<void>>>;
  readonly exists: ReturnType<typeof vi.fn<() => Promise<[boolean]>>>;
  readonly save: ReturnType<
    typeof vi.fn<
      (
        data: string,
        options: { readonly contentType: string; readonly resumable: boolean },
      ) => Promise<void>
    >
  >;
}

const gcsMock = vi.hoisted(() => {
  const files = new Map<string, MockFile>();

  const getFile = (path: string): MockFile => {
    const existing = files.get(path);
    if (existing !== undefined) {
      return existing;
    }

    const file: MockFile = {
      delete: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      exists: vi.fn<() => Promise<[boolean]>>().mockResolvedValue([false]),
      save: vi
        .fn<
          (
            data: string,
            options: { readonly contentType: string; readonly resumable: boolean },
          ) => Promise<void>
        >()
        .mockResolvedValue(undefined),
    };
    files.set(path, file);
    return file;
  };

  const bucket = {
    exists: vi.fn<() => Promise<[boolean]>>().mockResolvedValue([true]),
    file: vi.fn<(path: string) => MockFile>(getFile),
  };

  return {
    bucket,
    files,
    getFile,
    Storage: vi.fn(function MockStorage(this: { bucket: (bucketName: string) => typeof bucket }) {
      this.bucket = vi.fn<(bucketName: string) => typeof bucket>(() => bucket);
    }),
  };
});

vi.mock('@google-cloud/storage', () => ({ Storage: gcsMock.Storage }));

const objectKey = parseObjectKey('lot_images/425939177/20260310/638775/195.jpg');

describe('GcsUploadStorage delete and tombstones', () => {
  beforeEach(() => {
    gcsMock.files.clear();
    gcsMock.bucket.exists.mockClear();
    gcsMock.bucket.file.mockClear();
    gcsMock.Storage.mockClear();
  });

  it('retries transient GCS delete failures', async () => {
    const storage = createGcsUploadStorage({ bucketName: 'mock-bucket' });
    const file = gcsMock.getFile(objectKey);
    file.delete.mockRejectedValueOnce({ code: 503 }).mockResolvedValueOnce(undefined);

    await storage.deleteObject(objectKey);

    expect(file.delete).toHaveBeenCalledTimes(2);
  });

  it('treats missing GCS objects as successful deletes without retrying', async () => {
    const storage = createGcsUploadStorage({ bucketName: 'mock-bucket' });
    const file = gcsMock.getFile(objectKey);
    file.delete.mockRejectedValueOnce({ code: 404 });

    await storage.deleteObject(objectKey);

    expect(file.delete).toHaveBeenCalledOnce();
  });

  it('retries transient tombstone write failures', async () => {
    const storage = createGcsUploadStorage({ bucketName: 'mock-bucket' });
    const file = gcsMock.getFile(buildTombstonePath(objectKey));
    file.save.mockRejectedValueOnce({ code: 503 }).mockResolvedValueOnce(undefined);

    await storage.writeTombstone(objectKey, {
      objectKey,
      deletedAt: '2026-05-15T12:34:56.789Z',
      deletedBy: '425939177',
      requestId: '01JF8T7P2C9X4MWXYZ',
    });

    expect(file.save).toHaveBeenCalledTimes(2);
    expect(file.save).toHaveBeenLastCalledWith(
      JSON.stringify({
        objectKey,
        deletedAt: '2026-05-15T12:34:56.789Z',
        deletedBy: '425939177',
        requestId: '01JF8T7P2C9X4MWXYZ',
      }),
      { contentType: 'application/json', resumable: false },
    );
  });

  it('exposes the tombstone existence contract reconciliation must use before backfill', async () => {
    const storage = createGcsUploadStorage({ bucketName: 'mock-bucket' });
    const file = gcsMock.getFile(buildTombstonePath(objectKey));
    file.exists.mockResolvedValueOnce([true]);

    const shouldBackfillMissingR2Object = !(await storage.tombstoneExists(objectKey));

    expect(shouldBackfillMissingR2Object).toBe(false);
    expect(gcsMock.bucket.file).toHaveBeenCalledWith(buildTombstonePath(objectKey));
  });
});
