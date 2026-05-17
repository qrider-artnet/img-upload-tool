# Artnet Image Upload Tool

Replacement image upload and serving infrastructure for Artnet lot images. This project is
intended to replace the legacy `LotImageParser.exe` upload path and classic ASP/ASP.NET image
handlers on the `p-image` Windows VM.

The system accepts new images, stores originals in Google Cloud Storage, replicates them to
Cloudflare R2, and serves originals plus generated WebP variants through a Cloudflare Worker.

## Status

Implemented:

- `upload-function/`: Cloud Run Function for direct uploads, finalization, R2 replication,
  deletion, and deletion tombstones.
- `variant-worker/`: Cloudflare Worker that serves R2 originals and persists generated WebP
  variants on first request.
- `infra/gcp/`: Terraform for the GCS bucket, service account, IAM, CORS, tombstone lifecycle,
  and Secret Manager placeholders.
- `infra/cloudflare/`: Terraform for the R2 bucket and optional Worker custom domain.

Not implemented yet:

- Upload Widget.
- Test Harness.
- S3 ingest endpoint.
- Reconciliation Function.
- Contract and end-to-end test suites.

See [docs/spec.md](docs/spec.md) for the authoritative engineering spec and
[docs/architecture.svg](docs/architecture.svg) for the system topology.

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
variants on demand, and writes generated variants back to R2 as deterministic cache artifacts.

GCS is the system of record for original images. R2 is the serving mirror.

## Repository Layout

```text
docs/
  spec.md                         Engineering spec and API contracts
  architecture.svg                System diagram
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
```

The direct upload flow uses signed GCS URLs, so browser and server examples require a real
development GCS bucket.

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
`IMAGES`.

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
- [docs/decisions/0001-deletion-tombstones.md](docs/decisions/0001-deletion-tombstones.md):
  delete/reconciliation tombstone contract.
- [docs/decisions/0002-persist-generated-webp-variants.md](docs/decisions/0002-persist-generated-webp-variants.md):
  persisted WebP variant decision.
- [upload-function/README.md](upload-function/README.md): Upload Function setup and API details.
- [variant-worker/README.md](variant-worker/README.md): Worker commands, bindings, and URL contract.
