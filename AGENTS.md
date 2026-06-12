# learn-wings — Agent Instructions

Single source of truth for all coding agents. `CLAUDE.md` imports this file — edit HERE, never there.

## Project shape
- `src/` — React 18 + Vite SPA (TypeScript, shadcn/ui + Radix + Tailwind, TanStack Query v5, i18next en+da). Hosted on Azure Static Web Apps.
- `functions/` — ~100 Azure Functions (v4 model, Node ~20, raw `pg`), one folder per endpoint plus `shared/` helpers. All authorization is enforced in code (no RLS).
- Database: Azure PostgreSQL 15 (Flexible Server). Canonical schema: `migration/azure/01-schema.sql`.
- The app was migrated off Lovable/Supabase (completed June 2026); `supabase/` is kept only as authz-provenance reference.

## Workflow
- `main` receives changes only via pull requests (enforced by a server-side ruleset). Branch off fresh `main`, open a PR, get CI green, merge.
- The backlog lives in GitHub issues: `gh issue list --state open`.

## Preferred development workflow
Default to **subagent-driven development** (`superpowers:subagent-driven-development` skill) for any task with more than a small surface — multi-file refactors, code-review fix sweeps, implementation plans with several discrete pieces, anything where the work decomposes into independent tasks with clear handoffs.

The pattern: extract tasks → dispatch one implementer subagent per task with full task text and scene-setting context → spec-compliance review → code-quality review → mark complete → next task. Sequential within a workstream (parallel implementers on overlapping files conflict). The controller (main session) preserves its own context for orchestration; each subagent gets a fresh, focused window.

For genuinely tiny single-edit changes, do them inline; the skill itself signals when it doesn't apply.

## Verification gates (all must exit 0 before a PR)
- Root: `npm run lint` · `npm test` · `npx tsc --noEmit -p tsconfig.app.json` · `npm run build`
- `functions/`: `npm run build` · `npm test`
- CI (`.github/workflows/ci.yml`) runs the same gates on every PR.

## Conventions
- `.claude/rules/frontend.md` and `.claude/rules/functions.md` hold the hard-won per-tree conventions — read them before touching either tree.
- `docs/adr/` holds the architecture decision records — they define what is and isn't allowed; read them before structural changes. Plain markdown, edited by hand (the adr-kit tooling was removed 2026-06-06).

## Deploys
- Merging to `main` deploys automatically: the SWA workflow ships the frontend (and builds a preview environment per PR), the functions workflow ships the backend. Never deploy from work branches.
- Do not mutate Azure resources (no `az` create/delete/update) without explicit user instruction.
- Do not delete, rotate, overwrite, or print secrets.

## Lovable Source Reference
Lovable workspace **AIR** (`Q7aTXTRh50LxV00N6SRQ`) holds the original project. **Read-only** — no mutating Lovable tools without explicit user instruction.
