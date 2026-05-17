# CLAUDE.md

Claude Code reads this file at the start of every session. Most of the guidance lives in `AGENTS.md`, which is the single source of truth for agent conventions in this repo.

**Read `AGENTS.md` first.** It covers:

- What this repo is
- Authoritative documents (the spec, the architecture diagram, ADRs)
- Repo layout (the five components and what each is responsible for)
- Setup commands
- TypeScript and code style conventions
- Component boundaries (do not violate)
- TBD discipline
- Secrets handling
- What "done" looks like
- Implementation order

Everything in `AGENTS.md` applies to Claude Code. There are no separate Claude-specific conventions for those topics.

---

## Claude Code-specific extras

A few capabilities Claude Code has that other agents don't, and how to use them in this repo.

### `.claude/rules/` — deeper conventions

Some `AGENTS.md` topics have expanded rules in `.claude/rules/` for when you want more detail than the summary in `AGENTS.md`:

- `.claude/rules/tbd-discipline.md` — examples of bad vs. good TBD handling
- `.claude/rules/component-boundaries.md` — why each boundary exists and when to break one
- `.claude/rules/typescript.md` — full TS conventions including imports, errors, naming
- `.claude/rules/secrets.md` — full secret-handling rules including rotation
- `.claude/rules/testing.md` — test layers, what to mock, per-component patterns, anti-patterns

`AGENTS.md` is the summary; these are the deep dive. When in doubt, the deep-dive file is authoritative.

### Slash commands

Two custom commands in `.claude/commands/`:

- `/spec-check <component>` — verify a component's code matches what the spec specifies. Reports compliance, gaps, and drift without making changes.
- `/next-stage` — identify which stage of `docs/spec.md` §10 to work on next, propose acceptance criteria, surface blockers.

Use these to orient at the start of a session or before declaring a stage complete.

### Working style

A few Claude Code-specific tips that complement `AGENTS.md`:

- Use `@docs/spec.md` and `@AGENTS.md` to reference these files directly in prompts — Claude Code loads them into context efficiently.
- For stage-by-stage work, use the `/next-stage` command first to confirm what to build before writing code.
- For finishing a stage, use `/spec-check <component>` before declaring done.

### Where new learnings go

Per `AGENTS.md`. To restate: API contracts and behaviors go in `docs/spec.md` (proposed, not silent), architectural decisions go in `docs/decisions/` as ADRs, conventions go in `.claude/rules/` (which `AGENTS.md` summarizes), component-specific details go in that component's `README.md`.

When you learn a Claude Code-specific thing — a useful prompt pattern, a slash command worth adding, a skill worth creating in `.claude/skills/` — that goes here in `CLAUDE.md` or in `.claude/`.

---

## If `AGENTS.md` and `CLAUDE.md` ever conflict

`AGENTS.md` wins. This file should only contain things that are genuinely Claude Code-specific (capabilities, file paths under `.claude/`). Anything else — conventions, boundaries, code style — lives in `AGENTS.md`. If you find yourself adding non-Claude-specific content here, move it to `AGENTS.md` instead.

---

*Spec: `docs/spec.md`. Architecture: `docs/architecture.svg`. Conventions: `AGENTS.md`. Deep-dive rules: `.claude/rules/`.*
