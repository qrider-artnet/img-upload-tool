import { describe, expect, it } from 'vitest';

import { UploadFunctionError } from './errors.js';
import { parseObjectKey } from './object-key.js';
import {
  type CreateUploadSessionInput,
  InMemoryUploadSessionStore,
} from './upload-session-store.js';

describe('InMemoryUploadSessionStore', () => {
  it('stores and retrieves a live session', async () => {
    const store = new InMemoryUploadSessionStore();
    const session = await store.create({
      auctionHouseId: '425939177',
      contentLength: 123,
      contentType: 'image/jpeg',
      expiresAt: new Date('2026-05-08T10:15:00.000Z'),
      objectKey: parseObjectKey('lot_images/425939177/20260310/638775/195.jpg'),
      productId: 'artnet-auctions',
    });

    await expect(
      store.get(session.uploadId, new Date('2026-05-08T10:14:59.000Z')),
    ).resolves.toEqual(session);
  });

  it('expires stale sessions on read', async () => {
    const store = new InMemoryUploadSessionStore();
    const session = await store.create({
      auctionHouseId: '425939177',
      contentLength: 123,
      contentType: 'image/jpeg',
      expiresAt: new Date('2026-05-08T10:15:00.000Z'),
      objectKey: parseObjectKey('lot_images/425939177/20260310/638775/195.jpg'),
      productId: 'artnet-auctions',
    });

    await expect(store.get(session.uploadId, new Date('2026-05-08T10:15:00.000Z'))).resolves.toBe(
      undefined,
    );
    await expect(store.get(session.uploadId, new Date('2026-05-08T10:14:59.000Z'))).resolves.toBe(
      undefined,
    );
  });

  it('rejects new sessions once the cap is reached and only expired sessions remain prunable', async () => {
    const store = new InMemoryUploadSessionStore({ maxSessions: 2 });
    await store.create(sessionInput({ expiresAt: new Date('2050-01-01T00:00:00.000Z') }));
    await store.create(sessionInput({ expiresAt: new Date('2050-01-01T00:00:00.000Z') }));

    await expect(store.create(sessionInput())).rejects.toMatchObject({
      code: 'too_many_sessions',
      status: 503,
    });
    await expect(store.create(sessionInput())).rejects.toBeInstanceOf(UploadFunctionError);
  });

  it('reclaims capacity by sweeping expired sessions on create()', async () => {
    const store = new InMemoryUploadSessionStore({ maxSessions: 2 });
    await store.create(sessionInput({ expiresAt: new Date('2026-05-08T10:00:00.000Z') }));
    await store.create(sessionInput({ expiresAt: new Date('2050-01-01T00:00:00.000Z') }));

    await expect(
      store.create(sessionInput({ expiresAt: new Date('2050-01-01T00:00:00.000Z') })),
    ).resolves.toMatchObject({ auctionHouseId: '425939177' });
  });
});

const sessionInput = (
  overrides: Partial<CreateUploadSessionInput> = {},
): CreateUploadSessionInput => ({
  auctionHouseId: '425939177',
  contentLength: 123,
  contentType: 'image/jpeg',
  expiresAt: new Date('2026-05-08T10:15:00.000Z'),
  objectKey: parseObjectKey('lot_images/425939177/20260310/638775/195.jpg'),
  productId: 'artnet-auctions',
  ...overrides,
});
