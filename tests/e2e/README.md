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
provide the read-path service token via env or a git-ignored `.env` — the `test`
script loads `.env` automatically (`node --env-file-if-exists=.env`):

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

## Unblocking the read-path tests (Cloudflare Access service token)

The read path (`artworks.artnet-dev.com`) is behind Cloudflare Access, so the
e2e runner authenticates with a service token rather than interactive SSO. This
is a Zero Trust dashboard action (it needs Access admin):

1. **Create the token** — one.dash.cloudflare.com → the **artnet dev** account →
   **Access → Service Auth → Service Tokens → Create Service Token** (name it e.g.
   `artnet-image-e2e`). Copy the **Client ID** (ends `.access`) and **Client
   Secret** — the secret is shown once.
2. **Authorize it** — **Access → Applications** → open the app protecting
   `artworks.artnet-dev.com` → **Policies** → add a policy with action
   **Service Auth** and an include rule of **Service Token** = your token. Save.
   If that hostname is covered by a broad `*.artnet-dev.com` app, prefer a
   hostname-scoped app so the policy does not widen service-token access across
   the whole dev environment.
3. **Wire it in** — put the values in a git-ignored `.env` (never commit them):

   ```bash
   cp .env.example .env
   # CF_ACCESS_CLIENT_ID=<...>.access
   # CF_ACCESS_CLIENT_SECRET=<...>
   npm test
   ```

The three read-path specs then run instead of skipping. The suite sends the
values as `CF-Access-Client-Id` / `CF-Access-Client-Secret` request headers.

## Notes

- Each run uses a unique, URL-safe image id so concurrent runs do not collide.
- Created objects are deleted in `afterAll`; the `staging/uploads/` and
  `tombstones/` GCS lifecycle rules provide backstop cleanup.
- Tests hit live services — failures can mean a real regression *or* an
  environment problem (deployment down, R2 unreachable). Check the QA stack
  before assuming a code regression.
