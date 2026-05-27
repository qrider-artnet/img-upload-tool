import { describe, expect, it } from 'vitest';

import { parseObjectKey } from './object-key.js';
import {
  createRedisUploadSessionStore,
  type RedisUploadSessionStore,
} from './upload-session-store-redis.js';
import {
  buildStagingObjectKey,
  createUploadId,
  type CreateUploadSessionInput,
} from './upload-session-store.js';
import type { UploadId } from './types.js';

const shouldRunRedisIntegration = process.env.RUN_REDIS_INTEGRATION === '1';
const describeRedisIntegration = shouldRunRedisIntegration ? describe : describe.skip;

describeRedisIntegration('RedisUploadSessionStore integration', () => {
  it('persists sessions in a real local Redis instance', async () => {
    const redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
    const keyPrefix = `upload-session:test:${createUploadId()}:`;
    const store = createRedisUploadSessionStore({ redisUrl, keyPrefix });
    let uploadIdToDelete: UploadId | undefined;

    try {
      const session = await store.create(
        sessionInput({ expiresAt: new Date(Date.now() + 15 * 60 * 1000) }),
      );
      uploadIdToDelete = session.uploadId;

      await expect(store.get(session.uploadId, new Date())).resolves.toEqual(session);
    } finally {
      await cleanupSession(store, uploadIdToDelete);
      store.disconnect();
    }
  });
});

const sessionInput = (
  overrides: Partial<CreateUploadSessionInput> = {},
): CreateUploadSessionInput => {
  const uploadId = overrides.uploadId ?? createUploadId();
  const objectKey =
    overrides.objectKey ?? parseObjectKey('lot_images/425939177/20260310/638775/195.jpg');

  return {
    auctionHouseId: '425939177',
    contentLength: 123,
    contentType: 'image/jpeg',
    expiresAt: new Date('2026-05-08T10:15:00.000Z'),
    objectKey,
    productId: 'artnet-auctions',
    stagingObjectKey: buildStagingObjectKey(uploadId, objectKey),
    uploadId,
    ...overrides,
  };
};

const cleanupSession = async (
  store: RedisUploadSessionStore,
  uploadId: UploadId | undefined,
): Promise<void> => {
  if (uploadId === undefined) {
    return;
  }

  try {
    await store.delete(uploadId);
  } catch {
    // Cleanup is best effort; the test prefix and Redis TTL keep leftovers bounded.
  }
};
