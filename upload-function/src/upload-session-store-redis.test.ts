import RedisMock from 'ioredis-mock';
import { describe, expect, it } from 'vitest';

import { parseObjectKey } from './object-key.js';
import type { RedisSessionClient } from './upload-session-store-redis.js';
import { RedisUploadSessionStore } from './upload-session-store-redis.js';
import {
  buildStagingObjectKey,
  createUploadId,
  parseUploadId,
  type CreateUploadSessionInput,
} from './upload-session-store.js';

describe('RedisUploadSessionStore', () => {
  it('stores sessions with TTL and retrieves them across store instances', async () => {
    const client = new MockRedisSessionClient();
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
      secondsMode: 'EX',
      condition: 'NX',
    });
    expect(client.setCalls[0]?.seconds).toBeGreaterThan(0);
  });

  it('deletes expired Redis sessions on read', async () => {
    const client = new MockRedisSessionClient();
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

  it('deletes sessions explicitly', async () => {
    const client = new MockRedisSessionClient();
    const store = new RedisUploadSessionStore({ client });
    const session = await store.create(
      sessionInput({ expiresAt: new Date('2050-01-01T00:00:00.000Z') }),
    );

    await store.delete(session.uploadId);

    await expect(store.get(session.uploadId, new Date('2049-12-31T23:59:59.000Z'))).resolves.toBe(
      undefined,
    );
  });

  it('maps Redis connection failures to session_store_unavailable', async () => {
    const client = new FailingRedisSessionClient(
      Object.assign(new Error('redis down'), { code: 'ECONNREFUSED' }),
    );
    const store = new RedisUploadSessionStore({ client });

    await expect(store.create(sessionInput())).rejects.toMatchObject({
      code: 'session_store_unavailable',
      status: 503,
      details: { redisName: 'Error', redisCode: 'ECONNREFUSED' },
    });
  });

  it('rejects invalid Redis JSON session records', async () => {
    const client = new MockRedisSessionClient();
    const store = new RedisUploadSessionStore({ client });
    const uploadId = parseUploadId('01ARZ3NDEKTSV4RRFFQ69G5FAV');
    await client.rawSet(`upload-session:${uploadId}`, 'not-json');

    await expect(store.get(uploadId, new Date('2026-05-08T10:14:59.000Z'))).rejects.toMatchObject({
      code: 'session_store_unavailable',
      status: 503,
    });
  });

  it('rejects Redis records that do not match the session schema', async () => {
    const client = new MockRedisSessionClient();
    const store = new RedisUploadSessionStore({ client });
    const uploadId = parseUploadId('01ARZ3NDEKTSV4RRFFQ69G5FAV');
    await client.rawSet(`upload-session:${uploadId}`, JSON.stringify({ uploadId }));

    await expect(store.get(uploadId, new Date('2026-05-08T10:14:59.000Z'))).rejects.toMatchObject({
      code: 'session_store_unavailable',
      status: 503,
    });
  });

  it('reports Redis health with ping', async () => {
    const client = new MockRedisSessionClient();
    const store = new RedisUploadSessionStore({ client });

    await expect(store.healthCheck()).resolves.toBeUndefined();
    expect(client.pingCount).toBe(1);
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

class MockRedisSessionClient implements RedisSessionClient {
  readonly #redis = new RedisMock();

  #connected = false;

  public readonly setCalls: Array<{
    readonly key: string;
    readonly value: string;
    readonly secondsMode: 'EX';
    readonly seconds: number;
    readonly condition: 'NX';
  }> = [];

  public pingCount = 0;

  public get status(): string {
    return this.#connected ? 'ready' : 'wait';
  }

  public connect(): Promise<unknown> {
    this.#connected = true;
    return Promise.resolve(undefined);
  }

  public disconnect(): void {
    this.#connected = false;
    this.#redis.disconnect();
  }

  public async del(key: string): Promise<number> {
    return await this.#redis.del(key);
  }

  public async get(key: string): Promise<string | null> {
    return await this.#redis.get(key);
  }

  public on(): unknown {
    return this;
  }

  public async ping(): Promise<string> {
    this.pingCount += 1;
    return await this.#redis.ping();
  }

  public async set(
    key: string,
    value: string,
    secondsMode: 'EX',
    seconds: number,
    condition: 'NX',
  ): Promise<'OK' | null> {
    this.setCalls.push({ key, value, secondsMode, seconds, condition });
    const result = await this.#redis.set(key, value, secondsMode, seconds, condition);
    return result === 'OK' ? 'OK' : null;
  }

  public async rawSet(key: string, value: string): Promise<void> {
    await this.#redis.set(key, value);
  }
}

class FailingRedisSessionClient implements RedisSessionClient {
  public readonly status = 'wait';

  public constructor(private readonly err: Error) {}

  public connect(): Promise<unknown> {
    return Promise.reject(this.err);
  }

  public disconnect(): void {}

  public del(): Promise<number> {
    return Promise.reject(this.err);
  }

  public get(): Promise<string | null> {
    return Promise.reject(this.err);
  }

  public on(): unknown {
    return this;
  }

  public ping(): Promise<string> {
    return Promise.reject(this.err);
  }

  public set(): Promise<'OK' | null> {
    return Promise.reject(this.err);
  }
}
