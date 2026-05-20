import { describe, expect, it } from 'vitest';

import { UploadFunctionError } from './errors.js';
import { parseObjectKey } from './object-key.js';
import { RedisUploadSessionStore, type RedisSessionClient } from './redis-upload-session-store.js';
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

describe('RedisUploadSessionStore', () => {
  it('stores sessions with TTL and retrieves them across store instances', async () => {
    const client = new FakeRedisSessionClient();
    const firstStore = new RedisUploadSessionStore({ client });
    const secondStore = new RedisUploadSessionStore({ client });

    const session = await firstStore.create(
      sessionInput({ expiresAt: new Date('2050-01-01T00:00:00.000Z') }),
    );

    await expect(
      secondStore.get(session.uploadId, new Date('2049-12-31T23:59:59.000Z')),
    ).resolves.toEqual(session);
    expect(client.setCalls[0]).toMatchObject({
      key: `upload-session:${session.uploadId}`,
      nx: true,
    });
    expect(client.setCalls[0]?.ex).toBeGreaterThan(0);
  });

  it('deletes expired Redis sessions on read', async () => {
    const client = new FakeRedisSessionClient();
    const store = new RedisUploadSessionStore({ client });
    const session = await store.create(
      sessionInput({ expiresAt: new Date('2026-05-08T10:15:00.000Z') }),
    );

    await expect(store.get(session.uploadId, new Date('2026-05-08T10:15:00.000Z'))).resolves.toBe(
      undefined,
    );
    await expect(store.get(session.uploadId, new Date('2026-05-08T10:14:59.000Z'))).resolves.toBe(
      undefined,
    );
  });

  it('maps Redis operation failures to session_store_unavailable', async () => {
    const client = new FakeRedisSessionClient();
    client.operationError = Object.assign(new Error('redis down'), {
      code: 'ECONNREFUSED',
    });
    const store = new RedisUploadSessionStore({ client });

    await expect(store.create(sessionInput())).rejects.toMatchObject({
      code: 'session_store_unavailable',
      status: 503,
      details: { redisName: 'Error', redisCode: 'ECONNREFUSED' },
    });
  });

  it('reports Redis health with ping', async () => {
    const client = new FakeRedisSessionClient();
    const store = new RedisUploadSessionStore({ client });

    await expect(store.healthCheck()).resolves.toBeUndefined();
    expect(client.pingCount).toBe(1);
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

class FakeRedisSessionClient implements RedisSessionClient {
  public isOpen = false;

  public readonly values = new Map<string, string>();

  public readonly setCalls: Array<{
    readonly key: string;
    readonly value: string;
    readonly ex: number;
    readonly nx: boolean;
  }> = [];

  public operationError: Error | undefined = undefined;

  public pingCount = 0;

  public connect(): Promise<unknown> {
    this.isOpen = true;
    return Promise.resolve(undefined);
  }

  public del(key: string): Promise<number> {
    if (this.operationError !== undefined) {
      return Promise.reject(this.operationError);
    }
    const existed = this.values.delete(key);
    return Promise.resolve(existed ? 1 : 0);
  }

  public get(key: string): Promise<string | null> {
    if (this.operationError !== undefined) {
      return Promise.reject(this.operationError);
    }
    return Promise.resolve(this.values.get(key) ?? null);
  }

  public on(): unknown {
    return this;
  }

  public ping(): Promise<string> {
    if (this.operationError !== undefined) {
      return Promise.reject(this.operationError);
    }
    this.pingCount += 1;
    return Promise.resolve('PONG');
  }

  public set(
    key: string,
    value: string,
    options: { readonly EX: number; readonly NX: true },
  ): Promise<string | null> {
    if (this.operationError !== undefined) {
      return Promise.reject(this.operationError);
    }
    this.setCalls.push({ key, value, ex: options.EX, nx: options.NX });
    if (this.values.has(key)) {
      return Promise.resolve(null);
    }
    this.values.set(key, value);
    return Promise.resolve('OK');
  }
}
