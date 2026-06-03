import type { CacheLike, Env, R2ObjectBodyLike } from './bindings.js';
import { VariantWorkerError, jsonError, toErrorResponse } from './errors.js';
import type { ObjectKey } from './object-key.js';
import { parseImageRequest } from './request.js';
import { buildVariantKey, getVariantSpec, type WebpVariant } from './variants.js';

const CACHE_CONTROL = 'public, max-age=31536000, immutable';
const CACHE_VERSION_METADATA_KEY = 'cache-version';
const WEBP_CONTENT_TYPE = 'image/webp';
const DEFAULT_ORIGINAL_CONTENT_TYPE = 'application/octet-stream';

// Edge cache observability headers (see docs/spec.md §3.4 and ADR 0004).
// X-Cache: HIT | MISS — whether the Cache API (caches.default) served it.
// X-Cache-Source: edge | r2 | images — where the bytes ultimately came from.
const CACHE_STATUS_HEADER = 'X-Cache';
const CACHE_SOURCE_HEADER = 'X-Cache-Source';

type CacheSource = 'edge' | 'r2' | 'images';

interface ServeResult {
  readonly response: Response;
  readonly source: CacheSource;
}

export const handleRequest = async (
  request: Request,
  env: Env,
  cache?: CacheLike,
): Promise<Response> => {
  try {
    if (request.method !== 'GET') {
      return jsonError('invalid_request', 'Only GET is supported.', 405);
    }

    if (cache !== undefined) {
      const cached = await cache.match(request);
      if (cached !== undefined) {
        return withCacheStatus(cached, 'HIT', 'edge');
      }
    }

    const parsed = parseImageRequest(request);
    const result =
      parsed.variant === undefined
        ? await serveOriginal(env, parsed.objectKey, parsed.cacheVersion)
        : await serveVariant(env, parsed.objectKey, parsed.variant, parsed.cacheVersion);

    const response = withCacheStatus(result.response, 'MISS', result.source);

    // Persist the freshly built response in the edge cache for next time. The
    // real adapter defers the write via ctx.waitUntil, so this does not block
    // the response. A clone is cached because the body stream is single-use.
    if (cache !== undefined) {
      await cache.put(request, response.clone());
    }

    return response;
  } catch (err: unknown) {
    return toErrorResponse(err);
  }
};

const serveOriginal = async (
  env: Env,
  objectKey: ObjectKey,
  cacheVersion: string | undefined,
): Promise<ServeResult> => {
  const original = await env.R2_PRIMARY.get(objectKey);

  if (original === null) {
    throw new VariantWorkerError({
      code: 'image_not_found',
      status: 404,
      message: 'Image was not found.',
    });
  }

  enforceCacheVersion(original, cacheVersion);
  return {
    response: responseFromR2Object(original, original.httpMetadata?.contentType),
    source: 'r2',
  };
};

const serveVariant = async (
  env: Env,
  objectKey: ObjectKey,
  variant: WebpVariant,
  cacheVersion: string | undefined,
): Promise<ServeResult> => {
  const variantKey = buildVariantKey(objectKey, variant, cacheVersion);
  const storedVariant = await env.R2_PRIMARY.get(variantKey);

  if (storedVariant !== null) {
    return { response: responseFromR2Object(storedVariant, WEBP_CONTENT_TYPE), source: 'r2' };
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

  return {
    response: new Response(responseBody, { status: 200, headers: variantHeaders() }),
    source: 'images',
  };
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

/**
 * Returns a copy of `response` with the cache-status observability headers set.
 * Rebuilding via `new Response` keeps it valid for responses read back from the
 * edge cache, whose headers are otherwise immutable.
 */
const withCacheStatus = (
  response: Response,
  status: 'HIT' | 'MISS',
  source: CacheSource,
): Response => {
  const result = new Response(response.body, response);
  result.headers.set(CACHE_STATUS_HEADER, status);
  result.headers.set(CACHE_SOURCE_HEADER, source);
  return result;
};

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
