# learn-wings — Agent Instructions

Single source of truth for all coding agents. `CLAUDE.md` imports this file — edit HERE, never there.

## Project shape
- `src/` — React 18 + Vite SPA (TypeScript, shadcn/ui + Radix + Tailwind, TanStack Query v5, i18next en+da). Hosted on Azure Static Web Apps.
- `functions/` — Azure Functions (v4 model, Node ~20, raw `pg`), one folder per endpoint plus `shared/` helpers. All authorization is enforced in code (no RLS).
- Database: Azure PostgreSQL 15 (Flexible Server). Canonical schema: `migration/azure/01-schema.sql`.
- The app was migrated off Lovable/Supabase (completed June 2026); `supabase/` is kept only as authz-provenance reference.

## Session start
1. Check the board: `gh issue list --state open` (backlog; an assignee means the issue is claimed).
2. Claim before you code: `gh issue edit <n> --add-assignee @me`. The claim holds until the issue closes — don't unassign when pausing work.

## Collaboration
- **Trunk = `main`; no PRs.** Work on a short-lived feature branch; when the verification gates are green, merge it into `main` directly — `git switch main && git pull && git merge <branch> && git push` — and delete the branch. CI re-runs on `main` as a tripwire.
- **Claim = assignee on the issue** — check assignees before picking work, not open PRs. Give a heads-up before big shared-contract changes (`functions/shared/*`, DB schema); rebase work branches on trunk when it moves.
- **Deploys: only from trunk, never from work branches** — pushing `main` deploys automatically (see Deploys). Announce on the issue.
- **Bookkeeping:** commit messages and the issue are the record. Write what changed and why in commits; close the issue with a summary comment — do not restate it in a file.

## Preferred development workflow
Decompose anything with more than a small surface — multi-file refactors, review-fix sweeps, plans with several discrete pieces — into independent tasks and dispatch one subagent per task, sequentially within a workstream (parallel implementers on overlapping files conflict). Give each one the full task text and enough scene-setting to work without follow-ups, then review its output before moving on. The main session keeps its context for orchestration; each subagent gets a fresh window.

For genuinely tiny single-edit changes, do them inline.

## Verification gates (must exit 0 before landing on `main`)
- **`npm run verify:all`** — runs both trees. Root only: `npm run verify`; backend only: `npm --prefix functions run verify`.
- The gate list lives in `package.json` and nowhere else, so it cannot drift. CI runs the same script. **Do not restate the individual commands in any document** — that is how three of the five previous copies ended up omitting a gate.
- `npm run e2e` — Playwright end-to-end suite against the **deployed** app with a real Entra login and real writes. **On-demand only; deliberately not a CI gate and not part of `npm test`.** See `e2e/README.md`.

## Conventions
- `.claude/rules/frontend.md` and `.claude/rules/functions.md` hold the hard-won per-tree conventions — read them before touching either tree.
- `docs/glossary.md` is the canonical en/da terminology source of truth for user-facing copy (Member not "seat"; Course Catalog; heading == menu label). Match it when writing UI strings.
- `docs/adr/` holds the architecture decision records — they define what is and isn't allowed; read them before structural changes. Plain markdown, edited by hand (the adr-kit tooling was removed 2026-06-06).

## Documentation policy
**Default to writing nothing.** Every doc is a claim that has to be re-verified forever, and this repo has already had to delete a corpus that rotted faster than anyone read it. A doc earns its place only by holding something you cannot get from the code, `git log`, or the GitHub board.

- **Never restate history.** `git log` and closed issues are the archive. No changelogs, no worklogs, no "what shipped" lists in files.
- **Never restate what code already says.** No file inventories, no per-endpoint tables, no counts of things (`~100 functions`, `15 ADRs`) — they are wrong within a month. Describe the convention and let `ls` be the list.
- **Never mirror the issue board.** Open issues, known gaps, and TODOs live in GitHub. A "known gaps" list in a doc is stale the day an issue closes.
- Docs describing current state must stay true or be deleted — never leave "outdated, see X" markers.
- Plans, specs, handovers, and working notes are ephemeral: delete them once consumed, in the change that consumes them.
- Docs change in the same commit as the code they describe.
- ADRs are append-only — supersede with a new ADR, never edit or delete one.
- **There is no status file, and one must not be reintroduced.** A ledger of "current state" is a changelog that has not finished growing yet — this repo has now deleted two. Current state is `git log`, `gh issue list`, and the code.

## Deploys
- Pushing `main` deploys automatically: the SWA workflow ships the frontend, the functions workflow ships the backend. Never deploy from work branches; announce the deploy on the issue (`deploying trunk @<sha>` → `deployed, smoke ok`).
- **The SWA backend is deliberately unlinked** — linked backends don't support preview environments, so the frontend calls the function app directly via `VITE_API_BASE_URL` (set in the SWA workflow to the regionalized host). Consequence: **smoke tests hit that host, not the SWA origin**, where `/api/*` falls through to a static 404. Endpoints are POST-only, so a GET answers 404 — use POST and expect 401 unauthenticated.
- Post-deploy the function host can park in `Error` (worker-restart exhaustion during zipdeploy file churn). Let the ~3 min file sync settle, then `az functionapp restart`.
- **Apply an additive SQL migration to prod BEFORE the deploy that needs it**, not after — the code ships the moment it lands on `main`.
- `functions/orphan-sweep` is the only unattended deleter in the system: daily at 03:00 UTC it deletes blobs older than 24h that no DB row references. Treat unexplained missing media as a sweep question first. Kill switch `ORPHAN_SWEEP_DISABLED=1`; the undo is 7-day blob soft-delete (`allowPermanentDelete=false`), recovered with `az storage blob undelete`.
- The Key Vault `ai-education-migration` uses RBAC, not access policies — `az keyvault set-policy` fails outright; grant `Key Vault Secrets User` via `az role assignment create`. A missing role makes KV references render as the literal `@Microsoft.KeyVault(...)` string at runtime.
- Do not mutate Azure resources (no `az` create/delete/update) without explicit user instruction.
- Do not delete, rotate, overwrite, or print secrets.
