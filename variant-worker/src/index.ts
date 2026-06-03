import type { CacheLike, Env } from './bindings.js';
import { handleRequest } from './worker.js';

/**
 * Adapts the Workers Cache API (`caches.default`) to the worker's CacheLike
 * seam. Writes are deferred via `ctx.waitUntil` so caching never blocks the
 * response, and cache-put failures (e.g. a non-cacheable response) are swallowed
 * so they can never fail a request.
 *
 * `caches.default` is a Workers runtime extension absent from the DOM lib's
 * `CacheStorage` type, so it is narrowed here; the runtime guarantees it exists.
 */
const createEdgeCache = (ctx: ExecutionContext): CacheLike => {
  const cache = (caches as CacheStorage & { readonly default: Cache }).default;
  return {
    match: async (request) => (await cache.match(request)) ?? undefined,
    put: (request, response) => {
      ctx.waitUntil(cache.put(request, response).catch(() => undefined));
    },
  };
};

export default {
  fetch: (request, env, ctx) => handleRequest(request, env, createEdgeCache(ctx)),
} satisfies ExportedHandler<Env>;
