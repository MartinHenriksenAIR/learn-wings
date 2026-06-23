# learn-wings — Agent Instructions

Single source of truth for all coding agents. `CLAUDE.md` imports this file — edit HERE, never there.

## Project shape
- `src/` — React 18 + Vite SPA (TypeScript, shadcn/ui + Radix + Tailwind, TanStack Query v5, i18next en+da). Hosted on Azure Static Web Apps.
- `functions/` — ~100 Azure Functions (v4 model, Node ~20, raw `pg`), one folder per endpoint plus `shared/` helpers. All authorization is enforced in code (no RLS).
- Database: Azure PostgreSQL 15 (Flexible Server). Canonical schema: `migration/azure/01-schema.sql`.
- The app was migrated off Lovable/Supabase (completed June 2026); `supabase/` is kept only as authz-provenance reference.

## Session start
1. Read `migration/STATUS.html` — the live ledger (checkpoint, operational quirks, pointers).
2. Check claims: `gh issue list --state open` (backlog) + `gh pr list --state open` (draft PRs = active claims).
3. Starting work → invoke the `pickup` skill. Ending a session → `handoff`. Executing a slice → `slice-workflow`.

## Collaboration rules (two developers + their agents)
- **Trunk = the `trunk` branch named in `.claude/collab.json`** (currently `main`) — the single source of truth for branch topology; the guard hook and the pickup/handoff skills read it, so re-pointing the trunk edits that one file. The trunk receives changes ONLY via pull requests, enforced by the server-side ruleset on `main`; the local `guard-trunk` hook is best-effort fast feedback on top (its known gaps are documented in the hook header and all land on the server-side wall).
- **Work branches:** `<firstname>/<issue#>-<slug>` off fresh trunk (e.g. `emil/7-collab-setup`). Open a draft PR immediately — the draft PR is the claim.
- **Before claiming:** check the other developer's claimed issues / draft PRs for file-scope overlap ("Files touched" on the issue). Hub-file APPENDS (barrel imports, routes, i18n keys) don't block parallel work — rebase and keep both. Editing the SAME logic or changing shared-contract semantics (`functions/shared/*`, `src/lib/api-client.ts`, DB schema, `AGENTS.md`/`CLAUDE.md`, `.claude/*`) does — serialize, or land the contract change first as its own small PR. Full grading in the `pickup` skill.
- **Review:** cross-review when both developers are active; `/code-review` + self-merge allowed when solo. Rebase work branches on trunk when it moves.
- **Deploys: only from trunk, never from work branches** — merging to `main` deploys automatically (see Deploys). Announce on the merged PR.
- **Bookkeeping:** merged PRs append a dated `migration/WORKLOG.md` entry (append-only) and update `migration/STATUS.html`'s checkpoint.

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
- Merging to `main` deploys automatically: the SWA workflow ships the frontend (and builds a preview environment per PR), the functions workflow ships the backend. Never deploy from work branches; announce the deploy on the merged PR (`deploying trunk @<sha>` → `deployed, smoke ok`).
- Do not mutate Azure resources (no `az` create/delete/update) without explicit user instruction.
- Do not delete, rotate, overwrite, or print secrets.
