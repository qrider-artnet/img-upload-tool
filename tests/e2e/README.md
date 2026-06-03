# End-to-end tests

Tier-2 e2e suite (per `docs/design/test-harness-and-e2e.md`): drives the real wire
— Upload Function → GCS → R2 → Variant Worker — against a deployed lower
environment. Defaults to the QA stack.

This is a standalone package (the repo is not a shared-tooling monorepo).

## Run

```bash
cd tests/e2e
npm install
npm test
```

By default it targets the deployed QA Upload Function. Override the target and
provide the read-path service token via env (or a git-ignored `.env`):

```bash
cp .env.example .env   # then fill in values
```

| Variable | Purpose |
|---|---|
| `E2E_UPLOAD_FUNCTION_URL` | Upload Function base URL (defaults to QA). |
| `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET` | Cloudflare Access service token for the SSO-gated read path. |

## What runs vs. skips

- **Direct upload (Mode A)** and **health** run unauthenticated against the QA
  Upload Function (it is deployed `--allow-unauthenticated`).
- **Read path (Variant Worker)** is behind Cloudflare Access SSO, so those tests
  **skip** unless a service token is configured.
- **S3 ingest (Mode B)** is skipped (`it.todo`) until the mock vendor bucket
  (`artnet-mock-vendor-feed`) is provisioned.

## Notes

- Each run uses a unique, URL-safe image id so concurrent runs do not collide.
- Created objects are deleted in `afterAll`; the `staging/uploads/` and
  `tombstones/` GCS lifecycle rules provide backstop cleanup.
- Tests hit live services — failures can mean a real regression *or* an
  environment problem (deployment down, R2 unreachable). Check the QA stack
  before assuming a code regression.
