# 0004. Add an edge cache layer and cache-status headers to the Variant Worker

- **Status:** Proposed
- **Date:** 2026-06-02
- **Deciders:** Quentin Rider

## Context

The Variant Worker (§3) serves originals and persisted WebP variants from R2. Its only cache layer is R2 itself: it checks R2 first and, on a variant miss, transforms via the `IMAGES` binding and writes the result back to R2. Every request therefore pays at least one R2 round-trip even when the bytes are unchanged, and there is no signal in the response describing where the bytes came from. Operators have no HIT/MISS visibility: Cloudflare's automatic edge cache does not engage for Worker-generated responses (and is suppressed entirely behind Cloudflare Access in the lower environment), so no `cf-cache-status` appears.

Two distinct needs:

1. **Observability** — be able to tell, per request, whether a response was served from cache or freshly generated.
2. **A real edge cache** — avoid the R2 round-trip on hot paths and serve from the colo-local cache.

## Decision

Add a colo-local edge cache via the Workers Cache API (`caches.default`) in front of the existing R2 logic, and expose two response headers on image responses:

- `X-Cache: HIT | MISS` — whether the Cache API served the response.
- `X-Cache-Source: edge | r2 | images` — provenance of the bytes: the edge cache, a persisted R2 object/variant, or a fresh `IMAGES` transform.

Flow: on a request, check `caches.default` first; on hit, return it as `X-Cache: HIT` / `X-Cache-Source: edge`. On miss, run the existing R2/transform logic, tag the response (`X-Cache: MISS` plus `r2` or `images`), write it to the edge cache via `ctx.waitUntil` (non-blocking), and return it.

The cache is abstracted behind a `CacheLike` interface (`match`/`put`), mirroring the existing `R2BucketLike` / `ImagesBindingLike` seams, so the worker stays unit-testable without the Workers runtime. The real entry (`index.ts`) wires `caches.default` and `ctx.waitUntil`; tests inject a fake.

Cache key is the request URL. Because public URLs are versioned (`/_v/<cacheVersion>/`) and immutable, the URL is a sound, collision-free key, and the same key is shared across all authorized viewers (the bytes are identical for everyone — image URLs are public; the SSO gate in QA is environmental, not per-asset).

## Consequences

- **Positive:** Hot-path requests skip the R2 round-trip and the transform. Operators get per-request HIT/MISS and provenance with no external tooling. The abstraction keeps the worker testable off-runtime.
- **Positive:** No change to the cache *contract* — responses still carry `Cache-Control: public, max-age=31536000, immutable`; the edge cache is additive.
- **Accepted trade-off:** Behind Cloudflare Access (the QA lower environment), the Cache API still works at the worker layer, but the broader CDN edge benefits are muted; the larger win is in (public) production.
- **Accepted trade-off:** A new R2-persisted variant is not immediately visible to colos that already cached a MISS-era response — but since URLs are immutable, this only affects the brief window before first population, and `Cache-Control: immutable` already governs client behavior.
- **Negative:** `caches.default` is a runtime extension absent from the DOM lib's `CacheStorage` type, requiring one narrow type assertion in `index.ts` (documented inline).

## Alternatives considered

- **Observability header only (no edge cache).** Simpler, no behavior change, and sufficient for HIT/MISS visibility — but leaves the R2 round-trip on every hot request. Rejected in favor of doing both, since the edge cache is the part that actually improves latency.
- **Rely on Cloudflare's automatic edge cache + `cf-cache-status`.** Worker-generated responses are not automatically edge-cached, and Access suppresses it in QA, so this would surface nothing. Rejected.
- **A dashboard Cache Rule instead of code.** Cache Rules do not reliably apply to Worker responses and would not expose the `r2`-vs-`images` provenance distinction. Rejected.

## Related

- Spec section: `docs/spec.md` §3.3 (URL scheme), §3.4 (behavior)
- Related ADRs: 0002 (persist generated WebP variants)
- Implementation: `variant-worker/src/worker.ts`, `index.ts`, `bindings.ts`
