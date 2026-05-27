import { describe, expect, it } from 'vitest';

import { defaultSessionStoreMode } from './config.js';
import { UploadFunctionError } from './errors.js';
import { createUploadSessionStoreFromConfig } from './upload-session-store-factory.js';
import { RedisUploadSessionStore } from './upload-session-store-redis.js';
import { InMemoryUploadSessionStore } from './upload-session-store.js';

describe('defaultSessionStoreMode', () => {
  it('defaults to memory under test runners', () => {
    expect(defaultSessionStoreMode({ NODE_ENV: 'test' })).toBe('memory');
    expect(defaultSessionStoreMode({ VITEST: 'true' })).toBe('memory');
    expect(defaultSessionStoreMode({ VITEST_WORKER_ID: '1' })).toBe('memory');
  });

  it('defaults to redis outside tests', () => {
    expect(defaultSessionStoreMode({ NODE_ENV: 'production' })).toBe('redis');
    expect(defaultSessionStoreMode({})).toBe('redis');
  });
});

describe('createUploadSessionStoreFromConfig', () => {
  it('selects the in-memory store when SESSION_STORE=memory', () => {
    const store = createUploadSessionStoreFromConfig({
      SESSION_STORE: 'memory',
      REDIS_KEY_PREFIX: 'upload-session:',
    });

    expect(store).toBeInstanceOf(InMemoryUploadSessionStore);
  });

  it('selects the Redis store when SESSION_STORE=redis', () => {
    const store = createUploadSessionStoreFromConfig({
      SESSION_STORE: 'redis',
      REDIS_URL: 'redis://127.0.0.1:6379',
      REDIS_KEY_PREFIX: 'upload-session:',
    });

    expect(store).toBeInstanceOf(RedisUploadSessionStore);
  });

  it('requires REDIS_URL when Redis is selected', () => {
    expect(() =>
      createUploadSessionStoreFromConfig({
        SESSION_STORE: 'redis',
        REDIS_KEY_PREFIX: 'upload-session:',
      }),
    ).toThrow(UploadFunctionError);
  });
});
