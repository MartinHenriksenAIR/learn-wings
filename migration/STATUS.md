# Migration Status — Live Ledger (Lovable/Supabase → Azure)

The LIVE state of the migration: known issues, current checkpoint, pickup pointers. **Load this file at session start** — it is small on purpose. Maintained in place: items move OUT of here when resolved, into a dated entry in `migration/WORKLOG.md` (the append-only history — read that only when you need the *why* behind a decision).

## Known Issues & Open Items (as of 2026-06-06) 

# human logged

- refresh anywhere brings you back to the dashboard, should stick to page of refresh origin
- be able to close toasts manually, they take too long to auto-discard

### Broken — expected, slice-scoped

Shared root cause for all of these: the page/API layer still uses the Supabase client, which has NO auth session under MSAL — `supabase.auth.getUser()` returns null and RLS rejects/strands writes. Fixed per-slice as each area is cut over to `callApi`.

- KNOWN BUG: the remaining still-Supabase areas (admin pages, resources — 13 files importing the supabase client, across Slices 2, 3a–3c, 7) fail or hang writes for the same root cause; not yet individually confirmed by manual testing.
- KNOWN BUG (same class, found 2026-06-06 via the Slice 6 drafts bug): `ResourceLibrary.tsx:255` compares `resource.user_id === user?.id` — `user.id` is the Entra OID, row `user_id` is the profiles UUID; never matches post-migration. Fix in **Slice 7** (use `profile?.id`). **Cutover checklist item for ALL remaining slices: audit the slice's pages for `user?.id` ownership comparisons.**
- KNOWN BUG: `send-invitation-email` 500s when invoked — `RESEND_API_KEY` + `STATIC_ASSETS_BASE_URL` app settings unset.

### Broken — small, unscoped
- OBSERVATION (2026-06-06, unconfirmed/needs repro): during idea-draft preview testing the console showed `azure-view-url` → 403 + "Error loading signed URLs: Access denied" on a learner session. Not from Slice 6 (endpoint and `storage.ts` untouched). Possibly the known lesson-asset authz gate firing on a thumbnail for a non-enrolled course. Capture which page/asset triggers it next time it appears.
- KNOWN BUG: `grade-quiz` silently records no `quiz_attempts` row for platform admins without a membership (pre-existing quirk, kept as-is).
- KNOWN BUG: `course-player-data` has no per-course access gate — any authenticated user with a profile can pull any published course's player payload. Inconsistent with `quiz-by-lesson`, which gates on org access. Align in a future slice.

### Accepted trade-offs (reviewed, deliberately kept)
- `enroll` check-then-insert TOCTOU on course availability — harmless; the `UNIQUE(org_id,user_id,course_id)` constraint backstops it.
- Platform admins can write `course_reviews` in orgs they're not members of — consequence of the suite-wide admin-bypass convention.

### Operational quirks (not bugs, recurring)
- Post-deploy the function host can park in `Error` (worker-restart exhaustion during zipdeploy file churn) — run `az functionapp restart` after the ~3 min file sync settles.
- `gh workflow run` failing 403 "Must have admin rights to Repository" = wrong ACTIVE gh account (found switched to the work account mid-Slice-5) — fix with `gh auth switch --user emkataumre`.
- 2026-06-05: GitHub placed a **ToS block on the `Azure/functions-action` repository** (during a GitHub-wide "Disruption with some GitHub services" incident; the incident later resolved WITHOUT lifting the block) — the deploy job dies at "Set up job: Repository access blocked" while the build job passes. External. **CI deploys stay broken until the block lifts** — check with `gh api repos/Azure/functions-action`, then `gh run rerun <run-id> --failed`. Workaround used for Slice 5: manual `func azure functionapp publish func-ai-education-migration` (same Kudu zipdeploy mechanism, same publish target).
- One-off anomaly (2026-06-05): `functions/index.ts` found modified in the working tree mid-session — all 16 community barrel imports removed, uncommitted, not produced by any session commit. Restored to HEAD after user confirmation. If it recurs, suspect local tooling.

### CI debt
- ~~Deprecated Node 20 actions~~ — RESOLVED 2026-06-06: action versions bumped to Node 24-compatible majors (commit 7545cb2) ahead of GitHub's 2026-06-16 cutoff. The `Azure/functions-action` ToS block (see Operational quirks) is unaffected and still blocks the deploy job.
- Idea (emil): build a more involved CI/CD pipeline with test gates — would force tests to be written for areas that lack them (frontend pages, e2e). The functions workflow already runs `npm test --if-present`; the SWA workflow has no test step.

### Hardening / debt
- TODO security: 500 bodies propagate `err.message` suite-wide (CWE-209 per automated review) — candidate ADR: generic 500 + context logging.
- TODO auth: `functions/shared/db.ts` uses `ssl: { rejectUnauthorized: false }` — move to verify-full with the Azure CA bundle.
- ADR-0006 says Node.js 22 but the live runtime is pinned `~20` (Node 22 worker gRPC crash) — ADR needs amending.
- Rotate the Postgres admin password before prod cutover (exposed once in a terminal session; DB is a disposable sandbox until cutover).

### BLOCKED until merge-to-main
- Re-link the SWA backend, set `VITE_API_BASE_URL=""` (back to same-origin `/api`), optionally restore the portal.azure.com platform CORS entry.
- Until then, ALL smoke tests must hit the regionalized function hostname (`func-ai-education-migration-c0fgeqdnfvd6h0cf.swedencentral-01.azurewebsites.net`) — the SWA `/api/*` route falls through to static 404/405, and the classic `func-ai-education-migration.azurewebsites.net` hostname does not resolve.
- Production redirect URIs on the Entra app registration as environments solidify.

### Pre-cutover user actions (carried from Phase 1)
- Q7: link `ai-uddannelse.dk` to the SWA + add it as an Entra redirect URI.
- Add `resend-api-key` (and set the two missing app settings above).

### Cosmetic / test polish (review nits, explicitly approved as non-blocking)
- Minor test-suite nits in the courses/profiles tests; `!access?.ok` style in `quiz-by-lesson`; similar style-level comments from the quality reviewers on Slices 0.5+1.
- Slice 4 reviewer notes (non-blocking): `profile-update` would return `200 {profile: null}` if the row vanished between getProfile and UPDATE (theoretical race; mirrors the suite pattern — candidate for the hardening pass); the `usePlatformSettings` provider's outer catch is silent (no toast) — nearly unreachable since each call has its own fallback.
- Slice 6 reviewer notes (non-blocking): `idea-update`'s happy-path test asserts param membership, not index order (a `$n` transposition would slip past it); `idea-comments`' own-draft-but-non-member case is unpinned (returns `[]` today); `fetchIdeaComments` keeps the legacy loose `any[]` return type (an `IdeaComment` interface is a future-typing candidate); Courses.test.tsx's keep-spinner case only pins initial render (a dropped `profile` effect-dep wouldn't be caught).

---

## Current State (post-Slice-6 checkpoint — 2026-06-06)

**Branch:** `feature/lovable-migration` (PR #6 open; preview env is the live test surface)

**Done:** Slice 0 (backend stand-up), Slice 0b (schema + seed), Slice 0.5 (shared reads), Slice 1 (learner flow), Slice 4 (settings & profile) — all user-verified end-to-end on the PR-6 preview (Slice 4 Gate 4 passed 2026-06-05; PlatformSettings/OrgSettings pages carry deferred test debt until admin elevation). Slice 5 (community) code-complete with both review stages passed per task, deployed (manual `func publish` — CI blocked externally), and 401-smoked 16/16; user e2e on the preview pending (moderation pages additionally deferred until admin elevation, same as Slice 4's settings pages). Slice 6 (ideas) code-complete with both review stages passed per task + a final integration review, deployed (manual `func publish` — CI still ToS-blocked), 401-smoked 12/12 (67 functions live); user e2e on the preview pending (learner flow: create draft → save → submit → vote/unvote → comment; plus the fixed unenroll dialog).

**Remaining slices:** 2 (course authoring), 3a/3b/3c (org & user admin), 7 (resources), 8 (decommission Supabase).

---

## Picking Up From Here

1. Read this file in full — it supersedes anything dated in `migration/WORKLOG.md` (the append-only history)
2. Read `docs/superpowers/specs/2026-06-03-supabase-azure-cutover-design.md` (untracked, disk-only) — slice definitions, conventions (§7), Definition of Done gates
3. Read `migration/azure/README.md` — seeded UUIDs and how to elevate a profile
4. Read `docs/adr/` — 12 ADRs define what is and isn't allowed
5. Check `CLAUDE.md` for agent constraints before taking any action
