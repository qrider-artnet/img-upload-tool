# Codex handoff prompt — Artnet Image Upload Tool rebuild

Paste this into Codex when starting the rebuild. It assumes the repo is already initialized with the spec, AGENTS.md, and architecture diagram in place.

---

## The prompt

```
I'm rebuilding the Artnet Image Upload Tool from scratch based on a fresh spec. Before doing anything, read these three files in this order:

@AGENTS.md
@docs/spec.md
@docs/architecture.svg

AGENTS.md tells you how to work in this repo. The spec is authoritative for what to build. The diagram shows the system topology.

Goal
Implement the Upload Function (spec §2) — the first component in the staged build order from §10. This is the pure storage Cloud Run Function that exposes /v1/uploads/presign, /v1/uploads/:id/finalize, /v1/uploads/:id (DELETE), /v1/ingest/from-s3, and /v1/health. By the end of this stage, I should be able to:

1. Run the function locally with `npm run dev` from `upload-function/`.
2. POST to /v1/uploads/presign and get back a signed GCS URL.
3. PUT a file to that URL successfully.
4. POST to /v1/uploads/:id/finalize and have the object verified, replicated to R2, and metadata returned.
5. POST to /v1/ingest/from-s3 with a sourceUri pointing at a mock R2 bucket and have the object copied to GCS + production R2.
6. See passing unit tests for happy paths and key error cases.

Context
- The spec's §2 fully specifies endpoints, request/response shapes, error envelopes, object key conventions, JWT authentication (two scopes: upload, ingest), and R2 replication behavior.
- §1.5 has the architecture diagram (also in docs/architecture.svg).
- §7 lists open TBDs — several affect §2. Surface any you hit before guessing.
- The repo is empty except for the docs/ folder, this AGENTS.md, the spec, and a tsconfig.base.json. You are creating upload-function/ from scratch.
- We are NOT migrating historical image data here. We are NOT building any database layer in this function — see component boundaries in AGENTS.md.

Constraints
- Follow every rule in AGENTS.md. The strict TypeScript settings, ESM-only, named exports, branded types, Zod validation at boundaries, structured logging, no any, no default exports — all of it applies.
- The Upload Function does NOT have a database driver. Do not add `pg` or `mssql`. Sessions go in either in-process memory or Workers KV equivalent (see spec §2.3.1; default to in-memory for v1).
- Use Hono as the router. `@google-cloud/storage` for GCS. `@aws-sdk/client-s3` for both R2 and S3 source (two configured client instances per spec §2.4 and §2.9). `jose` for JWT.
- The `forcePathStyle: true` flag is required on the S3 client for R2 compatibility.
- Validate every external input with Zod schemas. Inferred TS types come from the schemas, not the other way around.
- All tests use Vitest. Don't hit real GCS/R2/S3 — use the official emulators or focused mocks. Document the test strategy in upload-function/README.md.
- Stable error codes per spec §2.8. Don't invent new ones.

Done when
- `upload-function/` exists with package.json, tsconfig.json, src/, and tests.
- `npm run check` passes (typecheck + lint, zero errors).
- `npm run test` passes for all unit tests.
- All five endpoints from §2.3 are implemented and exercised by tests.
- README.md in `upload-function/` documents: how to run locally, how to run tests, what mocks/emulators are needed, and a note about which spec TBDs are still open.
- For every TBD you hit, you've surfaced it with concrete options and waited for an answer rather than picking silently.

Approach
Start by reading all three files end-to-end. Then propose a plan: what files you'll create, what TBDs need answers before you can start, and what order you'll work in. Don't write any code until I've confirmed the plan.

When you hit something ambiguous between AGENTS.md and the spec, the spec wins — but flag the conflict so we can fix AGENTS.md.

When you finish, don't commit. Surface what you did and we'll review together.
```

---

## Notes on using this

**Iterative engagement, not one-shot.** Don't expect Codex to produce the entire Upload Function from this single prompt and have it be correct. The prompt is structured to start the iterative loop: read docs → propose a plan → confirm → implement → review → fix. Each "stage" from spec §10 should be its own engagement of this kind.

**For the next stage, replace the Goal block** with the next stage's goal. The Context, Constraints, and Approach sections mostly stay the same (they're about how to work, not what to do).

**When TBDs come back as questions**, your job is to either answer them or push them back to the relevant team. Don't let Codex sit blocked too long; that's where it starts inventing.

**Watch for boundary violations.** The most likely failure mode is Codex adding a database layer to the Upload Function because that's what most upload services do. AGENTS.md and the spec both flag this, but Codex may need a reminder. If you see `pg` or `mssql` appear in `upload-function/package.json`, stop the work.

**For subsequent stages**, here's a quick template you can adapt:

```
Implement [component] per spec §[N]. We're at stage [X] of §10.

Read @AGENTS.md, @docs/spec.md §[N], and @docs/architecture.svg first.

[Specific stage goals — what should work end-to-end at the end]

[Specific stage constraints — anything beyond AGENTS.md]

Done when:
- [Concrete checks]
- TBDs surfaced, not invented
- README documents what's done and what's still open

Propose a plan first. Don't write code until I confirm.
```
