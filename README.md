# Artnet Image Upload Tool

Replacement image upload and serving infrastructure for Artnet lot images. This project is
intended to replace the legacy `LotImageParser.exe` upload path and classic ASP/ASP.NET image
handlers on the `p-image` Windows VM.

The system accepts new images, stores originals in Google Cloud Storage, replicates them to
Cloudflare R2, and serves originals plus generated WebP variants through a Cloudflare Worker.

## Status

Implemented:

- `upload-function/`: Cloud Run Function for direct uploads, finalization, R2 replication,
  S3 ingest, Redis-backed upload sessions, deletion, and deletion tombstones.
- `variant-worker/`: Cloudflare Worker that serves R2 originals and persists generated WebP
  variants on first request, fronted by an edge cache with `X-Cache` HIT/MISS headers.
- `infra/gcp/`: Terraform for the GCS bucket, service account, IAM, CORS, tombstone lifecycle,
  and Secret Manager placeholders.
- `infra/cloudflare/`: Terraform for the R2 bucket and optional Worker custom domain.
- `tests/e2e/`: end-to-end suite (direct upload + health) run against a deployed
  environment; read-path tests are gated on a Cloudflare Access service token and
  S3 ingest is pending the mock vendor bucket.
- `metadata-tagger/`: client-side library + CLI that embeds artwork-cataloging
  and attribution metadata (IPTC Extension `AO*` + IPTC/dc/PLUS) into images
  before upload; the Variant Worker preserves it through delivery via
  `metadata: keep`.

Not implemented yet:

- Upload Widget.
- Test Harness.
- Reconciliation Function.
- Contract test suite.

See [docs/spec.md](docs/spec.md) for the authoritative engineering spec,
[docs/architecture.svg](docs/architecture.svg) for the system topology, and
[docs/read-path-architecture.png](docs/read-path-architecture.png) for the image-serving flow.

## Architecture

```text
Browser or caller
  -> Upload Function
  -> GCS original bucket
  -> R2 serving bucket
  -> Variant Worker
  -> public image URLs
```

The Upload Function is a pure storage service. It does not write to an application database.
Callers receive the canonical `objectKey` and `publicUrl` from the function, then write their own
database rows.

The Variant Worker owns the read path. It serves originals from R2, generates a fixed set of WebP
variants on demand, and writes generated variants back to R2 as deterministic cache artifacts. An
edge cache layer (Workers Cache API) fronts R2, and every image response carries `X-Cache` and
`X-Cache-Source` headers for HIT/MISS observability.

GCS is the system of record for original images. R2 is the serving mirror.

## Repository Layout

```text
docs/
  spec.md                         Engineering spec and API contracts
  architecture.svg                System diagram
  read-path-architecture.png      Image request/read-path diagram
  decisions/                      Accepted architectural decisions

upload-function/                  Cloud Run Function, Node 22, TypeScript
variant-worker/                   Cloudflare Worker, TypeScript
infra/gcp/                        GCP Terraform
infra/cloudflare/                 Cloudflare Terraform
```

This repository is component-based, but not a shared-tooling monorepo. Each component has its own
`package.json`, dependencies, build, test, and deployment flow.

## Requirements

- Node.js 22 LTS.
- npm.
- Terraform for infrastructure changes.
- `gcloud` for GCP deployment and Secret Manager updates.
- Wrangler for Cloudflare Worker development and deployment.

## Local Development

Install and run commands inside the component you are working on.

### Upload Function

```bash
cd upload-function
npm install
cp .env.example .env
npm run dev
```

In another terminal:

```bash
curl -sS http://localhost:8080/v1/health
```

Common commands:

```bash
npm run check
npm run test
npm run build
npm run examples:server
npm run deploy            # deploy to the dev Cloud Run environment (gcloud, requires auth)
```

The direct upload flow uses signed GCS URLs, so browser and server examples require a real
development GCS bucket.

`npm run deploy` reads runtime config from the `infra/gcp` Terraform outputs and deploys the
function to Cloud Run, so the GCP infrastructure must be applied and the Secret Manager secret
versions populated first (see `infra/gcp/README.md`). Pass an environment name with
`npm run deploy -- <env>` (defaults to `dev`).

### Variant Worker

```bash
cd variant-worker
npm install
npm run dev
```

Common commands:

```bash
npm run check
npm run test
npm run build
npm run deploy
```

The Worker requires an R2 binding named `R2_PRIMARY` and a Cloudflare Images binding named
`IMAGES`. `npm run deploy` targets the default environment; deploy a named environment (e.g. the
QA worker bound to its own R2 bucket and custom domain) with `npx wrangler deploy --env <name>`.

## Infrastructure

GCP resources:

```bash
cd infra/gcp
cp terraform.tfvars.example terraform.tfvars
terraform init
terraform plan
terraform apply
```

Cloudflare resources:

```bash
cd infra/cloudflare
cp terraform.tfvars.example terraform.tfvars
terraform init
terraform plan
terraform apply
```

Secret values are not stored in Terraform files. Create R2 access keys in Cloudflare, then add
the values to GCP Secret Manager as described in the infra READMEs:

- [infra/gcp/README.md](infra/gcp/README.md)
- [infra/cloudflare/README.md](infra/cloudflare/README.md)

## Public Contracts

The main Upload Function endpoints currently implemented are:

```text
GET    /v1/health
POST   /v1/uploads/presign
POST   /v1/uploads/:uploadId/finalize
DELETE /v1/uploads/:uploadId
DELETE /v1/objects/<objectKey>
```

The main Variant Worker URL shapes are:

```text
GET /lot_images/<auctionHouseId>/<auctionDate>/<lotId>/<imageId>.<ext>
GET /lot_images/<auctionHouseId>/<auctionDate>/<lotId>/<imageId>.<ext>?variant=w640
GET /_v/<cacheVersion>/lot_images/<auctionHouseId>/<auctionDate>/<lotId>/<imageId>.<ext>
```

Supported generated variants are `thumb`, `w320`, `w640`, `w960`, `w1280`, and `w1600`.
Compatibility aliases map `medium` to `w640` and `large` to `w1600`.

Image responses include cache-status headers:

```text
X-Cache: HIT | MISS                whether the edge cache (caches.default) served the response
X-Cache-Source: edge | r2 | images edge cache, persisted R2 object/variant, or fresh Images transform
```

## Development Rules

- Keep component boundaries intact. Components share contracts, not code.
- Do not add a database driver to the Upload Function.
- Do not use real production GCS, R2, S3, or database services in tests.
- Use TypeScript and ESM.
- Keep relative TypeScript imports ESM-compatible by including `.js` extensions.
- Use Zod at external boundaries.
- Do not commit secrets or realistic-looking fake credentials.
- Run `npm run check` and `npm run test` in each affected component before handing off changes.

## Documentation

- [docs/spec.md](docs/spec.md): source of truth for behavior and contracts.
- [docs/architecture.svg](docs/architecture.svg): system topology and write/read overview.
- [docs/read-path-architecture.png](docs/read-path-architecture.png): image request read path.
- [docs/decisions/0001-deletion-tombstones.md](docs/decisions/0001-deletion-tombstones.md):
  delete/reconciliation tombstone contract.
- [docs/decisions/0002-persist-generated-webp-variants.md](docs/decisions/0002-persist-generated-webp-variants.md):
  persisted WebP variant decision.
- [docs/decisions/0003-redis-upload-sessions.md](docs/decisions/0003-redis-upload-sessions.md):
  shared Redis upload session storage.
- [docs/decisions/0004-edge-cache-and-cache-status.md](docs/decisions/0004-edge-cache-and-cache-status.md):
  Variant Worker edge cache layer and cache-status headers.
- [docs/design/test-harness-and-e2e.md](docs/design/test-harness-and-e2e.md):
  design proposal for the Test Harness and end-to-end test suite.
- [tests/e2e/README.md](tests/e2e/README.md): how to run the end-to-end suite.
- [metadata-tagger/README.md](metadata-tagger/README.md): artwork/photo metadata
  embedding library + CLI.
- [docs/talking-points.md](docs/talking-points.md): high-level talking points for
  presenting the project.
- [upload-function/README.md](upload-function/README.md): Upload Function setup and API details.
- [variant-worker/README.md](variant-worker/README.md): Worker commands, bindings, and URL contract.
