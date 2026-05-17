# Repo bootstrap guide

How to assemble the artifacts I produced into a fresh repo Codex can work on.

## Files to copy into your new repo

```
your-new-repo/
├── AGENTS.md                              ← from outputs/AGENTS.md
├── CLAUDE.md                              ← from outputs/CLAUDE.md
├── README.md                              ← you write this for humans (optional)
├── .claude/
│   ├── commands/
│   │   ├── next-stage.md                  ← from outputs/.claude/commands/next-stage.md
│   │   └── spec-check.md                  ← from outputs/.claude/commands/spec-check.md
│   └── rules/
│       ├── component-boundaries.md        ← from outputs/.claude/rules/component-boundaries.md
│       ├── secrets.md                     ← from outputs/.claude/rules/secrets.md
│       ├── tbd-discipline.md              ← from outputs/.claude/rules/tbd-discipline.md
│       ├── testing.md                     ← from outputs/.claude/rules/testing.md
│       └── typescript.md                  ← from outputs/.claude/rules/typescript.md
└── docs/
    ├── spec.md                            ← from outputs/docs/spec.md
    ├── architecture.svg                   ← from outputs/docs/architecture.svg
    └── decisions/
        └── 0000-template.md               ← from outputs/docs/decisions/0000-template.md
```

## Files NOT to copy

These are working artifacts from our conversation, not part of the repo:

- `artnet-image-upload-tool-spec.md`, `-v2.md`, `-v3.md` — earlier spec drafts. v3 is what got copied to `docs/spec.md`. Discard the rest.
- `p-image-migration-proposal.md` — the migration proposal is its own document for the migration project, separate from this rebuild repo. Keep it for that work, don't put it in this repo.
- `codex-handoff-prompt.md` — meta-doc about how to use Codex. Keep it for yourself; don't commit it.
- This bootstrap guide — same. Keep for yourself.

## Bootstrap steps

1. Create an empty repo on GitHub or wherever.
2. Clone it locally.
3. Copy in the files per the layout above.
4. Optionally write a human-facing `README.md` with a one-paragraph summary and a link to `AGENTS.md` and `docs/spec.md`. (See template below if you want one.)
5. Initial commit. Push.
6. Open Codex pointed at the repo.
7. Paste the prompt from `codex-handoff-prompt.md` and start with Stage 1 (Upload Function).

## Optional README.md template

If you want a human-facing README in the repo root:

```markdown
# Artnet Image Upload Tool

Replacement for the legacy `LotImageParser.exe` and `.asp`/`.aspx` image handlers
on the `p-image` Windows VM. New uploads go to GCS (primary) and replicate to R2
(serving cache). Variants are generated on-demand at the edge.

## Documents

- [Engineering specification](docs/spec.md) — what to build
- [Architecture diagram](docs/architecture.svg) — system topology
- [Architectural decisions](docs/decisions/) — ADRs as decisions are made
- [AGENTS.md](AGENTS.md) — conventions for AI coding agents working in this repo

## Components

| Directory | What it is |
|---|---|
| `upload-function/` | Pure storage Cloud Run Function |
| `variant-worker/` | On-demand image variants, fronts R2 |
| `reconciliation-function/` | Daily GCS↔R2 drift correction |
| `upload-widget/` | Framework-agnostic Web Component for end-user upload |
| `test-harness/` | Vite + React app demonstrating both upload flows |

Each directory has its own `README.md` with setup and run instructions.

## Status

Pre-implementation. Components are being built stage-by-stage per spec §10.
```

## What's deliberately missing

- **The actual `upload-function/`, `variant-worker/`, etc. directories.** Those are what Codex will create as you work through the stages. The repo starts empty of code on purpose — Stage 1 of the build is "create `upload-function/`."
- **Any ADRs in `docs/decisions/`.** Just the template. You'll add real ADRs (`0001-...`, `0002-...`) as TBDs get resolved during implementation.
- **`tsconfig.base.json`.** I considered including one but each component will have its own tsconfig and the AGENTS.md typescript rules describe the settings — Codex will set this up in Stage 1.
- **`.gitignore`, `.editorconfig`, etc.** Standard project hygiene that Codex should set up in Stage 1 along with the first component.

## Sanity check before handing to Codex

Before you paste the handoff prompt, verify:

- [ ] `AGENTS.md` exists at repo root
- [ ] `docs/spec.md` exists and is the v3 content
- [ ] `docs/architecture.svg` exists
- [ ] `docs/decisions/0000-template.md` exists
- [ ] `CLAUDE.md` exists (optional but recommended)
- [ ] `.claude/rules/` and `.claude/commands/` exist (Claude Code only — fine to omit if you're using Codex exclusively)
- [ ] No code files yet in the repo. Codex creates those.

If those are all in place, paste the prompt from `codex-handoff-prompt.md` and let it propose a plan.
