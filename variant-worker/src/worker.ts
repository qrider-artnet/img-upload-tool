import type { Env, R2ObjectBodyLike } from './bindings.js';
import { VariantWorkerError, jsonError, toErrorResponse } from './errors.js';
import type { ObjectKey } from './object-key.js';
import { parseImageRequest } from './request.js';
import { buildVariantKey, getVariantSpec, type WebpVariant } from './variants.js';

const CACHE_CONTROL = 'public, max-age=31536000, immutable';
const CACHE_VERSION_METADATA_KEY = 'cache-version';
const WEBP_CONTENT_TYPE = 'image/webp';
const DEFAULT_ORIGINAL_CONTENT_TYPE = 'application/octet-stream';

export const handleRequest = async (request: Request, env: Env): Promise<Response> => {
  try {
    if (request.method !== 'GET') {
      return jsonError('invalid_request', 'Only GET is supported.', 405);
    }

    const parsed = parseImageRequest(request);

    if (parsed.variant === undefined) {
      return await serveOriginal(env, parsed.objectKey, parsed.cacheVersion);
    }

    return await serveVariant(env, parsed.objectKey, parsed.variant, parsed.cacheVersion);
  } catch (err: unknown) {
    return toErrorResponse(err);
  }
};

const serveOriginal = async (
  env: Env,
  objectKey: ObjectKey,
  cacheVersion: string | undefined,
): Promise<Response> => {
  const original = await env.R2_PRIMARY.get(objectKey);

  if (original === null) {
    throw new VariantWorkerError({
      code: 'image_not_found',
      status: 404,
      message: 'Image was not found.',
    });
  }

  enforceCacheVersion(original, cacheVersion);
  return responseFromR2Object(original, original.httpMetadata?.contentType);
};

const serveVariant = async (
  env: Env,
  objectKey: ObjectKey,
  variant: WebpVariant,
  cacheVersion: string | undefined,
): Promise<Response> => {
  const variantKey = buildVariantKey(objectKey, variant, cacheVersion);
  const storedVariant = await env.R2_PRIMARY.get(variantKey);

  if (storedVariant !== null) {
    return responseFromR2Object(storedVariant, WEBP_CONTENT_TYPE);
  }

  const original = await env.R2_PRIMARY.get(objectKey);
  if (original === null) {
    throw new VariantWorkerError({
      code: 'image_not_found',
      status: 404,
      message: 'Image was not found.',
    });
  }

  enforceCacheVersion(original, cacheVersion);
  const spec = getVariantSpec(variant);
  const transformed = (
    await env.IMAGES.input(original.body)
      .transform(spec.transform)
      .output({ format: WEBP_CONTENT_TYPE, quality: spec.quality })
  ).response();

  if (transformed.body === null) {
    throw new VariantWorkerError({
      code: 'invalid_request',
      status: 502,
      message: 'Image transformation did not produce a response body.',
    });
  }

  const [storeBody, responseBody] = transformed.body.tee();
  await env.R2_PRIMARY.put(variantKey, storeBody, {
    httpMetadata: {
      contentType: WEBP_CONTENT_TYPE,
      cacheControl: CACHE_CONTROL,
    },
  });

  return new Response(responseBody, {
    status: 200,
    headers: variantHeaders(),
  });
};

const responseFromR2Object = (
  object: R2ObjectBodyLike,
  contentType: string | undefined,
): Response => {
  const headers = new Headers();
  object.writeHttpMetadata?.(headers);
  headers.set('Content-Type', contentType ?? DEFAULT_ORIGINAL_CONTENT_TYPE);
  headers.set('Cache-Control', CACHE_CONTROL);

  return new Response(object.body, {
    status: 200,
    headers,
  });
};

const variantHeaders = (): Headers =>
  new Headers({
    'Content-Type': WEBP_CONTENT_TYPE,
    'Cache-Control': CACHE_CONTROL,
  });

const enforceCacheVersion = (
  original: R2ObjectBodyLike,
  cacheVersion: string | undefined,
): void => {
  if (cacheVersion === undefined) {
    return;
  }

  if (original.customMetadata?.[CACHE_VERSION_METADATA_KEY] === cacheVersion) {
    return;
  }

  throw new VariantWorkerError({
    code: 'image_not_found',
    status: 404,
    message: 'Image was not found.',
  });
};
