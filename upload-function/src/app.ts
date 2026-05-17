import { Hono } from 'hono';
import { ulid } from 'ulid';
import type { z } from 'zod';

import {
  normalizeStoredContentType,
  parseAllowedContentType,
  validateContentLength,
} from './content-type.js';
import { UploadFunctionError, toUploadFunctionError } from './errors.js';
import { createLogger, type Logger } from './logger.js';
import {
  buildObjectKey,
  isProductId,
  parseObjectKey,
  parseObjectKeyDetails,
  productIdForEntityKind,
  type EntityInput,
  type ProductId,
} from './object-key.js';
import {
  ErrorResponseSchema,
  FinalizeResponseSchema,
  HealthResponseSchema,
  PresignRequestSchema,
  PresignResponseSchema,
  type PresignRequest,
} from './schemas.js';
import type { ReplicationStorage } from './storage/replication-storage.js';
import type { UploadStorage } from './storage/upload-storage.js';
import type { AllowedContentType, ObjectKey } from './types.js';
import { parseUploadId, type UploadSessionStore } from './upload-session-store.js';
import { buildAllWebpVariantKeys, buildAllWebpVariantPrefixes } from './variant-keys.js';

const CORS_ALLOW_HEADERS = 'Content-Type, X-Artnet-Product-Id, X-Artnet-Auction-House-Id';
const CORS_ALLOW_METHODS = 'GET, POST, DELETE, OPTIONS';
const DEFAULT_CORS_ALLOW_ORIGIN = '*';
const TRUSTED_PRODUCT_HEADER = 'x-artnet-product-id';
const TRUSTED_AUCTION_HOUSE_HEADER = 'x-artnet-auction-house-id';
const TRUSTED_AUCTION_HOUSE_PATTERN = /^[A-Za-z0-9_-]+$/;

interface AppBindings {
  readonly Variables: {
    readonly requestId: string;
  };
}

/**
 * Services and runtime settings required by the Upload Function app.
 */
export interface CreateUploadFunctionAppInput {
  readonly corsAllowOrigin?: string;
  readonly publicBaseUrl: string;
  readonly signedUrlTtlSeconds: number;
  readonly storage: UploadStorage;
  readonly replication: ReplicationStorage;
  readonly uploadSessionStore: UploadSessionStore;
}

/**
 * Creates the Hono application for the Upload Function stage 1 endpoints.
 */
export const createUploadFunctionApp = (
  services: CreateUploadFunctionAppInput,
): Hono<AppBindings> => {
  const app = new Hono<AppBindings>();

  app.use('*', async (c, next) => {
    c.set('requestId', ulid());
    c.header('Access-Control-Allow-Origin', services.corsAllowOrigin ?? DEFAULT_CORS_ALLOW_ORIGIN);
    c.header('Access-Control-Allow-Headers', CORS_ALLOW_HEADERS);
    c.header('Access-Control-Allow-Methods', CORS_ALLOW_METHODS);

    if (c.req.method === 'OPTIONS') {
      return c.body(null, 204);
    }

    await next();
  });

  app.onError((err: unknown, c) => {
    const requestId = c.get('requestId');
    const log = createLogger(requestId);
    const uploadError = toUploadFunctionError(err);

    log.warn({
      eventCode: 'upload_function.request_failed',
      requestId,
      errorCode: uploadError.code,
      status: uploadError.status,
      ...(uploadError.details === undefined ? {} : { errorDetails: uploadError.details }),
    });

    const errorBody = ErrorResponseSchema.parse({
      error: {
        code: uploadError.code,
        message: uploadError.message,
        ...(uploadError.details === undefined ? {} : { details: uploadError.details }),
      },
      requestId,
    });

    return c.json(errorBody, uploadError.status);
  });

  app.get('/v1/health', async (c) => {
    await Promise.all([services.storage.healthCheck(), services.replication.healthCheck()]);
    const response = HealthResponseSchema.parse({ status: 'ok' });
    return c.json(response);
  });

  app.post('/v1/uploads/presign', async (c) => {
    const requestId = c.get('requestId');
    const log = createLogger(requestId);
    const trustedProductId = parseTrustedProductId(c.req.header(TRUSTED_PRODUCT_HEADER));
    const body = await readJsonBody(() => c.req.json());
    const request = parseWithSchema(PresignRequestSchema, body);
    const contentType = parseAllowedContentType(request.contentType);
    validateContentLength(request.contentLength);
    const productId = productIdForEntityKind(request.kind);
    enforceProductContext(trustedProductId, productId);

    if (request.kind === 'auction-lot') {
      const trustedAuctionHouseId = parseTrustedAuctionHouseId(
        c.req.header(TRUSTED_AUCTION_HOUSE_HEADER),
      );
      enforceAuctionHouseContext(trustedAuctionHouseId, request.auctionHouseId);
    }

    const objectKey = buildObjectKey({
      entity: entityInputFromPresignRequest(request),
      imageId: request.imageId,
      imageVariantSuffix: request.imageVariantSuffix,
      contentType,
    });
    const expiresAt = new Date(Date.now() + services.signedUrlTtlSeconds * 1000);
    const session = await services.uploadSessionStore.create({
      contentLength: request.contentLength,
      contentType,
      expiresAt,
      objectKey,
      productId,
      ...(request.kind === 'auction-lot' ? { auctionHouseId: request.auctionHouseId } : {}),
    });
    const signedUrl = await services.storage.createSignedUploadUrl({
      contentLength: request.contentLength,
      contentType,
      expiresAt,
      objectKey,
    });

    log.info({
      eventCode: 'uploads.presign.succeeded',
      requestId,
      objectKey,
      uploadId: session.uploadId,
    });

    const response = PresignResponseSchema.parse({
      uploadId: session.uploadId,
      objectKey,
      uploadUrl: signedUrl.uploadUrl,
      uploadHeaders: {
        'Content-Type': contentType,
        'Content-Length': String(request.contentLength),
        'X-Goog-Content-Length-Range': signedUrl.contentLengthRange,
      },
      expiresAt: expiresAt.toISOString(),
    });

    return c.json(response);
  });

  app.post('/v1/uploads/:uploadId/finalize', async (c) => {
    const requestId = c.get('requestId');
    const log = createLogger(requestId);
    const trustedProductId = parseTrustedProductId(c.req.header(TRUSTED_PRODUCT_HEADER));
    const uploadId = parseUploadId(c.req.param('uploadId'));
    const session = await services.uploadSessionStore.get(uploadId, new Date());

    if (session === undefined) {
      throw new UploadFunctionError({
        code: 'upload_session_not_found',
        status: 404,
        message: 'Upload session was not found or has expired.',
      });
    }

    enforceProductContext(trustedProductId, session.productId);
    enforceSessionAuctionHouseContext(
      session.auctionHouseId,
      c.req.header(TRUSTED_AUCTION_HOUSE_HEADER),
    );

    const metadata = await services.storage.getObjectMetadata(session.objectKey);

    if (metadata === undefined) {
      throw new UploadFunctionError({
        code: 'upload_not_received',
        status: 409,
        message: 'Uploaded object was not found in GCS.',
      });
    }

    if (metadata.size !== session.contentLength) {
      await services.storage.deleteObject(session.objectKey);
      throw new UploadFunctionError({
        code: 'size_mismatch',
        status: 400,
        message: 'Uploaded file size does not match the presign request.',
        details: { expected: session.contentLength, actual: metadata.size },
      });
    }

    const storedContentType = normalizeStoredContentType(metadata.contentType);
    if (storedContentType !== undefined && storedContentType !== session.contentType) {
      log.warn({
        eventCode: 'uploads.finalize.content_type_mismatch',
        requestId,
        objectKey: session.objectKey,
        expected: session.contentType,
        actual: metadata.contentType,
      });
      await services.storage.deleteObject(session.objectKey);
      throw new UploadFunctionError({
        code: 'content_type_mismatch',
        status: 400,
        message: 'Uploaded content type does not match the presign request.',
        details: { expected: session.contentType, actual: metadata.contentType },
      });
    }

    const replicatedToR2 = await replicateToR2({
      replication: services.replication,
      storage: services.storage,
      cacheVersion: session.uploadId,
      objectKey: session.objectKey,
      contentType: session.contentType,
      contentLength: metadata.size,
      log,
      requestId,
    });

    await services.uploadSessionStore.delete(uploadId);

    const uploadedAt = metadata.updatedAt ?? new Date();
    const response = FinalizeResponseSchema.parse({
      objectKey: session.objectKey,
      publicUrl: buildVersionedPublicUrl(
        services.publicBaseUrl,
        session.uploadId,
        session.objectKey,
      ),
      size: metadata.size,
      contentType: session.contentType,
      uploadedAt: uploadedAt.toISOString(),
      replicatedToR2,
    });

    log.info({
      eventCode: 'uploads.finalize.succeeded',
      requestId,
      objectKey: session.objectKey,
      size: metadata.size,
    });

    return c.json(response);
  });

  app.delete('/v1/objects/*', async (c) => {
    const requestId = c.get('requestId');
    const log = createLogger(requestId);
    const trustedProductId = parseTrustedProductId(c.req.header(TRUSTED_PRODUCT_HEADER));
    const objectKey = parseObjectKey(extractObjectKeyFromPath(c.req.path));
    const objectKeyDetails = parseObjectKeyDetails(objectKey);
    enforceProductContext(trustedProductId, objectKeyDetails.productId);
    let deletedBy: string = trustedProductId;
    if (objectKeyDetails.kind === 'auction-lot') {
      const trustedAuctionHouseId = parseTrustedAuctionHouseId(
        c.req.header(TRUSTED_AUCTION_HOUSE_HEADER),
      );
      enforceAuctionHouseContext(trustedAuctionHouseId, objectKeyDetails.auctionHouseId);
      deletedBy = trustedAuctionHouseId;
    }

    log.info({ eventCode: 'uploads.delete.requested', requestId, objectKey });

    await services.storage.writeTombstone(objectKey, {
      objectKey,
      deletedAt: new Date().toISOString(),
      deletedBy,
      requestId,
    });
    log.info({ eventCode: 'uploads.delete.tombstone_written', requestId, objectKey });

    const r2Keys = [objectKey, ...buildAllWebpVariantKeys(objectKey)];
    for (const r2Key of r2Keys) {
      await services.replication.delete(r2Key);
      log.info({ eventCode: 'uploads.delete.r2_object_succeeded', requestId, r2Key });
    }
    for (const r2Prefix of buildAllWebpVariantPrefixes(objectKey)) {
      await services.replication.deleteByPrefix(r2Prefix);
      log.info({ eventCode: 'uploads.delete.r2_prefix_succeeded', requestId, r2Prefix });
    }
    log.info({ eventCode: 'uploads.delete.r2_succeeded', requestId, objectKey });

    await services.storage.deleteObject(objectKey);
    log.info({ eventCode: 'uploads.delete.gcs_succeeded', requestId, objectKey });

    log.info({ eventCode: 'uploads.delete.succeeded', requestId, objectKey });
    return c.body(null, 204);
  });

  app.delete('/v1/uploads/:uploadId', async (c) => {
    const trustedProductId = parseTrustedProductId(c.req.header(TRUSTED_PRODUCT_HEADER));
    const uploadId = parseUploadId(c.req.param('uploadId'));
    const session = await services.uploadSessionStore.get(uploadId, new Date());

    if (session !== undefined) {
      enforceProductContext(trustedProductId, session.productId);
      enforceSessionAuctionHouseContext(
        session.auctionHouseId,
        c.req.header(TRUSTED_AUCTION_HOUSE_HEADER),
      );
    }

    await services.uploadSessionStore.delete(uploadId);
    return c.body(null, 204);
  });

  const readJsonBody = async (reader: () => Promise<unknown>): Promise<unknown> => {
    try {
      return await reader();
    } catch {
      throw new UploadFunctionError({
        code: 'invalid_request',
        status: 400,
        message: 'Request body must be valid JSON.',
      });
    }
  };

  return app;
};

const parseWithSchema = <Schema extends z.ZodType>(
  schema: Schema,
  value: unknown,
): z.infer<Schema> => {
  const parsed = schema.safeParse(value);

  if (parsed.success) {
    return parsed.data;
  }

  throw new UploadFunctionError({
    code: 'invalid_request',
    status: 400,
    message: 'Request body did not match the expected schema.',
    details: { issues: parsed.error.issues },
  });
};

const trimTrailingSlash = (value: string): string => value.replace(/\/+$/, '');

const buildVersionedPublicUrl = (
  publicBaseUrl: string,
  cacheVersion: string,
  objectKey: ObjectKey,
): string => `${trimTrailingSlash(publicBaseUrl)}/_v/${cacheVersion}/${objectKey}`;

const OBJECT_PATH_PREFIX = '/v1/objects/';

/**
 * Pulls the canonical object-key tail out of a `DELETE /v1/objects/*` path.
 * Caller is responsible for validating the result with `parseObjectKey`.
 */
const extractObjectKeyFromPath = (path: string): string => {
  if (!path.startsWith(OBJECT_PATH_PREFIX)) {
    throw new UploadFunctionError({
      code: 'invalid_request',
      status: 400,
      message: 'objectKey path is missing.',
      details: { field: 'objectKey' },
    });
  }

  try {
    return decodeURIComponent(path.slice(OBJECT_PATH_PREFIX.length));
  } catch {
    throw new UploadFunctionError({
      code: 'invalid_request',
      status: 400,
      message: 'objectKey path is not valid URL encoding.',
      details: { field: 'objectKey' },
    });
  }
};

interface ReplicateToR2Input {
  readonly replication: ReplicationStorage;
  readonly storage: UploadStorage;
  readonly cacheVersion: string;
  readonly objectKey: ObjectKey;
  readonly contentType: AllowedContentType;
  readonly contentLength: number;
  readonly log: Logger;
  readonly requestId: string;
}

/**
 * Streams a finalized GCS object into R2 per spec §2.9.
 * Failures are logged and swallowed so finalize still returns 200; the
 * Reconciliation Function (§4) repairs drift later.
 */
const replicateToR2 = async (input: ReplicateToR2Input): Promise<boolean> => {
  try {
    await input.replication.put({
      objectKey: input.objectKey,
      bodyFactory: () => input.storage.getObjectStream(input.objectKey),
      cacheVersion: input.cacheVersion,
      contentType: input.contentType,
      contentLength: input.contentLength,
    });

    input.log.info({
      eventCode: 'r2.replication.succeeded',
      requestId: input.requestId,
      objectKey: input.objectKey,
      size: input.contentLength,
    });
    return true;
  } catch (err: unknown) {
    const uploadError = toUploadFunctionError(err);
    input.log.warn({
      eventCode: 'r2.replication.failed',
      requestId: input.requestId,
      objectKey: input.objectKey,
      errorCode: uploadError.code,
      ...(uploadError.details === undefined ? {} : { errorDetails: uploadError.details }),
    });
    return false;
  }
};

const entityInputFromPresignRequest = (request: PresignRequest): EntityInput => {
  switch (request.kind) {
    case 'gallery-artwork':
      return {
        kind: request.kind,
        galleryId: request.galleryId,
        artworkId: request.artworkId,
      };
    case 'auction-lot':
      return {
        kind: request.kind,
        auctionHouseId: request.auctionHouseId,
        auctionDate: request.auctionDate,
        lotId: request.lotId,
      };
    case 'pdb-artwork':
      return {
        kind: request.kind,
        pdbArtworkId: request.pdbArtworkId,
      };
  }
};

const parseTrustedProductId = (value: string | undefined): ProductId => {
  if (value === undefined) {
    throw new UploadFunctionError({
      code: 'product_required',
      status: 403,
      message: 'Trusted product header is required.',
      details: { field: 'X-Artnet-Product-Id' },
    });
  }

  if (isProductId(value)) {
    return value;
  }

  throw new UploadFunctionError({
    code: 'invalid_request',
    status: 400,
    message: 'Trusted product header is not supported.',
    details: { field: 'X-Artnet-Product-Id' },
  });
};

const parseTrustedAuctionHouseId = (value: string | undefined): string => {
  if (value === undefined) {
    throw new UploadFunctionError({
      code: 'auction_house_required',
      status: 403,
      message: 'Trusted auction-house header is required.',
      details: { field: 'X-Artnet-Auction-House-Id' },
    });
  }

  if (TRUSTED_AUCTION_HOUSE_PATTERN.test(value)) {
    return value;
  }

  throw new UploadFunctionError({
    code: 'invalid_request',
    status: 400,
    message: 'Trusted auction-house header contains invalid characters.',
    details: { field: 'X-Artnet-Auction-House-Id' },
  });
};

const enforceProductContext = (trustedProductId: ProductId, productId: ProductId): void => {
  if (trustedProductId === productId) {
    return;
  }

  throw new UploadFunctionError({
    code: 'product_mismatch',
    status: 403,
    message: 'Trusted product context does not match the image entity.',
  });
};

const enforceSessionAuctionHouseContext = (
  auctionHouseId: string | undefined,
  headerValue: string | undefined,
): void => {
  if (auctionHouseId === undefined) {
    return;
  }

  enforceAuctionHouseContext(parseTrustedAuctionHouseId(headerValue), auctionHouseId);
};

const enforceAuctionHouseContext = (
  trustedAuctionHouseId: string,
  auctionHouseId: string,
): void => {
  if (trustedAuctionHouseId === auctionHouseId) {
    return;
  }

  throw new UploadFunctionError({
    code: 'auction_house_mismatch',
    status: 403,
    message: 'Trusted auction-house context does not match the upload request.',
  });
};
