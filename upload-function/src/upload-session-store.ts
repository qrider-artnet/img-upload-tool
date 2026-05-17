import { ulid } from 'ulid';

import { UploadFunctionError } from './errors.js';
import type { ProductId } from './object-key.js';
import type { AllowedContentType, ObjectKey, UploadId } from './types.js';

/**
 * Temporary state recorded after presign and consumed during finalize.
 */
export interface UploadSession {
  readonly uploadId: UploadId;
  readonly objectKey: ObjectKey;
  readonly productId: ProductId;
  readonly auctionHouseId?: string;
  readonly contentType: AllowedContentType;
  readonly contentLength: number;
  readonly expiresAt: Date;
}

/**
 * Input required to create a direct-upload session.
 */
export interface CreateUploadSessionInput {
  readonly objectKey: ObjectKey;
  readonly productId: ProductId;
  readonly auctionHouseId?: string;
  readonly contentType: AllowedContentType;
  readonly contentLength: number;
  readonly expiresAt: Date;
}

/**
 * Stores temporary direct-upload sessions.
 */
export interface UploadSessionStore {
  create(input: CreateUploadSessionInput): Promise<UploadSession>;
  delete(uploadId: UploadId): Promise<void>;
  get(uploadId: UploadId, now: Date): Promise<UploadSession | undefined>;
}

export const DEFAULT_MAX_IN_MEMORY_SESSIONS = 10_000;

/**
 * In-process session store for the stage 1 implementation.
 *
 * Spec §2.3.1 chooses in-process memory for v1, which makes this store correct
 * only when Cloud Run runs with `min-instances=1` and `max-instances=1`. See
 * README "Cloud Run Deployment" for the deployment constraint.
 */
export class InMemoryUploadSessionStore implements UploadSessionStore {
  readonly #sessions = new Map<UploadId, UploadSession>();

  readonly #maxSessions: number;

  public constructor(options: { maxSessions?: number } = {}) {
    this.#maxSessions = options.maxSessions ?? DEFAULT_MAX_IN_MEMORY_SESSIONS;
  }

  public create(input: CreateUploadSessionInput): Promise<UploadSession> {
    if (this.#sessions.size >= this.#maxSessions) {
      this.#pruneExpired(new Date());
    }

    if (this.#sessions.size >= this.#maxSessions) {
      return Promise.reject(
        new UploadFunctionError({
          code: 'too_many_sessions',
          status: 503,
          message: 'Upload session capacity is exhausted; retry after backoff.',
          details: { maxSessions: this.#maxSessions },
        }),
      );
    }

    const uploadId = createUploadId();
    const session: UploadSession = { uploadId, ...input };
    this.#sessions.set(uploadId, session);
    return Promise.resolve(session);
  }

  public delete(uploadId: UploadId): Promise<void> {
    this.#sessions.delete(uploadId);
    return Promise.resolve();
  }

  public get(uploadId: UploadId, now: Date): Promise<UploadSession | undefined> {
    const session = this.#sessions.get(uploadId);

    if (session === undefined) {
      return Promise.resolve(undefined);
    }

    if (session.expiresAt.getTime() <= now.getTime()) {
      this.#sessions.delete(uploadId);
      return Promise.resolve(undefined);
    }

    return Promise.resolve(session);
  }

  #pruneExpired(now: Date): void {
    const cutoff = now.getTime();
    for (const [uploadId, session] of this.#sessions) {
      if (session.expiresAt.getTime() <= cutoff) {
        this.#sessions.delete(uploadId);
      }
    }
  }
}

/**
 * Validates and brands an upload ID from a route parameter.
 */
export const parseUploadId = (value: string | undefined): UploadId => {
  if (value !== undefined && /^[0-9A-HJKMNP-TV-Z]{26}$/.test(value)) {
    return value as UploadId;
  }

  throw new UploadFunctionError({
    code: 'invalid_request',
    status: 400,
    message: 'uploadId must be a valid ULID.',
    details: { field: 'uploadId' },
  });
};

const createUploadId = (): UploadId => ulid() as UploadId;
