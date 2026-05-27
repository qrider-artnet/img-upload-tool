import type { SessionStoreMode } from './config.js';
import { UploadFunctionError } from './errors.js';
import {
  createRedisUploadSessionStore,
  type RedisUploadSessionStoreConfig,
} from './upload-session-store-redis.js';
import { InMemoryUploadSessionStore, type UploadSessionStore } from './upload-session-store.js';

/**
 * Creates the configured upload session store without opening network connections.
 */
export const createUploadSessionStoreFromConfig = (
  config: UploadSessionStoreFactoryConfig,
): UploadSessionStore => {
  switch (config.SESSION_STORE) {
    case 'memory':
      return new InMemoryUploadSessionStore();
    case 'redis':
      return createRedisUploadSessionStore(redisConfigFromEnv(config));
  }
};

export interface UploadSessionStoreFactoryConfig {
  readonly SESSION_STORE: SessionStoreMode;
  readonly REDIS_URL?: string;
  readonly REDIS_KEY_PREFIX: string;
}

const redisConfigFromEnv = (
  config: UploadSessionStoreFactoryConfig,
): RedisUploadSessionStoreConfig => {
  if (config.REDIS_URL !== undefined) {
    return {
      redisUrl: config.REDIS_URL,
      keyPrefix: config.REDIS_KEY_PREFIX,
    };
  }

  throw new UploadFunctionError({
    code: 'session_store_unavailable',
    status: 503,
    message: 'REDIS_URL is required when SESSION_STORE=redis.',
  });
};
