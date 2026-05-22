import { createClient } from 'redis';
import { z } from 'zod';

import { UploadFunctionError } from './errors.js';
import { isProductId, parseObjectKey, type ProductId } from './object-key.js';
import { AllowedContentTypeSchema } from './schemas.js';
import type { StagingObjectKey, StorageObjectKey, UploadId } from './types.js';
import {
  parseUploadId,
  type CreateUploadSessionInput,
  type UploadSession,
  type UploadSessionStore,
} from './upload-session-store.js';

const DEFAULT_KEY_PREFIX = 'upload-session:';

const RedisUploadSessionSchema = z
  .object({
    uploadId: z.string().min(1),
    objectKey: z.string().min(1),
    stagingObjectKey: z.string().min(1).optional(),
    productId: z.string().min(1),
    auctionHouseId: z.string().min(1).optional(),
    contentType: AllowedContentTypeSchema,
    contentLength: z.number().int().positive(),
    expiresAt: z.iso.datetime(),
  })
  .strict();

export interface RedisSessionClient {
  readonly isOpen: boolean;
  connect(): Promise<unknown>;
  del(key: string): Promise<number>;
  get(key: string): Promise<string | null>;
  on(event: 'error', listener: (err: Error) => void): unknown;
  ping(): Promise<string>;
  set(
    key: string,
    value: string,
    options: {
      readonly EX: number;
      readonly NX: true;
    },
  ): Promise<string | null>;
}

export interface RedisUploadSessionStoreConfig {
  readonly redisUrl: string;
  readonly keyPrefix?: string;
}

export const createRedisUploadSessionStore = (
  config: RedisUploadSessionStoreConfig,
): UploadSessionStore => {
  const client: RedisSessionClient = createClient({ url: config.redisUrl });
  client.on?.('error', () => {
    // Connection failures are surfaced through the operation that observed them.
  });
  return new RedisUploadSessionStore({
    client,
    keyPrefix: config.keyPrefix ?? DEFAULT_KEY_PREFIX,
  });
};

export class RedisUploadSessionStore implements UploadSessionStore {
  readonly #client: RedisSessionClient;

  readonly #keyPrefix: string;

  #connectPromise: Promise<void> | undefined = undefined;

  public constructor(input: { readonly client: RedisSessionClient; readonly keyPrefix?: string }) {
    this.#client = input.client;
    this.#keyPrefix = input.keyPrefix ?? DEFAULT_KEY_PREFIX;
  }

  public async create(input: CreateUploadSessionInput): Promise<UploadSession> {
    await this.#connect();
    const expiresInSeconds = secondsUntil(input.expiresAt, new Date());
    const session: UploadSession = { ...input };
    const result = await this.#runRedisOperation(
      async () =>
        await this.#client.set(this.#key(input.uploadId), serializeSession(session), {
          EX: expiresInSeconds,
          NX: true,
        }),
    );

    if (result === 'OK') {
      return session;
    }

    throw new UploadFunctionError({
      code: 'session_store_unavailable',
      status: 503,
      message: 'Unable to allocate a unique upload session.',
    });
  }

  public async delete(uploadId: UploadId): Promise<void> {
    await this.#connect();
    await this.#runRedisOperation(async () => await this.#client.del(this.#key(uploadId)));
  }

  public async get(uploadId: UploadId, now: Date): Promise<UploadSession | undefined> {
    await this.#connect();
    const raw = await this.#runRedisOperation(
      async () => await this.#client.get(this.#key(uploadId)),
    );

    if (raw === null) {
      return undefined;
    }

    const session = parseStoredSession(raw);
    if (session.expiresAt.getTime() <= now.getTime()) {
      await this.delete(uploadId);
      return undefined;
    }

    return session;
  }

  public async healthCheck(): Promise<void> {
    await this.#connect();
    await this.#runRedisOperation(async () => await this.#client.ping());
  }

  async #connect(): Promise<void> {
    if (this.#client.isOpen) {
      return;
    }

    if (this.#connectPromise !== undefined) {
      await this.#connectPromise;
      return;
    }

    this.#connectPromise = this.#runRedisOperation(async () => {
      await this.#client.connect();
    }).finally(() => {
      this.#connectPromise = undefined;
    });
    await this.#connectPromise;
  }

  async #runRedisOperation<Result>(operation: () => Promise<Result>): Promise<Result> {
    try {
      return await operation();
    } catch (err: unknown) {
      throw toSessionStoreError(err);
    }
  }

  #key(uploadId: UploadId): string {
    return `${this.#keyPrefix}${uploadId}`;
  }
}

const serializeSession = (session: UploadSession): string =>
  JSON.stringify({
    uploadId: session.uploadId,
    objectKey: session.objectKey,
    stagingObjectKey: session.stagingObjectKey,
    productId: session.productId,
    ...(session.auctionHouseId === undefined ? {} : { auctionHouseId: session.auctionHouseId }),
    contentType: session.contentType,
    contentLength: session.contentLength,
    expiresAt: session.expiresAt.toISOString(),
  });

const parseStoredSession = (raw: string): UploadSession => {
  let decoded: unknown;
  try {
    const parsedJson: unknown = JSON.parse(raw);
    decoded = parsedJson;
  } catch {
    throw new UploadFunctionError({
      code: 'session_store_unavailable',
      status: 503,
      message: 'Upload session record is not valid JSON.',
    });
  }

  const parsed = RedisUploadSessionSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new UploadFunctionError({
      code: 'session_store_unavailable',
      status: 503,
      message: 'Upload session record does not match the expected schema.',
      details: { issues: parsed.error.issues },
    });
  }

  const uploadId = parseUploadId(parsed.data.uploadId);
  const objectKey = parseObjectKey(parsed.data.objectKey);
  const stagingObjectKey =
    parsed.data.stagingObjectKey === undefined
      ? objectKey
      : parseStagingObjectKey(parsed.data.stagingObjectKey);
  const productId = parseProductId(parsed.data.productId);

  return {
    uploadId,
    objectKey,
    stagingObjectKey,
    productId,
    ...(parsed.data.auctionHouseId === undefined
      ? {}
      : { auctionHouseId: parsed.data.auctionHouseId }),
    contentType: parsed.data.contentType,
    contentLength: parsed.data.contentLength,
    expiresAt: new Date(parsed.data.expiresAt),
  };
};

const parseStagingObjectKey = (value: string): StorageObjectKey => {
  if (value.startsWith('staging/uploads/')) {
    return value as StagingObjectKey;
  }

  throw new UploadFunctionError({
    code: 'session_store_unavailable',
    status: 503,
    message: 'Upload session record has an invalid staging object key.',
  });
};

const parseProductId = (value: string): ProductId => {
  if (isProductId(value)) {
    return value;
  }

  throw new UploadFunctionError({
    code: 'session_store_unavailable',
    status: 503,
    message: 'Upload session record has an unsupported product ID.',
  });
};

const secondsUntil = (expiresAt: Date, now: Date): number => {
  const seconds = Math.ceil((expiresAt.getTime() - now.getTime()) / 1000);
  return Math.max(1, seconds);
};

const toSessionStoreError = (err: unknown): UploadFunctionError => {
  if (err instanceof UploadFunctionError) {
    return err;
  }

  const details = describeRedisError(err);
  return new UploadFunctionError({
    code: 'session_store_unavailable',
    status: 503,
    message: 'Upload session store is unavailable.',
    ...(details === undefined ? {} : { details }),
  });
};

const describeRedisError = (err: unknown): Record<string, unknown> | undefined => {
  if (typeof err !== 'object' || err === null) {
    return undefined;
  }

  const description: Record<string, unknown> = {};
  if ('name' in err && typeof err.name === 'string') {
    description.redisName = err.name;
  }
  if ('code' in err && typeof err.code === 'string') {
    description.redisCode = err.code;
  }

  return Object.keys(description).length === 0 ? undefined : description;
};
