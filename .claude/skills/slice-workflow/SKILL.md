---
name: slice-workflow
description: Use when executing a migration slice (course authoring, org admin, resources, decommission) on learn-wings — the slice playbook with the 5-gate Definition of Done, conventions, and deploy/smoke procedure.
---

# Slice workflow — Lovable/Supabase → Azure cutover

**Source of truth:** `docs/superpowers/specs/2026-06-03-supabase-azure-cutover-design.md` (slice definitions §6, cross-cutting items §7). `migration/STATUS.html` supersedes it on operational details (deploy mechanics, hostnames, quirks).

## Shape of a slice
Per spec §3: build the slice's Azure endpoint(s) + mock contract tests → cut its frontend file(s) over to `callApi` → verify e2e in the preview env. Decompose so each task self-verifies: one endpoint = one task (`cd functions && npm test` green); one frontend file = one swap task (zero `supabase.*` by grep + build + tests green); one closing task = e2e checklist.

## Authorization parity
Derive each endpoint's authz from the original RLS policies in `supabase/migrations/` — build a per-endpoint authz table with policy provenance in the slice plan (Slice 5's plan is the model). Platform admins bypass org-membership checks suite-wide; org-admin overrides never apply to global-scope content.

## Definition of Done — 5 gates
1. **Contract tests pass** — mock-DB vitest per endpoint: happy + 401/403 + key errors.
2. **Deployed & reachable** — endpoint registered; smoke 401 unauth / 200 authed.
3. **Frontend cutover proof** — target files: zero `supabase.*` (grep); `npm run build` + `npm test` green.
4. **End-to-end acceptance** — scripted checklist passes in the PR-6 preview against the seeded DB (real Entra login). Gate 4 is user-verified.
5. **Parity** — behaviour matches pre-migration Supabase behaviour.

## Deploy & smoke (current reality — check STATUS.html first)
- Work branches NEVER deploy. Deploys run only from fresh trunk after merge (collaboration rule).
- CI deploy is blocked externally (GitHub ToS block on `Azure/functions-action` — check `gh api repos/Azure/functions-action`). Until lifted, deploy manually: `cd functions && npm install && npm run build && npm test && func azure functionapp publish func-ai-education-migration`.
- Post-deploy: wait ~3 min file sync; if the host parks in `Error`, `az functionapp restart` (operational quirk, expected).
- Smoke against the regionalized function hostname listed in STATUS.html's "Blocked until merge-to-main" section (the SWA `/api/*` route falls through to 404/405 until the post-merge re-link; the classic hostname does not resolve). The hostname lives in STATUS.html only — don't copy it here.
- Announce on the merged PR: `deploying trunk @<short-sha>` → `deployed, smoke ok`.

## Bookkeeping
Merged slice work appends a dated `migration/WORKLOG.md` entry (endpoints, files cut over, fixes, decisions — match existing entries' shape) and updates `migration/STATUS.html` (checkpoint; move fixed Known Issues out). Conventions for code live in `.claude/rules/functions.md` and `.claude/rules/frontend.md` — they load automatically when touching those paths.
