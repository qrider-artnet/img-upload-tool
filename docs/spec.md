# Artnet Image Upload Tool — Engineering Spec (v3)

**Audience:** Claude (or another LLM coding agent), to be handed this document as context for implementation.
**Status:** Draft v3 (replaces v2)
**Replaces:** `LotImageParser.exe` and the legacy `.asp`/`.aspx` image handlers on the `p-image` Windows VM.

### What changed from v2

1. **Upload Function is now a pure storage service.** It does not write to SQL. It accepts images (via presigned upload OR via a new S3 ingest endpoint) and returns the canonical path. Callers are responsible for any database writes.
2. **New `POST /v1/ingest/from-s3` endpoint.** Server-side fetch from an S3-compatible source bucket and replication to GCS + R2. Designed for the vendor scraper pipeline, demo-able against a mock R2 bucket today and swappable to real AWS S3 later.
3. **Test Harness is now a documented deliverable.** A small Vite app with two tabs: direct upload and S3 ingest. Demonstrates both flows end-to-end, including the SQL writes that production callers would do. Real, deployable, maintainable as the reference implementation forever.
4. **Reconciliation simplified.** The "DB orphans" pass disappears since the Upload Function no longer owns DB rows. Reconciliation is now purely GCS↔R2 drift correction.

### Why these changes

The Upload Function gains a third distinct caller (vendor scraper pipeline via S3 ingest), in addition to the auction-house user flow and the future PDB-integrated upload UI. Each caller has different SQL needs — different tables, different fields, different auth. Forcing all three through a single SQL write inside the Function would either reduce the schema to lowest-common-denominator or require conditional logic in the Function. Both are bad.

Decoupling SQL from the Function gives a tight, testable contract: "given an image, put it in GCS + R2, return where it landed." That contract is reusable across all three callers without compromise.

---

## How to use this document

This is an engineering spec, not a product brief. It is structured so that an LLM coding agent can implement each component in isolation. The spec defines:

1. The system's components and how they fit together.
2. Concrete API contracts (request/response shapes, headers, error envelopes).
3. Storage layout and object key conventions.
4. Failure handling, retries, monitoring, and operational requirements.
5. The framework-agnostic upload widget.
6. A real Vite-based test harness that exercises both flows.

When implementing, treat each numbered section as a self-contained task. Sections cross-reference each other where they must agree on a contract; those contracts are authoritative.

When something is genuinely undecided, the spec says so explicitly with a `**TBD:**` marker. Do not invent answers to TBDs — flag them and ask.

---

## 1. Context and goals

### 1.1 Why this exists

The legacy system is a Windows Server 2012 VM running a .NET image processor (`LotImageParser.exe`). It accepts uploads, generates three on-disk variants (`<id>.jpg`, `<id>i.jpg`, `<id>o.jpg`), writes a SQL update file consumed by a downstream job, and serves images via classic ASP/ASP.NET handlers (`picture.asp`, `Picture.aspx`). The variants are low-quality. The OS is end-of-life. The disk is 65 TB of which ~30 TB is used.

A separate migration effort (the "p-image migration") is moving the historical image data into Google Cloud Storage and then into Cloudflare R2. This spec covers the **new tool that replaces the upload and serving paths**, not the migration of historical data.

### 1.2 Volume and sizing

Expected steady-state: **~500 image uploads per day** across all callers, with bursty patterns aligned to auction-house working hours. Each upload is one image; lots typically have 1–5 images each (multi-image lots use `_1`, `_2` suffixes per §2.6).

This is low volume. The architecture is sized accordingly. Synchronous patterns that would be inappropriate at 50,000+ uploads/day are completely fine here. If volume grows by an order of magnitude or more, async replication is a refactor (~1 week of work), not a rebuild.

### 1.3 Goals

- Accept new lot images from auction-house users (direct upload) and from the vendor scraper pipeline (S3 ingest).
- Store originals in GCS (primary, system of record) and replicate to R2 (serving cache).
- Generate variants (thumbnail, medium, large) **on demand**, not pre-baked at upload time.
- Provide a framework-agnostic upload widget that drops into any consumer site.
- Provide a real, deployable test harness that exercises both flows.
- Be observable, retryable, and reconcilable.
- Keep the Upload Function a pure storage service — no database coupling.

### 1.4 Non-goals

- Not migrating historical image data. That is a separate workstream.
- Not building an admin UI. The widget is for end-user upload only; the test harness is for development/demo, not end-users.
- Not writing to any application database (`LotTable` or successor) from the Upload Function. Callers handle their own DB writes.
- Not handling video, PDFs, or non-image assets.

### 1.5 End-state architecture

```
┌────────────────────────┐
│ Auction-house user     │       ┌─────────────────────┐       ┌─────────────────────┐
│ in any consumer site   │       │ Vendor scraper      │       │ Test Harness        │
└──────────┬─────────────┘       │ pipeline (existing) │       │ (Vite app, demo)    │
           │                     └──────────┬──────────┘       └──────┬──────┬───────┘
           │ <artnet-image-uploader>        │                         │      │
           │                                │ POST /ingest/from-s3    │      │
           │                                │                         │      │
           ▼                                ▼                         ▼      ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│                           Upload Function                                        │
│                  (Cloud Run Functions, Node.ts — pure)                           │
│                                                                                  │
│  POST /v1/uploads/presign       → presigned GCS PUT URL                          │
│  POST /v1/uploads/:id/finalize  → verify GCS object + replicate to R2            │
│  DELETE /v1/uploads/:id         → cancel                                         │
│  POST /v1/ingest/from-s3        → server-side fetch from S3, write GCS + R2      │
│  GET  /v1/health                                                                 │
│                                                                                  │
│  Returns objectKey + publicUrl. Does NOT write to any application database.      │
└────────────┬──────────────────────────────────────────────────┬──────────────────┘
             │                                                  │
             ▼                                                  ▼
       ┌──────────┐                                      ┌──────────┐
       │   GCS    │                                      │    R2    │
       │(primary) │◀── reconciliation backfills ────────▶│(serving) │
       └──────────┘                                      └─────┬────┘
                                                               │
              ┌────────────────────────┐                       ▼
              │ End user requests      │            ┌──────────────────────┐
              │ image URL              │───────────▶│ Variant Worker (CF)  │
              └────────────────────────┘            │ + Images binding     │
                                                    └──────────────────────┘

Source for /ingest/from-s3:
  - Production: real AWS S3 (vendor's bucket)
  - Demo / today: mock R2 bucket (S3-compatible, swap by config)

Daily reconciliation job (Cloud Scheduler → Cloud Run Function):
  - Diff GCS vs R2; backfill any drift
```

Components:

- **§2 Upload Function** — pure storage service (Cloud Run Functions, HTTP-triggered).
- **§3 Variant Worker** — on-demand variant generation and serving (Cloudflare Worker, fronts R2).
- **§4 Reconciliation Function** — daily GCS↔R2 drift correction (Cloud Run Function, schedule-triggered).
- **§5 Upload Widget** — framework-agnostic Web Component for end-user upload.
- **§6 Test Harness** — Vite app demonstrating both flows, including SQL writes that callers would do in production.

Operations and monitoring concerns are in **§7**.

---

## 2. Upload Function (pure storage service)

### 2.1 Responsibilities

Single Cloud Run Function exposing five HTTP endpoints. Two ingestion modes:

- **Mode A: Direct upload.** Issues GCS signed URLs for client-direct PUT, then finalizes (verify + replicate to R2). Used by the upload widget and any UI flow.
- **Mode B: S3 ingest.** Server-side fetch from an S3-compatible source bucket, then writes GCS + R2. Used by the vendor scraper pipeline.

In both modes, the Function:

- Stores the object in GCS at the canonical key (§2.6).
- Replicates to R2 synchronously (§2.9).
- Returns the canonical `objectKey` and `publicUrl`.
- **Does not write to any application database.**

### 2.2 Tech stack

- **Runtime:** Cloud Run Functions, Node.js 22 LTS, TypeScript
- **Trigger:** HTTPS
- **Region:** `us-east4`
- **VPC:** attached to the same VPC as Cloud SQL (the Function doesn't talk to SQL itself, but VPC attachment keeps egress private and lets future maintenance work happen without re-architecting networking) — **TBD: confirm this is desired or skip VPC attachment entirely**
- **Concurrency:** 80 (default)
- **Min instances:** 1 — at ~500/day with bursty traffic, eliminating cold-starts costs single-digit dollars/month and is worth it for upload UX
- **Max instances:** 10 (more than enough headroom)
- **Memory:** 512 MB
- **Timeout:** 60 seconds (S3 ingest of multi-MB files dominates wall time)
- **Framework:** Hono router, or `@google-cloud/functions-framework` HTTP handler with a small router

#### Dependencies

- `@google-cloud/storage` — GCS signed URLs and object operations
- `@aws-sdk/client-s3` — used for both R2 (replication target) and S3 source ingest. Two configured client instances.

No database driver. No DB connection pool. The Function never talks to Cloud SQL.

### 2.3 Endpoints

All endpoints return `application/json`. All errors use the envelope in §2.8.

#### 2.3.1 `POST /v1/uploads/presign`

Request a signed GCS upload URL.

**Request:**

```json
{
  "kind": "auction-lot",
  "auctionHouseId": "425939177",
  "auctionDate": "20260310",
  "lotId": "638775",
  "imageId": "195",
  "imageVariantSuffix": null,
  "contentType": "image/jpeg",
  "contentLength": 1024576
}
```

Field semantics:

- `kind`: entity discriminator. Supported values are `gallery-artwork`, `auction-lot`, and `pdb-artwork`.
- `gallery-artwork`: requires `galleryId`, `artworkId`, and `imageId`.
- `auction-lot`: requires `auctionHouseId`, `auctionDate`, `lotId`, and `imageId`.
- `pdb-artwork`: requires `pdbArtworkId` and `imageId`.
- Entity fields form the object key (see §2.6).
- `imageVariantSuffix`: `null` for the primary image of a lot. `"_1"`, `"_2"`, etc. for additional images.
- `contentType`: must be `image/jpeg`, `image/png`, or `image/webp`.
- `contentLength`: bytes. Reject if > 50 MB.

**Response (200):**

```json
{
  "uploadId": "01JF8T7P2C9X4MWXYZ",
  "objectKey": "products/artnet-auctions/auction-lots/425939177/20260310/638775/images/195.jpg",
  "uploadUrl": "https://storage.googleapis.com/<signed-v4-url>",
  "uploadHeaders": {
    "Content-Type": "image/jpeg",
    "Content-Length": "1024576"
  },
  "expiresAt": "2026-05-07T18:30:00Z"
}
```

Behavior:

1. Validate trusted gateway context (§2.5). Validate request body. Compute `objectKey` per §2.6.
2. Generate ULID `uploadId`.
3. Compute a private staging key: `staging/uploads/<uploadId>/<objectKey>`. This is where the signed URL writes bytes before finalize.
4. Store the upload session record in Redis using `uploadId` as the lookup key and a TTL equal to the signed URL lifetime. The record contains the computed `objectKey`, staging key, product/auction context, expected content type and length, and `expiresAt`. Local development may omit Redis and use an in-process fallback, but horizontally scaled deployments must provide Redis. See ADR `docs/decisions/0003-redis-upload-sessions.md`.
5. Generate a v4 signed PUT URL for GCS valid 15 minutes, scoped to the staging key. Use `@google-cloud/storage`'s `getSignedUrl({ version: 'v4', action: 'write', ... })`.
6. Return the upload session.

#### 2.3.2 `POST /v1/uploads/:uploadId/finalize`

Called by the client after the direct PUT to GCS succeeds.

**Request:** body is empty.

**Response (200):**

```json
{
  "objectKey": "products/artnet-auctions/auction-lots/425939177/20260310/638775/images/195.jpg",
  "publicUrl": "https://artworks.artnet.com/_v/01ARZ3NDEKTSV4RRFFQ69G5FAV/products/artnet-auctions/auction-lots/425939177/20260310/638775/images/195.jpg",
  "size": 1024576,
  "contentType": "image/jpeg",
  "uploadedAt": "2026-05-07T18:15:32.412Z",
  "replicatedToR2": true
}
```

The response includes everything a caller needs to write its own DB row. Callers do not need to refetch metadata from GCS; the finalize response is the authoritative record.

Behavior:

1. Look up the session. If missing or expired → `404 upload_session_not_found`.
2. HEAD the staged GCS object. If missing → `409 upload_not_received`.
3. Verify size matches session value → `400 size_mismatch` on mismatch.
4. Verify stored content type matches the presign request when GCS reports a content type.
5. Do not compute or return a direct-upload checksum. The signed URL, exact content-length constraint, content-type check, and GCS transport integrity are sufficient for v1.
6. Copy/promote the staged object to the canonical `objectKey`, then delete the staged object.
7. Return `publicUrl` as a cache-versioned path: `/_v/<uploadId>/<objectKey>`. The canonical storage key remains `objectKey`; the version exists only in the public URL/cache key.
8. Replicate the canonical object to R2 (§2.9). Best-effort: log on failure, set `replicatedToR2: false`, but do not fail the finalize.
9. Delete the upload session record.
10. Return success with all metadata.

If R2 replication fails, the response still returns 200 with `replicatedToR2: false`. The caller can decide whether to surface this to the user; the reconciliation function will repair it later.

#### 2.3.3 `DELETE /v1/uploads/:uploadId`

Cancel an in-flight upload.

**Response (204):** no body.

Behavior:

1. Look up the upload session. If present, enforce the trusted product/auction context.
2. Delete the staged GCS object. 404 is treated as success.
3. Delete the upload session record.

If the client abandons the upload without calling cancel or finalize, the Redis session expires after the signed URL TTL and GCS lifecycle deletes `staging/uploads/` objects after **5 days**.

#### 2.3.4 `POST /v1/ingest/from-s3`

Server-side fetch from an S3-compatible source and replicate to GCS + R2.

**Request:**

```json
{
  "sourceUri": "s3://artnet-vendor-feed/scrape-2026-05-08/425939177/lot-638775-img-1.jpg",
  "objectKey": "lot_images/425939177/20260310/638775/195.jpg",
  "contentType": "image/jpeg"
}
```

Field semantics:

- `sourceUri`: `s3://<bucket>/<key>` — bucket name and object key in the source S3-compatible store. The Function uses its configured S3 source client to fetch this object (see §2.4).
- `objectKey`: the canonical destination key. Caller is responsible for constructing this per §2.6 conventions.
- `contentType`: optional. If omitted, the Function uses the source object's `Content-Type` header.

**Response (200):**

```json
{
  "objectKey": "lot_images/425939177/20260310/638775/195.jpg",
  "publicUrl": "https://artworks.artnet.com/_v/01ARZ3NDEKTSV4RRFFQ69G5FAV/lot_images/425939177/20260310/638775/195.jpg",
  "size": 1024576,
  "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "contentType": "image/jpeg",
  "sourceUri": "s3://artnet-vendor-feed/scrape-2026-05-08/425939177/lot-638775-img-1.jpg",
  "uploadedAt": "2026-05-07T18:15:32.412Z",
  "replicatedToR2": true
}
```

Same core metadata as the finalize response, plus `sourceUri` for traceability and a server-computed `sha256` because this path streams the bytes through the Function.

Behavior:

1. Validate that the request reached the Function through the API Gateway boundary (§2.5).
2. Validate `objectKey` per §2.6 rules.
3. Parse `sourceUri`; reject if scheme isn't `s3://` or bucket isn't on the configured source allowlist with `400 invalid_source`.
4. HEAD the source object via the configured S3 source client. On 404 → `404 source_not_found`. On other errors → `502 source_unavailable`.
5. Reject if size > 50 MB → `400 file_too_large`.
6. Reject if `Content-Type` (from source or override) not in allowed list → `400 unsupported_content_type`.
7. Stream from S3 source → write to GCS at `objectKey`. Compute SHA-256 in-stream so we don't double-buffer.
8. Generate a ULID cache version for the returned `publicUrl`.
9. Replicate to R2 synchronously (§2.9).
10. Return the response.

The Function does not delete the source S3 object after ingest. The vendor pipeline's lifecycle is its own concern.

#### 2.3.5 `GET /v1/health`

Returns 200 if the Function can reach GCS, the configured S3 source, R2, and the upload session store. In deployed environments the session store is Redis; in local development it may be the in-process fallback. Used by uptime monitoring.

#### 2.3.6 `DELETE /v1/objects/<objectKey>`

Delete a finalized image from both GCS and R2.

The path tail is the full canonical object key (§2.6), e.g. `DELETE /v1/objects/lot_images/425939177/20260310/638775/195.jpg`.

**Request:** body is empty. `X-Artnet-Product-Id` header required (see §2.5.1) and must match the product encoded in the object key. For auction-lot keys, `X-Artnet-Auction-House-Id` is also required and must match the `auctionHouseId` segment of the object key — otherwise `403 auction_house_mismatch`.

**Response (204):** no body.

Behavior:

1. Validate the path against the object-key shape from §2.6. Reject malformed keys with `400 invalid_request`.
2. Write a tombstone marker at `tombstones/<objectKey>.json` (see §2.12). Tombstone writes are idempotent; an existing tombstone is overwritten.
3. Delete the object, legacy unversioned WebP variant keys, and every cache-versioned WebP variant prefix from R2 with the retry policy in §2.10. 404 treated as success. Known variant keys and prefixes are derived from §3.3.
4. Delete the object from GCS with the retry policy in §2.10. 404 treated as success.
5. Return 204.

The endpoint is **idempotent** — repeat calls on the same key return 204 with no side effect beyond a refreshed tombstone. If any step fails after retries, the function returns 503; the caller retries safely.

Step ordering is tombstone → R2 → GCS so that even if a later step fails and the reconciliation function (§4) runs against the in-progress state, it observes the tombstone and skips backfill.

Legacy unversioned persisted variant keys use:

```
variants/webp/<variant>/<objectKey-with-webp-extension>
```

Cache-versioned persisted variant keys use:

```
variants/webp/<variant>/<objectKey-without-extension>/_v/<cacheVersion>.webp
```

Delete removes all known fixed variant prefixes for the object, including versioned variants from prior uploads.

### 2.4 S3 source configuration (swappable)

The S3 source client is configured by environment variables and Secret Manager values. The Function does not branch on "is this real AWS or mock R2" — they're functionally identical at the SDK level.

```typescript
const s3Source = new S3Client({
  endpoint: process.env.S3_SOURCE_ENDPOINT, // e.g. https://<acct>.r2.cloudflarestorage.com (mock)
  //   or https://s3.us-east-1.amazonaws.com (prod)
  region: process.env.S3_SOURCE_REGION, // 'auto' for R2, 'us-east-1' (etc) for AWS
  credentials: {
    accessKeyId: secret("s3-source-access-key-id"),
    secretAccessKey: secret("s3-source-secret-access-key"),
  },
  forcePathStyle: true, // R2 needs this; AWS tolerates it
});
```

Two deployment configs:

| Config                 | Endpoint                                     | Region            | Credentials                                                                     |
| ---------------------- | -------------------------------------------- | ----------------- | ------------------------------------------------------------------------------- |
| **Demo**               | `https://<account>.r2.cloudflarestorage.com` | `auto`            | R2 access key for the mock bucket                                               |
| **Production (later)** | `https://s3.<region>.amazonaws.com`          | actual AWS region | AWS IAM credentials (ideally via workload identity federation, not static keys) |

Same code in both. Swap is a config change, not a code change.

`S3_SOURCE_ALLOWED_BUCKETS` env var holds a comma-separated list of accepted source bucket names. Requests with `sourceUri` referencing a bucket outside that list are rejected. This prevents accidental cross-tenant fetches if credentials are over-broad.

**TBD: confirm vendor bucket name and AWS region** with the team that owns the scraper pipeline. The mock R2 bucket should be named to mirror the eventual production name (e.g., `artnet-vendor-feed`), so the swap is endpoint-and-credentials-only.

### 2.5 Authentication and gateway boundary

Authentication and admission control happen **upstream at the API Gateway**, not inside the Upload Function.

The Function assumes it is only reachable from the gateway or trusted internal infrastructure. It does not verify bearer tokens, issue tokens, inspect browser sessions, or distinguish user-token signing keys from service-token signing keys.

The gateway owns:

- Verifying end-user authentication for `/v1/uploads/*` and `DELETE /v1/objects/*`.
- Verifying service-to-service authentication for `/v1/ingest/from-s3`.
- Enforcing route-level authorization: user upload callers cannot call ingest routes, and ingest callers cannot call user upload routes.
- Stripping any client-supplied trusted headers before injecting its own values.
- Applying rate limits (§2.11) using the authenticated upstream principal.
- Forwarding only requests that passed authentication and authorization.

#### 2.5.1 Trusted user upload context

For `/v1/uploads/*` and `DELETE /v1/objects/*`, the gateway must inject:

```text
X-Artnet-Product-Id: <galleries|artnet-auctions|pdb>
X-Artnet-Auction-House-Id: <auctionHouseId>  # auction-lot only
```

The Function treats these headers as trusted only because the gateway strips any inbound client value and replaces it after authentication. Browsers and direct clients must not be allowed to set these headers authoritatively.

The Function enforces the trusted product context against:

- `gallery-artwork` → `galleries`
- `auction-lot` → `artnet-auctions`
- `pdb-artwork` → `pdb`

Missing trusted product context returns `403 product_required`. Mismatched product context returns `403 product_mismatch`.

For `auction-lot` requests and object keys, the Function also enforces the trusted auction-house context against:

- The `auctionHouseId` field in `POST /v1/uploads/presign`.
- The upload session's stored `auctionHouseId` in `POST /v1/uploads/:uploadId/finalize`.
- The upload session's stored `auctionHouseId` in `DELETE /v1/uploads/:uploadId`.
- The `auctionHouseId` path segment in `DELETE /v1/objects/<objectKey>`.

Missing trusted auction-house context returns `403 auction_house_required`. Mismatched context returns `403 auction_house_mismatch`. Gallery and PDB uploads do not require auction-house context.

#### 2.5.2 Trusted service ingest context

For `/v1/ingest/from-s3`, the gateway must authenticate the vendor scraper pipeline or other approved service caller before forwarding the request. The Function does not need a user auction-house header on this route because ingest authorization is service-level, and the request body already carries the destination `objectKey`.

The Function still validates the destination key shape and the source bucket allowlist (§2.4). The gateway remains responsible for preventing unapproved callers from reaching the ingest route.

### 2.6 Object key convention

New direct uploads use product-prefixed keys:

```
products/galleries/artworks/<galleryId>/<artworkId>/images/<imageId>[<variantSuffix>].<ext>
products/artnet-auctions/auction-lots/<auctionHouseId>/<auctionDate>/<lotId>/images/<imageId>[<variantSuffix>].<ext>
products/pdb/artworks/<pdbArtworkId>/images/<imageId>[<variantSuffix>].<ext>
```

Legacy unprefixed auction keys remain valid for existing images:

```
lot_images/<auctionHouseId>/<auctionDate>/<lotId>/<imageId>[<variantSuffix>].<ext>
```

Examples:

- `products/galleries/artworks/gallery-1/artwork-1/images/195.jpg`
- `products/artnet-auctions/auction-lots/425939177/20260310/638775/images/195.jpg`
- `products/pdb/artworks/pdb-123/images/195.jpg`
- `lot_images/425939177/20260310/638775/195.jpg`
- `lot_images/425939177/20260310/638775/195_1.jpg`

Rules:

- All path segments URL-safe (`^[A-Za-z0-9_-]+$`).
- `imageId` is a string — preserve leading zeros.
- Extension derived from `contentType` (lowercase): `image/jpeg` → `.jpg`, `image/png` → `.png`, `image/webp` → `.webp`.
- Same canonical key in GCS and R2 after finalize or S3 ingest.
- Direct-upload signed URLs write first to `staging/uploads/<uploadId>/<objectKey>`. Only finalize promotes that staged object to the canonical key.
- Legacy `<id>i.jpg`/`<id>o.jpg` are NOT stored; generated on-demand by the Variant Worker (§3).

### 2.7 No database integration

The Upload Function does not connect to or write to any application database. This is intentional — see §1.5 reasoning.

Callers handle their own DB writes:

- **Auction-house user flow:** the consumer site (or a layer in front of the upload widget) writes to `LotTable` (or its successor) using the finalize response.
- **Vendor scraper pipeline:** the existing automation that processes scraper output writes whatever DB rows it needs after calling the ingest endpoint.
- **Test Harness:** writes to a test database to demonstrate the full flow (§6).

Schema, table placement, and consumer integration are **TBD** and out of scope for this spec — they belong to the consumer specs.

### 2.8 Error envelope

All non-2xx responses use:

```json
{
  "error": {
    "code": "size_mismatch",
    "message": "Uploaded file size does not match the presign request.",
    "details": { "expected": 1024576, "actual": 99 }
  },
  "requestId": "01JF8T7P2C9X4MWXYZ"
}
```

`code` is a stable machine-readable identifier. `message` is human-readable. `details` optional.

### 2.9 R2 replication during finalize and ingest

Both `finalize` and `ingest/from-s3` replicate to R2 in the same request:

1. Read the GCS object as a stream (or pass through the in-memory bytes if we just wrote them).
2. PUT to R2 at the same `objectKey` using the S3-compatible API. Include custom metadata `cache-version=<uploadId or ingest cacheVersion>` so the Variant Worker can reject arbitrary versioned paths instead of generating unbounded variant keys.
3. On success, set `replicatedToR2: true` in the response.
4. On failure (R2 5xx, network, timeout): log with `event=r2_replication_failed` and the `objectKey`. Return `replicatedToR2: false`. Reconciliation (§4) will repair.

Why synchronous: at ~500 uploads/day, the R2 PUT (typically <500ms for sub-MB objects) is acceptable in the user-facing path. Eliminates an entire async pipeline.

R2 client config (separate from the S3 source client):

- Endpoint: `https://<account-id>.r2.cloudflarestorage.com`
- Region: `auto`
- Credentials from Secret Manager: `r2-access-key-id`, `r2-secret-access-key`
- `forcePathStyle: true`

### 2.10 Error handling and retries

- Transient GCS errors: retry up to 3 times with exponential backoff (100ms, 400ms, 1.6s).
- Transient R2 errors: same. After exhaustion, set `replicatedToR2: false` and continue.
- Transient S3 source errors during ingest: retry once after 500ms. After exhaustion, return `502 source_unavailable`.

### 2.11 Rate limiting

- User upload routes (`/v1/uploads/*`): 60 presign/min, 600/hour per authenticated user principal.
- Service ingest route (`/v1/ingest/from-s3`): 60/min, 5000/day per authenticated service principal.

Implement via Cloud Armor in front of Cloud Run, not in-Function logic.

### 2.12 Deletion tombstones

When the Upload Function processes `DELETE /v1/objects/...` (§2.3.6), it writes a tombstone to GCS before touching the canonical object. The tombstone is the durable record that a delete was intentional, so the Reconciliation Function (§4) does not undo it.

**Path:**

```
tombstones/<objectKey>.json
```

**Payload:**

```json
{
  "objectKey": "lot_images/425939177/20260310/638775/195.jpg",
  "deletedAt": "2026-05-15T12:34:56.789Z",
  "deletedBy": "425939177",
  "requestId": "01JF8T7P2C9X4MWXYZ"
}
```

**Lifecycle:** GCS lifecycle policy on the `tombstones/` prefix expires markers after **7 days** — longer than the reconciler's 48-hour modified-objects window (§4.3), short enough to keep the namespace tidy. The Function does not delete tombstones from code.

**Reconciler contract:** before backfilling R2 from GCS (§4.3 step 3), the reconciler **must** check `tombstones/<objectKey>.json`. If it exists, skip the copy. This is the only mechanism that prevents the reconciler from re-creating a deleted R2 object.

The ADR `docs/decisions/0001-deletion-tombstones.md` records the alternatives considered and trade-offs accepted.

### 2.13 Reference examples

`upload-function/examples/` contains compile-checked reference snippets for applications that call the Upload Function directly. These examples are not a production gateway and do not replace the upstream authorization boundary in §2.5; they show how internal callers should shape requests, consume responses, and persist returned metadata in their own systems.

Files:

- `upload-client.ts` — low-level `fetch` helpers for presign, finalize, S3 ingest, and finalized-object deletion.
- `use-cases.ts` — higher-level reference helpers for common caller workflows.
- `use-cases.md` — copyable snippets that demonstrate the same workflows with expected integration points.

Covered use cases:

- Auction lot direct upload.
- Gallery artwork direct upload.
- PDB artwork direct upload.
- Vendor S3 ingest.
- Finalized image deletion.
- Rendering public original and variant URLs from the returned `publicUrl`.

`npm run examples:build` validates the examples in isolation. `npm run check` for `upload-function/` also typechecks the examples so snippets do not drift from the API contracts.

---

## 3. Variant Worker (write-through read path)

### 3.1 Responsibilities

Serve originals and fixed WebP variants from R2. Variants are generated on demand from R2 originals with Cloudflare's Images binding, persisted back into R2, and served from the persisted object on subsequent requests. Replaces legacy on-disk variants.

### 3.2 Tech stack

- **Runtime:** Cloudflare Workers
- **Language:** TypeScript
- **Image transformation:** Cloudflare Images binding for stream-based transforms
- **Bindings:**
  - `R2_PRIMARY` — R2 bucket binding
  - `IMAGES` — Cloudflare Images binding
- **CDN:** persisted R2 variants are the primary cache layer; Cloudflare edge cache can additionally cache by full URL

### 3.3 URL scheme

Bound to `artworks.artnet.com`:

```
GET /<objectKey>                          → original from R2
GET /<objectKey>?variant=thumb            → 150x150 WebP, fit=cover, q=70
GET /<objectKey>?variant=w320             → 320w WebP, fit=scale-down, q=82
GET /<objectKey>?variant=w640             → 640w WebP, fit=scale-down, q=82
GET /<objectKey>?variant=w960             → 960w WebP, fit=scale-down, q=82
GET /<objectKey>?variant=w1280            → 1280w WebP, fit=scale-down, q=82
GET /<objectKey>?variant=w1600            → 1600w WebP, fit=scale-down, q=82
GET /_v/<cacheVersion>/<objectKey>        → original from R2, versioned URL for immutable caching
GET /_v/<cacheVersion>/<objectKey>?variant=w640 → versioned persisted WebP variant
```

Compatibility aliases:

| Alias            | Canonical variant |
| ---------------- | ----------------- |
| `variant=medium` | `w640`            |
| `variant=large`  | `w1600`           |

Generated variants are stored in the same R2 bucket. Unversioned requests use the legacy key:

```
variants/webp/<variant>/<objectKey-with-webp-extension>
```

Example:

```
variants/webp/w640/lot_images/425939177/20260310/638775/195.webp
```

Cache-versioned requests use:

```
variants/webp/<variant>/<objectKey-without-extension>/_v/<cacheVersion>.webp
```

Example:

```
variants/webp/w640/lot_images/425939177/20260310/638775/195/_v/01ARZ3NDEKTSV4RRFFQ69G5FAV.webp
```

### 3.4 Behavior

1. Parse query params; reject unknown query params or unsupported variants with `400 invalid_variant`.
2. If the path starts with `/_v/<cacheVersion>/`, strip that prefix and carry `cacheVersion` into the variant-key calculation. Validate the remaining object key shape locally using §2.6 rules. Do not import from the Upload Function.
3. For requests without `variant`, read `<objectKey>` from R2 and return the original bytes. Preserve the original content type when present.
4. For variant requests, compute the persisted variant key from §3.3 and check R2 first.
5. On variant hit, return the stored WebP with `Content-Type: image/webp`.
6. On variant miss, read the original from R2. If missing, return `404 image_not_found`. There is no GCS read-through fallback in v1; reconciliation repairs drift.
7. For a cache-versioned miss, verify the original R2 object has matching `cache-version` custom metadata before transforming. This prevents arbitrary public version strings from creating unbounded persisted variant keys.
8. Transform the original stream with the `IMAGES` binding, store the generated WebP at the persisted variant key, and return the generated bytes.
9. Use `Cache-Control: public, max-age=31536000, immutable` for originals and variants.
10. Cache busting on re-upload is path-based: callers should use the `publicUrl` returned by finalize, which includes `/_v/<uploadId>/`. No edge purge is required for those versioned URLs. Canonical unversioned URLs remain supported for compatibility and may be purged separately if a caller still uses them.

### 3.5 Backward-compatible URL rewrites

Legacy `<id>i.jpg`/`<id>o.jpg` URLs translate for legacy `lot_images/...` auction paths and product-prefixed `products/artnet-auctions/auction-lots/...` paths:

| Legacy URL pattern | Internal mapping                         |
| ------------------ | ---------------------------------------- |
| `/<base>/<n>.jpg`  | `/<base>/<n>.jpg` (no change — original) |
| `/<base>/<n>i.jpg` | `/<base>/<n>.jpg?variant=thumb`          |
| `/<base>/<n>o.jpg` | `/<base>/<n>.jpg?variant=large`          |

**TBD: confirm resolution mapping** against actual size distributions.

---

## 4. Reconciliation Function

### 4.1 Responsibilities

Daily scheduled job that corrects GCS↔R2 drift.

### 4.2 Tech stack

- **Runtime:** Cloud Run Functions, Node.js 22 LTS, TypeScript
- **Trigger:** Cloud Scheduler → HTTPS
- **Schedule:** daily at 03:00 UTC
- **Region:** `us-east4`
- **Timeout:** 540 seconds
- **Memory:** 512 MB

### 4.3 Reconciliation pass

Single GCS↔R2 drift correction:

1. List GCS objects modified in the last 48 hours.
2. For each, HEAD the corresponding R2 object.
3. If R2 missing or size differs:
   - **First check `tombstones/<objectKey>.json`** (spec §2.12). If a tombstone exists, this was an intentional delete — skip the copy and emit `reconciliation.tombstone_respected`. Do not backfill R2 from GCS.
   - Otherwise, copy from GCS to R2 and emit `reconciliation.r2_backfilled`.
4. Emit metrics: `reconciliation.r2_backfilled`, `reconciliation.tombstone_respected`, `reconciliation.r2_already_in_sync`.

The 48-hour window covers anything the synchronous replication missed. **TBD: weekly full-bucket sweep frequency** at 30+ TB scale (probably defensive overkill given synchronous replication).

Tombstone-awareness is **mandatory**, not optional — without it, deletes from the Upload Function would be silently undone within 48 hours.

### 4.4 Logging and idempotency

All passes idempotent — re-running on the same data produces the same result. Log structured events for each repair action.

If reconciliation finds > 1% of recent objects need repair, alert (§7) — suggests a systematic synchronous replication issue.

---

## 5. Upload Widget (framework-agnostic)

### 5.1 Responsibilities

A drop-in component that any consumer site can embed. Talks to the Upload Function (§2). No framework dependencies.

### 5.2 Tech stack

- **Format:** Web Component (Custom Element). Standard browser API; works in React, Vue, Angular, Svelte, plain HTML.
- **Language:** TypeScript, compiled to ES2020 + UMD-style global.
- **Bundling:** single `.js` file (~30 KB gzipped target), Shadow DOM scopes styles.
- **No dependencies** beyond browser APIs.

### 5.3 Embedding

```html
<script src="https://cdn.artnet.com/uploader/v1/artnet-image-uploader.js"></script>

<artnet-image-uploader
  endpoint="https://upload.artnet.com"
  auth-token="<gateway-auth-token>"
  auction-house-id="425939177"
  auction-date="20260310"
  lot-id="638775"
></artnet-image-uploader>
```

### 5.4 Attributes

| Attribute          | Required | Description                                                                       |
| ------------------ | -------- | --------------------------------------------------------------------------------- |
| `endpoint`         | yes      | Upload Function base URL                                                          |
| `auth-token`       | yes      | Token presented to the API Gateway; the Upload Function itself does not verify it |
| `auction-house-id` | yes      | Scopes uploads                                                                    |
| `auction-date`     | yes      | YYYYMMDD                                                                          |
| `lot-id`           | yes      | Lot ID                                                                            |
| `max-files`        | no       | Default 50                                                                        |
| `max-file-size-mb` | no       | Default 50                                                                        |
| `accepted-formats` | no       | Default `image/jpeg,image/png,image/webp`                                         |
| `next-image-id`    | no       | Starting integer for auto-naming. Default 1.                                      |
| `theme`            | no       | `light` (default) or `dark`                                                       |

### 5.5 Events

| Event                 | `detail` payload                                                                         | When                    |
| --------------------- | ---------------------------------------------------------------------------------------- | ----------------------- |
| `upload:start`        | `{ file, imageId }`                                                                      | A file begins uploading |
| `upload:progress`     | `{ file, imageId, loaded, total }`                                                       | During upload           |
| `upload:success`      | `{ file, imageId, objectKey, publicUrl, size, contentType, uploadedAt, replicatedToR2 }` | After finalize          |
| `upload:error`        | `{ file, imageId, error }`                                                               | On failure              |
| `upload:all-complete` | `{ uploaded: [...] }`                                                                    | When the queue empties  |

Note `upload:success` carries the full finalize response — host site has everything it needs to do its own DB write.

### 5.6 UX requirements

- Drag-and-drop and file-picker.
- Multi-file with queue.
- Per-file progress bar.
- Per-file retry.
- Client-side preview via `URL.createObjectURL`.
- Reorderable before commit.
- Per-file cancel.
- A11y: keyboard nav, screen-reader labels, focus management.
- Mobile: responsive, camera on mobile.

### 5.7 Upload flow

For each file:

1. POST to `{endpoint}/v1/uploads/presign`.
2. PUT to returned `uploadUrl` (use `XMLHttpRequest` for progress).
3. POST to `{endpoint}/v1/uploads/:uploadId/finalize`.
4. Dispatch `upload:success` with full response payload.

Retry transient errors up to 3 times with backoff. Surface terminal errors with retry buttons.

### 5.8 State management

Plain class fields. No Redux, no signals, no observable libraries. Custom Element lifecycle hooks for setup/teardown.

### 5.9 Styling

Shadow DOM with scoped CSS. CSS custom properties for theming:

```css
--artnet-uploader-bg
--artnet-uploader-border
--artnet-uploader-accent
--artnet-uploader-text
--artnet-uploader-error
--artnet-uploader-radius
```

### 5.10 Distribution

- CDN: `https://cdn.artnet.com/uploader/v1/artnet-image-uploader.js`
- Source in GitHub repo with Changesets versioning.
- TypeScript types as `.d.ts`.

---

## 6. Test Harness

### 6.1 Purpose

A real, deployable Vite app that exercises the Upload Function end-to-end. Demonstrates both ingestion modes plus the SQL writes that production callers would do. It is the canonical runnable reference implementation for the full system.

Lightweight, per-use-case snippets live in `upload-function/examples/` (§2.13). When someone asks "how do I integrate the Upload Function from <my context>?", start with the examples for request/response shape and use the harness for the complete browser + backend + SQL flow.

### 6.2 Tech stack

- **Build tool:** Vite 6+
- **Framework:** React 19 (idiomatic with Vite, broad familiarity, simple)
- **Language:** TypeScript
- **Routing:** none — single page, two tabs (state-driven)
- **Styling:** Tailwind CSS (Vite plugin)
- **State:** plain `useState` / `useReducer`. No Redux, Zustand, etc.
- **HTTP:** native `fetch`. No Axios.
- **DB client:** depends on §6.5.

### 6.3 Layout

Single page, two tabs:

- **Tab 1: "Direct upload"** — drag-and-drop image, watch it flow GCS → R2, then write to test SQL.
- **Tab 2: "S3 ingest"** — paste an S3 path, fetch via Upload Function, then write to test SQL.

Tab state is in `useState`; no router. URL hash optional for deep-linking (`#direct` / `#s3-ingest`).

A small status panel under both tabs shows recent uploads (last 10), pulled from the test database. Demonstrates the round-trip: image landed in storage AND row landed in DB.

### 6.4 Tab 1: Direct upload

Embeds the `<artnet-image-uploader>` Web Component (§5). Behavior:

1. User drags or picks an image.
2. Widget runs the presign → PUT → finalize flow against the Upload Function.
3. On widget's `upload:success` event, harness:
   a. Logs the response.
   b. Writes a row to the test SQL database with the response payload.
   c. Refreshes the recent-uploads panel.

Inputs (form fields above the widget):

- Auction house ID (default: `425939177`)
- Auction date (default: today, YYYYMMDD)
- Lot ID (free text)
- Gateway auth token (env-loaded for dev; pasteable override for testing alternate users)

This tab demonstrates how a consumer site would integrate the widget AND own the DB write.

### 6.5 Tab 2: S3 ingest

Form with these fields:

- S3 source URI (e.g. `s3://artnet-mock-vendor-feed/scrape-2026-05-08/425939177/lot-638775-img-1.jpg`)
- Destination object key (constructed from auction house / date / lot / image ID inputs; can be auto-generated or overridden)
- Service-to-service token (env-loaded)

A "Browse mock bucket" button lists the contents of the mock R2 bucket so users can pick a source URI without typing. **TBD: implement this via a small Vite-side AWS S3 client pointed at the mock bucket, or via a backend listing endpoint?** Direct from the Vite app is simpler for demo; a backend listing endpoint is more production-realistic.

Behavior:

1. User picks/types source URI and destination key.
2. POST to `{uploadFunction}/v1/ingest/from-s3`.
3. On 200, harness writes a row to test SQL with the response payload (note: includes `sourceUri` for traceability).
4. Refreshes recent-uploads panel.

This tab demonstrates how the vendor scraper pipeline would integrate, AND demonstrates that the production code path works against the mock bucket exactly as it will work against real AWS S3 later.

### 6.6 Mock vendor S3 bucket

Setup for the demo:

- **Bucket:** R2 bucket named `artnet-mock-vendor-feed` (mirror the eventual production bucket name)
- **Credentials:** R2 access key with read-only access to the mock bucket
- **Layout:** mirror what the real vendor produces. **TBD: confirm vendor's actual S3 layout** with the scraper team. Reasonable starting structure:
  ```
  s3://artnet-mock-vendor-feed/
    scrape-<YYYY-MM-DD>/
      <auctionHouseId>/
        lot-<lotId>-img-<n>.jpg
        lot-<lotId>-img-<n>.txt
        ...
  ```
- **Seed data:** populate with 20–30 sample auction images, plus a few edge-case files:
  - One with non-ASCII characters in filename
  - One that's not a valid image (corrupted bytes) — to demonstrate error handling
  - One with a `.txt` sidecar to demonstrate ignoring non-image files
  - One large (~10 MB) file
  - One tiny (<10 KB) file

Sample images can be drawn from the existing `p-image` snapshot (still mounted at the time of writing) — copy a small representative set out before tearing down the investigation disk.

When real AWS S3 access is granted later, the harness's S3 ingest tab needs zero code changes — the Upload Function's `S3_SOURCE_*` env vars flip from R2 to AWS, and the harness keeps working.

### 6.7 Test SQL database

The harness needs a database to demonstrate the "consumer writes the DB row" pattern. Two options:

- **Option A: Local Postgres in Docker.** Harness ships with a `docker-compose.yml` that runs Postgres locally. Harness connects from the browser via a small backend proxy (the harness has its own minimal backend if it needs DB access — Vite alone can't talk to Postgres from the browser). Pure local dev experience. Recommended for v1.
- **Option B: Cloud SQL test instance.** More realistic, but adds GCP cost and credentials management for what's primarily a dev tool. Skip unless someone explicitly wants it.

Default to **Option A**: local Postgres via Docker, harness has a small Node backend (`harness-backend/`) that handles DB writes and the recent-uploads query. Two-process dev setup: `npm run dev` starts both Vite + backend.

Schema (sufficient for demo purposes):

```sql
CREATE TABLE harness_uploads (
  object_key VARCHAR(512) PRIMARY KEY,
  source VARCHAR(32) NOT NULL,            -- 'direct' or 's3-ingest'
  source_uri VARCHAR(1024),               -- populated only for s3-ingest
  auction_house_id VARCHAR(64) NOT NULL,
  auction_date VARCHAR(8) NOT NULL,
  lot_id VARCHAR(64) NOT NULL,
  image_id VARCHAR(64) NOT NULL,
  image_variant_suffix VARCHAR(8),
  content_type VARCHAR(64),
  content_length BIGINT,
  sha256 CHAR(64),                         -- populated for s3-ingest; null for direct uploads
  uploaded_at TIMESTAMPTZ NOT NULL,
  uploaded_by VARCHAR(128),
  replicated_to_r2 BOOLEAN
);
CREATE INDEX idx_harness_uploaded_at ON harness_uploads(uploaded_at DESC);
```

This schema is illustrative — the production schemas the real callers (auction-house user flow, vendor pipeline) use will be different.

### 6.8 Repo layout

```
artnet-upload-harness/
├── README.md
├── package.json
├── vite.config.ts
├── docker-compose.yml          # Postgres for local dev
├── tsconfig.json
├── tailwind.config.ts
├── .env.example
├── src/                        # Vite frontend
│   ├── main.tsx
│   ├── App.tsx
│   ├── components/
│   │   ├── DirectUploadTab.tsx
│   │   ├── S3IngestTab.tsx
│   │   ├── RecentUploadsPanel.tsx
│   │   └── TabBar.tsx
│   ├── lib/
│   │   ├── uploadFunction.ts   # API client for Upload Function
│   │   └── harnessBackend.ts   # API client for the harness's own backend
│   └── styles.css
├── harness-backend/            # Small Node backend (handles DB)
│   ├── package.json
│   ├── src/
│   │   ├── index.ts            # Express or Fastify
│   │   ├── db.ts               # Postgres connection
│   │   └── routes.ts           # POST /uploads, GET /uploads/recent, GET /mock-s3/list
│   └── tsconfig.json
└── seed/
    └── populate-mock-r2.ts     # Script to seed the mock R2 bucket
```

### 6.9 Environment

`.env` file (template in `.env.example`):

```
# Upload Function endpoint
VITE_UPLOAD_FUNCTION_URL=https://upload-function-dev.example.com

# Gateway auth tokens for development (real prod tokens come from the upstream auth system)
VITE_USER_AUTH_TOKEN=...
VITE_INGEST_AUTH_TOKEN=...

# Mock S3 bucket for browse UX (read-only credentials)
VITE_MOCK_S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com
VITE_MOCK_S3_BUCKET=artnet-mock-vendor-feed
VITE_MOCK_S3_REGION=auto
VITE_MOCK_S3_ACCESS_KEY=...
VITE_MOCK_S3_SECRET_KEY=...

# Harness backend
HARNESS_DB_URL=postgresql://harness:harness@localhost:5432/harness
HARNESS_BACKEND_PORT=4000
```

### 6.10 Deployment

For demos beyond local dev:

- **Frontend:** Cloudflare Pages (Vite static build).
- **Backend:** Cloud Run service or Cloudflare Worker — wherever fits. At demo scale, either is trivial.
- **DB:** small Cloud SQL instance, or sidecar container in Cloud Run.

Production isn't really a concept here — the harness is a dev/demo tool. Local dev via Docker Compose is the primary workflow.

---

## 7. Operations, monitoring

### 7.1 Logging

Cloud Run Functions log structured JSON to Cloud Logging by default. Variant Worker logs via Cloudflare Workers Logpush. **TBD: forward to Datadog?** if Artnet's existing observability is centered there.

Required fields on every log line:
`timestamp`, `severity`, `service`, `requestId`, `userId` (if available), `objectKey` (if relevant), `eventCode`.

### 7.2 Metrics

Cloud Monitoring custom metrics for Functions; Cloudflare Workers Analytics for the Worker:

- `uploads.presign.requested` / `.succeeded` / `.failed`
- `uploads.finalize.requested` / `.succeeded` / `.failed`
- `uploads.ingest_s3.requested` / `.succeeded` / `.failed`
- `uploads.r2_replication.synchronous_succeeded` / `.synchronous_failed`
- `reconciliation.runs` / `.objects_repaired` / `.errors`
- `variants.requests` / `.cache_hit` / `.cache_miss`
- `variants.transform_ms` (histogram)

### 7.3 Alerts

Page on:

- Reconciliation finds > 1% of recent uploads needed repair
- Upload Function error rate > 1% over 5 min (any endpoint)
- Variant Worker error rate > 1% over 5 min
- Reconciliation run failed entirely

Warn on:

- Any `r2_replication.synchronous_failed` events (individual events OK if reconciliation fixes them, pattern is concerning)
- `uploads.ingest_s3.failed` events with `code=source_unavailable` (vendor S3 outage or credentials issue)
- `variants.cache_hit_ratio < 80%` over 1 hour

### 7.4 Runbooks

Each alert links to a runbook in **TBD: Confluence space or GitHub repo**. At minimum:

- R2 service degradation (uploads succeed with `replicatedToR2: false`; reconciliation will repair)
- GCS service degradation (uploads fail entirely)
- S3 source degradation (ingests fail; user uploads unaffected)
- Reconciliation found systematic orphans
- Cache poisoning / wrong variant served

---

## 8. Open items

`**TBD:**` items consolidated:

1. **VPC attachment for the Function** (§2.2). Useful for future maintenance; not required.
2. **Vendor S3 bucket name and region** (§2.4). Confirm with scraper team; mirror in mock R2 bucket name.
3. **Legacy `i`/`o` resolution mapping** (§3.5). Validate against actual size distributions.
4. **Full-bucket reconciliation cadence** (§4.3).
5. **Mock S3 listing implementation** (§6.5). Direct from Vite vs. backend endpoint.
6. **Vendor S3 layout convention** (§6.6). Mirror in mock seed data.
7. **Logging/metrics destination** (§7.1, §7.2). Cloud Monitoring native vs. Datadog.
8. **Runbook location** (§7.4).

---

## 9. Out of scope (explicit)

- Migration of existing ~30 TB of historical images from `p-image`. Separate workstream.
- Replacement of any non-image asset handlers (PDFs, banners, logos).
- Consumer-site implementation of auth and token issuance.
- Application database schema or table placement. Each consumer owns its own DB writes.
- Admin UI for browsing/managing uploaded images.
- Image moderation, AI tagging, or enrichment.
- High-volume scaling (>10× current expected volume). Architecture handles ~5,000 uploads/day; beyond that, refactoring to async R2 replication is a known, bounded future task.

---

## 10. Implementation order

If implementing in stages:

1. **Upload Function with `presign` + `finalize` only (§2)**, pointed at dev GCS bucket. No R2 yet, no ingest yet. Demoable.
2. **R2 replication step inside finalize (§2.9)** + R2 bucket setup. Objects in both stores.
3. **Upload Widget (§5)**. Direct-upload UX complete.
4. **Test Harness Tab 1 (§6.4)**. End-to-end demo of direct upload + DB write.
5. **S3 ingest endpoint (§2.3.4) + mock R2 bucket setup (§6.6)**.
6. **Test Harness Tab 2 (§6.5)**. Both flows demonstrable.
7. **Variant Worker (§3)**. Read path live; legacy URL rewrites work.
8. **Reconciliation Function (§4)** + monitoring/alerting (§7). Operational maturity.
9. **Production cutover.** Coordinated with the p-image migration.

---

_End of spec v3._
