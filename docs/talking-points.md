# Presentation talking points

High-level talking points for presenting the Artnet Image Upload Tool. Grouped so
they can be picked by audience and time. For the authoritative technical detail,
see [`spec.md`](spec.md); for status, see the project [`README`](../README.md).

## 1. The problem (why this exists)

- Image upload and serving today runs on `LotImageParser.exe` and classic
  ASP/ASPX handlers on the `p-image` Windows VM — legacy, hard to maintain, a
  single-box dependency.
- We're replacing it with a serverless, cloud-native path: no VM to babysit,
  scales with load.

## 2. What we built (the architecture in one breath)

- Two small services + two storage layers:
  - **Upload Function** (Cloud Run, Node 22 / TypeScript) — pure storage: takes
    bytes in, validates, stores, replicates.
  - **Variant Worker** (Cloudflare Worker) — the read path: serves images and
    generates sized WebP variants on demand.
  - **GCS** is the system of record; **Cloudflare R2** is the serving mirror.
- Two ingestion modes, one codebase: direct browser/UI upload *and* server-side
  S3 ingest (for the vendor scraper pipeline).

## 3. Design decisions worth calling out

- **Pure storage, no database.** The Upload Function never writes to an app DB —
  callers own their own rows. Simple, stateless, reusable across consumers.
- **Synchronous R2 replication at finalize** — at ~500 uploads/day, no async
  pipeline needed; the image is in both stores before we return.
- **Versioned, immutable URLs + on-demand WebP** — modern format, edge-cached,
  cache-forever safe because each upload mints a new version. An edge cache layer
  with `X-Cache` HIT/MISS observability fronts R2.
- **Authentication lives upstream** at the gateway — the function is pure
  storage, not an auth server.

## 4. Where it is right now (demo moment)

- Fully deployed to a QA environment and verified end-to-end: a real artwork
  uploaded → stored in GCS → replicated to R2 → served as a WebP variant at
  `artworks.artnet-dev.com`.
- **Live demo:** drag-drop in the browser example, then open the served image
  URL. Show the `?variant=w640` resize and the `X-Cache` header flipping
  MISS → HIT.

## 5. Engineering quality / how we de-risk

- **Infrastructure as code** (Terraform) for both GCP and Cloudflare —
  reproducible environments.
- **~106 unit/integration tests** plus an end-to-end suite that runs against the
  live QA stack.
- **Staged rollout** by design — lower environment first, production cutover last.
- **Secrets handled properly** — Secret Manager / Worker secrets, never in code or
  state.

## 6. Honest status — done vs. pending

- **Done:** Upload Function (both modes, delete + tombstones), Variant Worker
  (variants + edge cache), QA infra, e2e scaffold.
- **Not yet:** Upload Widget (embeddable uploader), Test Harness (demo app),
  Reconciliation Function (daily GCS↔R2 drift repair), production cutover.
- **Open decisions:** VPC attachment, the vendor bucket layout, and where
  logs/metrics forward (Datadog?).

## 7. The ask / next steps

- Tailor to the room: green-light production infra, confirm the vendor S3 layout
  with the scraper team, or staffing to finish the widget + harness.

---

**Suggested arc (~5 slides):** Problem → Architecture diagram → Live demo →
Status & quality → What's next / the ask.
