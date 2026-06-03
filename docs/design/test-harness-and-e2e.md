# Design: Test Harness and End-to-End Test Suite

- **Status:** Draft / proposal
- **Date:** 2026-06-03
- **Author:** Quentin Rider
- **Scope:** How to build the Test Harness (spec §6) and the end-to-end test layer (AGENTS.md testing §) for the image upload system.

## 1. Purpose

The system has solid component-level tests (~106 unit/integration cases: 80 in `upload-function`, 26 in `variant-worker`) but no full-stack coverage. Two artifacts are missing, and they are commonly conflated:

- **Test Harness** — a *runnable reference application* (spec §6) that demonstrates both ingestion flows the way a real consumer would, including the database write the Upload Function deliberately does not do. It is a demo/integration target operated by a human, not a test runner.
- **End-to-end (e2e) suite** — *automated* tests that drive the real wire (HTTP → GCS → R2 → Worker) and assert behavior, defined in AGENTS.md as `tests/e2e/` at the repo root, run nightly against staging.

This document covers what each looks like, whether it is feasible, the test-case catalog, the environment strategy, the genuinely hard parts, and a recommended build order.

## 2. Background: current vs planned

| Layer | Location | Status |
|---|---|---|
| Unit | `*.test.ts` next to source | Exists |
| Integration (emulators) | `tests/*.integration.test.ts` per component | Partial (`upload-session-store-redis.integration.test.ts`) |
| Contract (inter-component API) | `tests/contract/` at repo root | Not built |
| End-to-end (full system) | `tests/e2e/` at repo root, nightly | Not built |
| Test Harness (reference app) | `test-harness/` component | Not built; fully specified in spec §6 |

The Upload Widget (spec §5), which the harness embeds, also does not exist yet — a hard dependency for the harness, but **not** for the e2e suite.

## 3. Why this is feasible

The architecture has the seams that make full-stack testing deterministic rather than flaky:

- **Stable, documented error codes** are a public contract (AGENTS.md: "cover every documented error code"). The `UploadErrorCode` and `VariantErrorCode` unions give a ready-made assertion catalog — see §5.
- **Deterministic object keys** (§2.6): a test can compute exactly where bytes land in GCS and R2 and assert presence at the canonical key.
- **Versioned, immutable read URLs** + the `/v1/health` readiness probe make the system predictable to poll and assert against.
- Components are already built behind injectable interfaces (`R2BucketLike`, `ImagesBindingLike`, `CacheLike`), so the per-component layers are covered and the e2e layer only needs to validate the wiring and the real cloud behaviors.

It is feasible. The constraints are concentrated in a few external dependencies (§7), each with a known mitigation.

## 4. The two artifacts

### 4.1 Test Harness (spec §6)

A deployable Vite 6 + React 19 + Tailwind app, single page, two tabs:

- **Tab 1 — Direct upload:** embeds `<artnet-image-uploader>` (§5) → presign → PUT → finalize → writes a row to a test Postgres DB.
- **Tab 2 — S3 ingest:** pick a source URI from the mock vendor R2 bucket (`artnet-mock-vendor-feed`) → `POST /v1/ingest/from-s3` → DB row.
- A `harness-backend/` Node service owns Postgres writes and the recent-uploads panel (the browser cannot talk to Postgres directly). `docker-compose` runs Postgres locally.

Its value is showing the **storage round-trip + the consumer DB write** end to end. It is operated manually; it is not the automated suite. Full layout and schema are in spec §6.3–§6.8.

### 4.2 End-to-end suite

Automated Vitest specs in `tests/e2e/` using native `fetch`, driving deployed (or emulated) services and asserting real responses, replication, and read-path behavior. This is the artifact that gates releases.

## 5. Test-case catalog

These are derived from the spec's documented behaviors and the error-code unions; most already exist as unit/integration cases and only need to be re-expressed over the wire.

### 5.1 Direct upload (Mode A)
- **Happy path:** presign → PUT to signed URL → finalize → `200`, `replicatedToR2: true`; object present at the canonical key in **both** GCS and R2; `publicUrl` is a `/_v/<version>/` URL.
- Content-length lie at finalize → `size_mismatch`.
- File exceeds limit → `file_too_large`.
- Disallowed content type → `unsupported_content_type` / `content_type_mismatch`.
- Missing/incorrect gateway headers → `product_required` / `product_mismatch` / `auction_house_required` / `auction_house_mismatch`.
- Finalize before PUT / expired session → `upload_not_received` / `upload_session_not_found`.
- Session store unreachable → `session_store_unavailable`; too many open sessions → `too_many_sessions`.
- Delete object → tombstone written, object + legacy/versioned variant keys purged from R2 (`tombstone_write_failed` on tombstone failure).

### 5.2 S3 ingest (Mode B)
- **Happy path:** ingest from the mock bucket → `200`, object in GCS + R2, sha256 returned.
- Source bucket outside `S3_SOURCE_ALLOWED_BUCKETS` → `invalid_source`.
- Source object missing → `source_not_found`; source endpoint unreachable → `source_unavailable`.
- Corrupted / non-image bytes → handled per spec.

### 5.3 Read path (Variant Worker)
- Original fetch → `200`, original bytes + content type.
- `?variant=w640` → WebP, expected dimensions; `X-Cache: MISS` / `X-Cache-Source: images` first, then `HIT` / `edge` on repeat.
- Versioned `/_v/<cacheVersion>/...?variant=…` → persisted versioned variant.
- Cache-version mismatch → `404 image_not_found` (anti-amplification guard).
- Unsupported/empty variant or extra query param → `400 invalid_variant`.
- Legacy `…i.jpg` / `…o.jpg` → rewritten to `thumb` / `large`.

### 5.4 Cross-cutting
- `/v1/health` returns `200` only when GCS, R2, S3 source, and the session store are reachable.
- Every code in `UploadErrorCode` / `VariantErrorCode` is asserted at least once — error codes are the contract.

> There is no separate hand-maintained "test case" document, and there should not be: the catalog above is generated from the spec + error-code unions, which stay authoritative.

## 6. Environment strategy

Two tiers, because no single environment covers everything cheaply.

### 6.1 Tier 1 — Local "integration-e2e" (CI, no cloud creds)
- `fake-gcs-server` (GCS), MinIO or an R2 emulator (object store), Postgres in Docker (harness DB), `@cloudflare/vitest-pool-workers` for the Worker.
- Covers ingestion, replication, storage layout, delete/tombstones, and read-path routing/caching.
- **Does not** cover real Cloudflare Images transforms or real GCS V4 signing fidelity (see §7).

### 6.2 Tier 2 — e2e against a deployed lower environment (nightly)
- Point `tests/e2e/` at the **QA stack already deployed** in this work: Upload Function `artnet-qa-upload-function` + Worker `artnet-variant-worker-qa` + the `artwork-images` R2 bucket. Cloudflare Images is enabled there (confirmed), so variant generation is genuinely exercised.
- This is the realistic full-stack pass and the release gate.

## 7. The hard parts (and mitigations)

Honest list — these are why "is it even possible" is a fair question:

1. **Cloudflare Images has no local emulator.** Variant *generation* cannot be truly e2e'd offline. Mitigation: cover the transform call with the existing `IMAGES` mock at the unit layer; assert real generation only in Tier 2 against the deployed Worker.
2. **GCS V4 signed URLs.** `fake-gcs-server` signing support is partial. Mitigation: assert the *full* signed-PUT round-trip in Tier 2 against real GCS; in Tier 1, allow the emulator's relaxed signing and assert the request shape.
3. **SSO gate on the read path.** `artworks.artnet-dev.com` sits behind Cloudflare Access. Mitigation: issue a Cloudflare Access **service token** (`CF-Access-Client-Id` / `CF-Access-Client-Secret`) for the e2e runner, or assert against the Worker's non-gated route. (This is the same friction already seen when curling the read path.)
4. **Redis.** The QA Upload Function currently runs `SESSION_STORE=memory` (single instance) for convenience; faithful session e2e needs a real Redis (Memorystore/Upstash) so multi-instance session lookup is exercised.
5. **Determinism & cleanup.** e2e writes real objects. Mitigation: unique key prefix per run (e.g. an e2e ULID namespace); rely on the existing `staging/uploads/` and `tombstones/` GCS lifecycle rules for teardown; add an explicit cleanup step for canonical keys.

## 8. Recommended phasing

1. **e2e against QA (Tier 2) first.** Buildable now — the stack is deployed. Start with the direct-upload happy path + read-path variant + cache-status assertions, then fill in the error-code matrix. Requires the Access service token (§7.3).
2. **Tier 1 local integration-e2e** for CI gating without cloud creds.
3. **Contract tests** (`tests/contract/`) to pin the inter-component surface (object-key shape, cache-version metadata handshake between finalize and the Worker).
4. **Test Harness** last — it depends on the Upload Widget (§5), which is unbuilt. It is the human-facing demo, not the gate, so it should not block the automated tiers.

## 9. Open questions

- **Access service token vs. ungated test route** for e2e read-path auth (§7.3) — needs a Zero Trust admin decision.
- **Dedicated e2e GCP/R2 namespace vs. reusing QA buckets** — reusing QA risks polluting the demo data; a dedicated prefix or bucket may be cleaner.
- **Mock vendor bucket seeding** (spec §6.6) — confirm the vendor's real S3 layout before mirroring it.
- Whether Tier 1's value justifies the emulator maintenance, given Tier 2 already exists.

## 10. References

- Spec: `docs/spec.md` §2 (Upload Function), §3 (Variant Worker), §6 (Test Harness)
- Testing layers: `AGENTS.md` (Testing)
- Error codes: `upload-function/src/types.ts` (`UploadErrorCode`), `variant-worker/src/errors.ts` (`VariantErrorCode`)
- Related ADRs: 0001 (tombstones), 0002 (persisted variants), 0003 (Redis sessions), 0004 (edge cache + cache-status)
- Deployed QA stack used as the Tier-2 target (Upload Function, Worker, `artwork-images` R2)
