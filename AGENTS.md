# AGENTS.md

This file is the orientation guide for coding agents (Codex, Cursor, Claude Code, Copilot, others) working in this repository. It is not a README — the README is for humans. This file tells agents how to work effectively here.

If multiple `AGENTS.md` files exist in nested directories, the closest one to the file you're editing takes precedence. Always check for a more specific file before relying on this one.

---

## What this repo is

The Artnet Image Upload Tool. A replacement for the legacy `LotImageParser.exe` and `.asp`/`.aspx` image handlers on the `p-image` Windows VM.

**Authoritative documents** (read before doing any work):

- `docs/spec.md` — engineering specification. Source of truth for what to build.
- `docs/architecture.svg` — visual of the system topology. Open in any SVG viewer.
- `docs/decisions/` — architectural decisions (ADRs) that override or refine the spec.

**This file** tells you how to work; **the spec** tells you what to build. When they appear to conflict, the spec wins.

---

## Repo layout

Five components, each in its own directory at the repo root, each with its own `package.json` and its own deployment story:

| Directory | Component | Runtime | Spec section |
|---|---|---|---|
| `upload-function/` | Pure storage Cloud Run Function (presign, finalize, S3 ingest) | Cloud Run Functions, Node 22, TS | §2 |
| `variant-worker/` | On-demand image transformation, fronts R2 | Cloudflare Workers, TS | §3 |
| `reconciliation-function/` | Daily GCS↔R2 drift correction | Cloud Run Functions, Node 22, TS | §4 |
| `upload-widget/` | Framework-agnostic Web Component for end-user upload | Browser, TS, Vite library mode | §5 |
| `test-harness/` | Vite + React app + small Node backend, demonstrates both flows | Browser + Node | §6 |

This is **not** a monorepo with shared tooling. Each component is independent. They share **contracts** (defined in the spec), not code. If you find yourself wanting one component to import from another, stop — surface it for discussion.

A nested `AGENTS.md` in each component directory may add component-specific guidance.

---

## Setup

Per-component. Run from inside each component directory.

```bash
npm install
npm run check       # typecheck + lint
npm run test        # unit tests
npm run dev         # local dev server (where applicable)
npm run build       # production build
```

Component-specific commands:

```bash
# upload-function/
npm run dev         # @google-cloud/functions-framework on :8080
npm run deploy      # gcloud run deploy (requires auth)

# variant-worker/
npm run dev         # wrangler dev
npm run deploy      # wrangler deploy

# reconciliation-function/
npm run dev         # @google-cloud/functions-framework on :8081

# upload-widget/
npm run dev         # vite dev server, demo page
npm run build       # vite build (library mode → single .js)

# test-harness/
docker compose up -d              # local Postgres
npm run dev                       # vite + harness-backend together
```

---

## Conventions

### Languages and tooling

- **TypeScript** for everything. No JavaScript files except where a tool requires (e.g., `vite.config.js`).
- **ESM only.** No CommonJS. `"type": "module"` in every `package.json`.
- **Node 22 LTS** for backend components.
- **`npm`** is the package manager. Don't switch components to pnpm or yarn.

### Code style

- **Prettier** with `printWidth: 100`. Configured per-component.
- **ESLint** with `@typescript-eslint/recommended` + `eslint-plugin-import`.
- **No default exports** for new modules. Named exports only.
- **Imports** include `.js` extension on relative paths (TS-to-ESM convention): `import { foo } from './bar.js'` even though source is `bar.ts`.
- **camelCase** for variables/functions/properties, **PascalCase** for types/classes/components, **SCREAMING_SNAKE_CASE** for env var names and module-level constants, **kebab-case** for filenames except React components.

### Strict TypeScript

Every component uses strict mode plus:

```json
{
  "strict": true,
  "noUncheckedIndexedAccess": true,
  "noImplicitOverride": true,
  "exactOptionalPropertyTypes": true
}
```

- **No `any`.** Use `unknown` and narrow.
- **No type assertions** (`as Foo`) unless the runtime guarantee is obvious.
- **Branded types** for opaque IDs (`type ObjectKey = string & { readonly __brand: 'ObjectKey' }`).
- **Zod** for validation at every external boundary. Inferred TS types come from Zod schemas, not the other way around.

### Testing

- **Vitest** for all components.
- **Four layers, distinct purposes:**
  - **Unit tests** — single module, no I/O. Live as `*.test.ts` next to source.
  - **Integration tests** — component as a whole, against local emulators. Live in `tests/*.integration.test.ts` per component.
  - **Contract tests** — API surface between components. Live in `tests/contract/` at the repo root.
  - **End-to-end tests** — full system against staging. Live in `tests/e2e/` at the repo root. Run nightly only.
- **Test behavior, not implementation.** A test that breaks because you renamed an internal function is a bad test.
- **Never hit real GCS, R2, AWS S3, or production cloud services.** Use local emulators: `fake-gcs-server`, LocalStack, MinIO, Postgres/SQL Server in Docker, `@cloudflare/vitest-pool-workers` for the Variant Worker.
- **Cover every documented error code** from the spec. Error codes are public contracts.
- **Coverage is a diagnostic, not a target.** No enforced threshold. Review coverage; don't game it.

Deep-dive: `.claude/rules/testing.md` covers per-component patterns, fixtures, anti-patterns, CI behavior, and what's hard to test cleanly.

### Errors and logging

- Throw **typed errors** (`UploadError`, `IngestError`) with stable string codes, never raw strings.
- Stable error codes appear in API responses and metrics — changing them is a breaking change.
- Use the component's structured logger module. Never `console.log`.
- Log objects, not concatenated strings: `log.info({ eventCode: 'upload.finalized', objectKey, size })`.
- **Never log secrets, tokens, signed URLs, or full request bodies.**

### Async

- `async/await` always. No raw promise chains in new code.
- `Promise.all` for independent parallel work; `Promise.allSettled` when results are needed regardless of failures.
- Floating promises (no `await`, no `.catch()`) are bugs — lint should flag them.

---

## Component boundaries (do not violate)

The system is split deliberately. Don't blur the lines.

### Upload Function — pure storage

- **Is responsible for:** putting bytes into GCS and R2, signing URLs, validating uploads, returning canonical metadata.
- **Is NOT responsible for:**
  - Writing to any application database. The function has no DB driver. If you find yourself adding `pg` or `mssql`, stop and re-read spec §2.7.
  - Image processing (Variant Worker's job).
  - Cache invalidation.
  - JWT issuance (it validates, doesn't issue).

### Variant Worker — write-through read path

- **Is responsible for:** serving images from R2, generating the fixed WebP variants documented in the spec, writing those generated variants back to R2, edge caching, legacy URL rewrites.
- **Is NOT responsible for:**
  - Upload/original write paths. Only persisted generated variants may be PUT to R2.
  - Authorization (image URLs are public).

### Reconciliation Function — drift correction only

- **Is responsible for:** finding GCS↔R2 mismatches in the recent past and copying GCS → R2 to repair.
- **Is NOT responsible for:**
  - Database writes or reads.
  - R2 → GCS direction (GCS is source of truth).
  - Real-time repair (it's a daily job).

### Upload Widget — UI for end-user upload

- **Is responsible for:** drag-drop UX, file picking, presign request, direct PUT to GCS, finalize call, dispatching events to host page.
- **Is NOT responsible for:** anything DB-related, image transformation, JWT issuance.

### Test Harness — reference implementation

- **Is responsible for:** demonstrating both ingestion modes end-to-end, including SQL writes that production callers would do.
- **Is NOT responsible for:** being production code, performance/scale beyond demo needs, replacing real consumer integrations.

---

## TBD discipline

The spec contains items marked `**TBD:**`. These are genuinely undecided.

When you encounter a TBD that affects what you're about to do:

1. **Don't pick an answer and proceed silently.**
2. **Don't write code that handles both possibilities** — that doubles the surface area and locks in an unmade decision.
3. **Surface the question** with concrete options:

   > "Spec §X.Y is TBD: [the question]. Options:
   > - **A:** [option] — pros / cons
   > - **B:** [option] — pros / cons
   > Which would you like?"

4. **Block on the answer** for that path of work. Work on independent paths in the meantime.
5. When the human answers, ask if it should be added to the spec or to an ADR in `docs/decisions/`.

Treat anything not marked `**TBD:**` as decided. If you suspect something *should* be TBD but isn't marked, flag that as a spec ambiguity, not an invitation to choose.

---

## Secrets

- **Never commit secrets.** Real credentials, tokens, signing keys, API keys, connection strings with embedded passwords.
- **Real-looking placeholders count too:** `sk_live_abc123...` is not OK even if fake. Use obvious placeholders: `<your-r2-access-key>`, `REPLACE_ME`.
- **At runtime:** Secret Manager (GCP), Worker secrets (Cloudflare).
- **Local dev:** `.env` files, git-ignored. `.env.example` checked in with key names only.
- **Adding a new secret:** add the key (not value) to `.env.example` with a comment, add the key to deployment secret store, reference in code by name. Never write the value into the codebase, even temporarily.
- **If a secret is accidentally committed:** tell the human immediately, rotate the secret, then deal with git history.

---

## What "done" looks like

When you finish a piece of work:

- Run typecheck and lint for the affected component (`npm run check`).
- Run unit tests for the affected component.
- Run contract tests if you touched anything inter-component.
- **Don't run the full repo test suite** when you only touched one component — single-component runs are faster and sufficient.
- **Don't commit, don't push, don't create branches.** Surface what you did and let the human handle VCS.

---

## Implementation order

The spec's §10 lists the staged build order. Generally, work top-to-bottom — earlier stages produce demoable milestones that later stages depend on:

1. Upload Function with `presign` + `finalize` only
2. R2 replication step inside finalize
3. Upload Widget
4. Test Harness Tab 1 (direct upload)
5. S3 ingest endpoint + mock R2 bucket
6. Test Harness Tab 2 (S3 ingest)
7. Variant Worker
8. Reconciliation Function + monitoring
9. Production cutover

When asked to do "the next thing," check what's complete vs. the spec and pick up the next stage.

---

## Where to put new learnings

When you learn something during a session that should persist:

| Type | Lives in |
|---|---|
| API contract or behavior | `docs/spec.md` (propose edit, don't make silently) |
| Architectural decision | `docs/decisions/NNNN-title.md` (ADR; template in `0000-template.md`) |
| Coding convention | This file or a more specific nested `AGENTS.md` |
| Component-specific detail | that component's `README.md` |

When in doubt, surface it to the human and ask where it should land.

---

## Things to NOT do

- Don't add a database driver to the Upload Function. It's pure storage.
- Don't write tests that hit real GCS, R2, or S3 buckets. Use emulators / mocks.
- Don't introduce new dependencies casually. Each component has a deliberately small set. Propose a new dep with a one-line justification before adding.
- **Forbidden in any new code:** Lodash (use native), Moment (use Temporal or date-fns), Axios (use fetch), jQuery.
- Don't commit, push, or create branches.
- Don't invent answers to spec TBDs.
- Don't span unrelated changes. One concern per change set.
- Don't run the full test suite when you only touched one component.

---

## Asking for help

When stuck or uncertain:

1. **Check the spec first.** Most questions have answers there.
2. **Check `docs/decisions/`** for ADRs that override or refine the spec.
3. **Check git history** with `git log --oneline -- <path>` for prior context.
4. **Surface the question** to the human with concrete options. "Should I do X or Y? X is simpler; Y is more correct because Z" is much more useful than "what should I do?"

---

*Updated when conventions change. Spec lives in `docs/spec.md`. Architecture diagram in `docs/architecture.svg`.*
