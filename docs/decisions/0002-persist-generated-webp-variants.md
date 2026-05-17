# 0002. Persist generated WebP variants in R2

- **Status:** Accepted
- **Date:** 2026-05-15
- **Deciders:** Upload Function and Variant Worker maintainers

## Context

Spec v3 originally described the Variant Worker as a read-only path that used Cloudflare image resizing at the edge. The current serving requirement is different: generate a small, fixed set of responsive WebP variants on demand and reuse them across future requests.

Cloudflare's Images binding supports stream-based transformations from R2 object bodies and can return a response body that the Worker writes back into R2. This lets us keep originals in the canonical GCS/R2 layout while treating generated variants as deterministic cache artifacts.

Deletes now need to account for persisted variants. Without deleting generated variants alongside the original, stale WebP objects could remain in R2 after `DELETE /v1/objects/<objectKey>`.

## Decision

The Variant Worker is allowed to write generated variants into the same R2 bucket as originals under:

```text
variants/webp/<variant>/<objectKey-with-webp-extension>
```

The fixed variants for v1 are `thumb`, `w320`, `w640`, `w960`, `w1280`, and `w1600`. Compatibility aliases map `medium` to `w640` and `large` to `w1600`.

The Upload Function owns deletion correctness for these persisted artifacts. After writing the tombstone, `DELETE /v1/objects/<objectKey>` deletes the original R2 key and all known fixed variant keys, then deletes the GCS original. GCS remains the system of record for originals; generated variants are disposable R2 cache artifacts.

## Consequences

**Positive:**

- First request pays transformation cost; later requests are plain R2 reads.
- The variant key contract is deterministic and shared by the Worker and Upload Function without cross-component imports.
- Delete remains idempotent because missing R2 originals or variants are treated as successful deletes.
- The fixed variant set avoids arbitrary transformation URLs and keeps storage cleanup bounded.

**Negative or accepted trade-offs:**

- The Variant Worker is no longer strictly read-only and needs R2 write permission.
- R2 storage usage increases by up to six generated WebP variants per original.
- Any future variant added to the fixed set must also be added to Upload Function deletion logic.
- Cloudflare edge cache purge is still separate from R2 artifact deletion.

## Alternatives considered

- **Pure edge transforms without persistence.** Simpler storage behavior, but repeats transformation work and depends more heavily on edge cache behavior.
- **Pre-generate variants during upload finalize.** Keeps the Worker read-only, but puts image processing back on the upload path and couples Upload Function to transformation concerns.
- **Allow arbitrary `w/h/fit/format` query params.** More flexible, but creates unbounded persisted keys and makes deletion correctness impractical.
- **Store variants in a separate R2 bucket.** Cleaner namespace isolation, but adds another binding, another bucket lifecycle, and no meaningful benefit for v1.

## Related

- Spec section: `docs/spec.md` §2.3.6, §3
- Related ADRs: 0001
