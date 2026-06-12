# Supabase → Azure Cutover — Migration Design Spec

- **Date:** 2026-06-03
- **Branch:** `feature/lovable-migration`
- **Status:** Approved design — ready for implementation planning
- **Related:** `docs/superpowers/plans/2026-05-17-lovable-supabase-migration.md`, `migration/lovable-supabase-removal/`

---

## 1. Context & current state

This branch migrates the LMS off Lovable + Supabase onto Azure (Static Web App frontend, Azure Functions backend, Azure PostgreSQL, Azure Blob Storage, Microsoft Entra ID auth). Lovable itself is already removed (only dead doc references remain). The migration is **partially complete**; this spec defines the remaining work as independently shippable vertical slices.

### What is already done
- **Auth:** `useAuth` rewritten to MSAL / Entra ID; `src/lib/msal-config.ts` + `src/lib/api-client.ts` (`callApi`/`callApiRaw`) added.
- **Edge-function invoke migration:** all old `supabase.functions.invoke` / `/functions/v1` call sites are gone from `src/`.
- **Backend deployed & wired — Slice 0 COMPLETE (2026-06-03):** all **19 functions registered and serving** on `func-ai-education-migration` (Windows, Node `~20`, `@azure/functions` pinned `4.5.0`, single entry `functions/index.ts`, `main: dist/index.js`). SWA is **linked** to the Function App — `/api/*` routes through the SWA URL; direct func-URL calls return 400 by design. App settings live: `DATABASE_URL` (URL-encoded password), `AZURE_STORAGE_ACCOUNT_{NAME,KEY}`, `AZURE_STORAGE_CONTAINER_NAME`, `ALLOWED_ORIGINS`, `ENTRA_CLIENT_ID`, `AzureWebJobsFeatureFlags=EnableWorkerIndexing`. Deploy = `gh workflow run main_func-ai-education-migration.yml --ref <branch>` (zipdeploy syncs ~3 min after the run goes green). Smoke verified: `GET https://black-forest-0d7f96c03.7.azurestaticapps.net/api/user-context` → 401 `{"error":"Missing Bearer token"}`. Note: `admin-user-actions` was renamed **`user-actions-admin`** (reserved route prefix) and its 4 frontend call sites updated.
- **3 upload components already clean:** `azure-video-upload.tsx`, `azure-document-upload.tsx`, `file-upload.tsx`.
- **2 admin files already clean:** `UserDetailDialog.tsx`, `sendInvitationEmail.ts`.

### What is NOT done (verified)
- **`RESEND_API_KEY` / `STATIC_ASSETS_BASE_URL` app settings unset** — `send-invitation-email` returns 500 when actually invoked until they are set (deferred; not needed for most slices).
- **⚠️ Azure PostgreSQL is live but EMPTY (verified 2026-06-03 via in-app probe).** `psql-ai-education-migration` (PG 15) connects fine with the configured `DATABASE_URL`, but `AI_Education` and `postgres` contain **zero user tables** — the Supabase→Azure DB migration never happened (the ~4.4 GB metric was WAL/system overhead). **Slice 0b (database schema + seed) is a new prerequisite for all authenticated e2e:** rebuild the schema from the 42 in-repo `supabase/migrations/*.sql` files (strip RLS policies / `auth.*` / storage-schema specifics), apply the Entra delta the new functions expect (e.g. `profiles.entra_oid`/`entra_tid` — see `functions/user-context`), then seed (pg_dump from live Supabase, or synthetic). Until 0b is done: mock tests, builds, deploys, and unauth 401 smokes all work; **any authed call fails `relation does not exist`**. The DB remains a disposable sandbox — tests may read/write/delete freely.
- **171 direct `supabase.from/.rpc/.storage/.auth` call sites across 28 files remain.** These are almost entirely raw table CRUD with **no existing endpoint** — the 19 written endpoints cover the old invoke operations, not this CRUD. Net-new backend is therefore ~5× larger than "just community/ideas/resources."
- **`@supabase/supabase-js` still a dependency**; `src/integrations/supabase/{client,types}.ts` still present and imported by all 28 files.
- **Old `supabase/functions/` Deno directory (10 functions) still present** — kept intentionally as a rollback path during transition.

---

## 2. Goal & success criteria

**Goal:** Complete the Supabase → Azure cutover so the app runs entirely on Azure Functions + Azure PostgreSQL + Entra auth, with `@supabase/supabase-js` removed.

**Done when:**
1. No `supabase.*` data calls remain in `src/` (grep returns zero).
2. `@supabase/supabase-js` removed from `package.json`; `src/integrations/supabase/{client,types}.ts` deleted; no stale imports.
3. Every migrated feature works end-to-end (frontend → Azure Function → Azure PostgreSQL) in a preview environment.
4. Old `supabase/functions/` Deno directory is commented out / removed only after the full Azure path is verified.

---

## 3. Strategy: vertical feature slices

Work is split into **vertical feature slices**. Each slice takes one domain end-to-end:

> build its Azure endpoint(s) (+ mock contract tests) → cut its frontend file(s) over to `callApi` → verify the feature end-to-end in a preview env.

Each slice is independently buildable, testable, and mergeable. Two horizontal sections bracket the slices: a **backend foundation** (deploy + wire) that everything depends on, and a final **decommission** that can only run once everything else is migrated.

### Subagent-executable task mapping
Within each slice, tasks are decomposed so a subagent can execute and self-verify each one:
- **One endpoint = one task** — implement the Azure Function + its mock contract test; acceptance = `cd functions && npm test` green for that test.
- **One frontend file = one swap task** — re-point its calls to `callApi`; acceptance = file contains zero `supabase.*` (grep) + `npm run build` + `npm test` green.
- **One slice-closing task = e2e verification** — run the slice's acceptance checklist in the preview env (human/browser-assisted via the `verify`/`run` skills).

Each task states its inputs, the contract it implements, and its acceptance check, so it carries no hidden context.

---

## 4. Testing model & per-slice Definition of Done

The Azure PostgreSQL is a **disposable sandbox**, so tests may hit it freely. Testing is two-tier:

- **Mocks for the fast per-task gate** — endpoint contract tests mock the DB (`shared/db.ts`), stay deterministic, and run anywhere with no network/DB. This is the default unit gate (matches existing `functions/*/index.test.ts`).
- **Real DB for integration + e2e** — write-heavy endpoints and preview-env walkthroughs run against the live seeded sandbox DB (create/delete/moderate at will). No separate test DB or transaction-rollback needed; just keep the dev IP whitelisted on the Postgres firewall.

### Definition of Done (5 gates per slice)
1. **Contract tests pass** — each new endpoint has a mock-DB `vitest` test: happy path + authz (401 no token / 403 wrong role) + key error cases.
2. **Deployed & reachable** — endpoint appears in the Function App; smoke check returns 401 unauth / 200 authed.
3. **Frontend cutover proof** — the slice's target files contain **zero `supabase.*`** (grep gate); `npm run build` + `npm test` green.
4. **End-to-end acceptance** — the slice's scripted feature checklist passes in its PR preview environment against the seeded DB.
5. **Parity** — behaviour matches the pre-migration Supabase behaviour.

---

## 5. Section plan (ordered)

| # | Section | New endpoints | Frontend files |
|---|---------|:---:|---|
| 0 | Backend foundation — **✅ DONE 2026-06-03** | 0 (19 deployed & registered) | — |
| 0b | **Database schema + seed (NEW — blocker for authed e2e)** | 0 (SQL: replay repo migrations + Entra delta + seed) | — |
| 0.5 | Shared read endpoints | ~6 | — (consumed by later slices) |
| 1 | Learning (learner) | ~8 | CoursePlayer, Dashboard, Courses, CourseReviewDialog, CourseProgressTab |
| 2 | Course authoring | ~9 | CoursesManager, CourseEditor, QuizEditorDialog |
| 3a | Organizations | ~4 | OrganizationsManager, OrganizationDetail, OrgSelector |
| 3b | Memberships & invitations | ~8 | OrgUsers, OrgMembersTab, BulkInviteDialog, EnrollUserDialog (+dedupe OrgUsers/OrgMembersTab) |
| 3c | AI-champions + user-progress | ~4 | OrgUsers/OrgMembersTab (champion calls), UserProgressDialog |
| 4 | Settings & profile | ~6 | usePlatformSettings, PlatformSettings, OrgSettings, Settings, storage.ts |
| 5 | Community | ~16 | community-api.ts, AIChampionsList, OrgCommunityModeration, PlatformCommunityModeration |
| 6 | Ideas | ~12 | ideas-api.ts (pages lib-only) |
| 7 | Resources | ~5 | resources-api.ts (pages lib-only) |
| 8 | Decommission Supabase | 0 | remove dep, delete `integrations/supabase`, comment out `supabase/` Deno dir |

### Ordering & dependencies
- **0 is a hard prerequisite** for gates 2/4 of every slice (nothing is reachable until the backend is deployed and wired).
- **0.5 before 1–3c** — those slices consume the shared read endpoints (`/organizations`, `/profiles`, `/org-memberships`, `/courses`, `/enrollments`, `/org-course-access`).
- **3a → 3b → 3c** (memberships reference orgs; champions/progress reference memberships).
- **Files spanning slices:** `OrgUsers.tsx` / `OrgMembersTab.tsx` have calls handled in both 3b (memberships/invitations) and 3c (champions); their grep-clean gate (DoD #3) is only satisfied after 3c. `AIChampionsList.tsx` (read consumer) migrates in Slice 5, which owns `GET /community/ai-champions`; Slice 3c owns only the champion write endpoints (`POST/DELETE /api/ai-champions`).
- **5 before/with its moderation pages**; 6 and 7 are independent and can run in parallel after 0.5.
- **8 must be last** — only after every other slice's grep gate is clean.

---

## 6. Per-section detail

### Slice 0 — Backend foundation — ✅ COMPLETE (2026-06-03)
All 19 functions deployed, registered, and serving; SWA linked; app settings live (see §1). Nine latent bugs were found and fixed in the process — three of them were the stacked cause of "0 functions found": (1) `main` was the scaffold placeholder `dist/{functionName}/index.js` → replaced with a single-entry `functions/index.ts` barrel; (2) `new Resend(env)` at module top level threw without `RESEND_API_KEY`, crashing the worker entry point and deregistering everything → lazy-init; (3) `admin-user-actions` used a reserved route prefix → renamed `user-actions-admin`. Plus: 3 missing `await authenticate()`, a `req.json()` typing error, the functions vitest picking up the repo-root postcss config, and `^4.5.0` floating to an incompatible `@azure/functions` 4.14 → pinned `4.5.0`.
- **Deploy:** `gh workflow run main_func-ai-education-migration.yml --ref <branch>`; allow ~3 min zipdeploy sync after the run is green.
- **Local registration repro:** `cd functions && func start` (requires the gitignored `functions/local.settings.json`).
- **Open leftover:** `RESEND_API_KEY` unset (send-invitation-email 500s when invoked).

### Slice 0.5 — Shared read endpoints
Build once, consumed by many: `GET /api/organizations` (+ `/:id`), `GET /api/profiles`, `GET /api/org-memberships?orgId=`, `GET /api/courses`, `GET /api/enrollments`, `GET /api/org-course-access?orgId=`.

### Slice 1 — Learning (15 sites → ~8 endpoints)
- `GET /api/quiz-by-lesson` (CoursePlayer:101,110 — quiz + questions, no `is_correct`)
- `GET /api/learner-dashboard` (Dashboard:42,61,73,92)
- `GET /api/learner-courses` (Courses:57,66,85)
- `POST /api/enroll` (Courses:107) ; `POST /api/unenroll` (Courses:136)
- `POST /api/course-review` (CourseReviewDialog:67 — upsert)
- `GET /api/org-course-progress` (CourseProgressTab:75,88) ; `GET /api/org-course-enrollees` (CourseProgressTab:120)
- Note: `org-analytics-data` does **not** cover the per-course rollups — these are new.

### Slice 2 — Course authoring (30 sites → ~9 endpoints; 3 upload files already clean)
- `GET /api/admin-courses` (CoursesManager:78–80)
- `POST/PATCH/DELETE /api/admin-course` (create/publish/edit/delete; CoursesManager:111,131,143 + CourseEditor:82,130,288)
- `PUT /api/admin-course-access` (CoursesManager:172,185) ; `POST /api/admin-course-access-bulk` (CoursesManager:214,220)
- `GET /api/admin-course-structure` (CourseEditor:96,106)
- `POST/PUT/DELETE /api/admin-module` (CourseEditor:161,166,177)
- `POST/PUT/DELETE /api/admin-lesson` (CourseEditor:230,236,276) — **server-side consolidation:** DELETE absorbs fetch-blob-path → `azure-delete-blob` → delete-row (CourseEditor:248,262,276)
- `GET /api/admin-quiz` + `PUT /api/admin-quiz` (QuizEditorDialog:67,85 + 224–285) — **server-side consolidation:** PUT replaces the 7-statement client transaction atomically.

### Slice 3a — Organizations (~4 endpoints)
- `GET /api/organizations` (+ `/:id`), `POST /api/organizations`, `PATCH /api/organizations/:id`, `DELETE /api/organizations/:id`.
- Files: OrganizationsManager, OrganizationDetail (org parts), OrgSelector.
- Replace `getPublicUrl('org-logos')` (OrganizationsManager:258, OrganizationDetail:1009) with plain URL construction (use the `VITE_STORAGE_BASE_URL` pattern at OrgAnalytics.tsx:194).

### Slice 3b — Memberships & invitations (~8 endpoints)
- Memberships: `POST /api/org-memberships`, `PATCH /api/org-memberships/:id`, `DELETE /api/org-memberships/:id` (reads via 0.5).
- Invitations: `GET /api/invitations?orgId=&scope=org|platform` (wraps `get_org_invitations_safe`/`get_platform_invitations_safe`), `POST /api/invitations` (+ `/bulk` for BulkInviteDialog), `PATCH /api/invitations/:id`.
- Enrollment: `POST /api/enrollments` (EnrollUserDialog:138; reads via 0.5).
- **Reconcile `invitation-link`:** the existing endpoint takes `{orgId}`; OrgUsers:192 / OrgMembersTab:189 / BulkInviteDialog:207 still call the RPC with `{invitation_id}`. Switch callers to the `{orgId}` pattern already used at OrganizationDetail:338.
- **Dedupe** the near-identical `OrgUsers.tsx` and `OrgMembersTab.tsx` (same 12 calls each).

### Slice 3c — AI-champions + user-progress (~4 endpoints)
- `GET /api/ai-champions?orgId=`, `POST /api/ai-champions`, `DELETE /api/ai-champions`.
- `GET /api/user-progress?orgId=&userId=` — aggregates UserProgressDialog's 5 queries (enrollments+courses+modules+lessons+lesson_progress+quizzes+quiz_attempts) into one endpoint.

### Slice 4 — Settings & profile (~6 endpoints)
- `GET /api/platform-settings`, `PUT /api/platform-settings/:key` (usePlatformSettings:97, PlatformSettings:98,129).
- `GET /api/org-settings?orgId=`, `PUT /api/org-settings` (usePlatformSettings:99, OrgSettings:54).
- `PATCH /api/profile` — **self-update of own profile** (Settings.tsx:65,106; `user_id` from token). Profile *reads* already come from `user-context`.
- Generic asset signer for `storage.ts:16` — extend `azure-view-url` to accept a bucket/asset-type param, or add `POST /api/asset-signed-url`, since the current endpoint only authorizes lesson video/document paths (not `lms-assets` thumbnails).

### Slice 5 — Community (31 sites → ~16 endpoints)
Tables: `community_categories`, `community_posts`, `community_comments`, `community_reports`, `ai_champions`.
- Categories: `GET /community/categories`.
- Posts: `GET /community/posts` (list, joins, comment_count), `GET /community/posts/:id`, `POST/PATCH/DELETE /community/posts/:id`.
- Comments: `GET /community/posts/:id/comments`, `POST /community/posts/:id/comments`, `PATCH/DELETE /community/comments/:id`.
- Reports: `POST /community/reports` (dedupe per reporter/target), `GET /community/reports?orgId=|scope=global&status=`, `PATCH /community/reports/:id`.
- Moderation: `PATCH /community/posts/:id/moderate` (is_hidden/is_locked), `PATCH /community/comments/:id/moderate`.
- `GET /community/ai-champions?orgId=` (read; assignment endpoints live in 3c).
- **Pages `CommunityFeed`/`PostDetail`/`PostEdit` are lib-only** (migrating `community-api.ts` internals covers them). **Direct-call files needing re-point:** `AIChampionsList.tsx`, `OrgCommunityModeration.tsx`, `PlatformCommunityModeration.tsx`.

### Slice 6 — Ideas (21 sites → ~12 endpoints; all pages lib-only)
Tables: `ideas`, `idea_comments`, `idea_votes`.
- `GET /ideas`, `GET /ideas/:id`, `POST /ideas`, `PATCH /ideas/:id`, `POST /ideas/:id/submit`, `PATCH /ideas/:id/status`, `DELETE /ideas/:id`.
- `POST /ideas/:id/vote`, `DELETE /ideas/:id/vote`.
- `GET /ideas/:id/comments`, `POST /ideas/:id/comments`, `GET /ideas/tags?orgId=`.
- List/detail compute comment & vote counts server-side (replace client-side N+1).

### Slice 7 — Resources (5 sites → ~5 endpoints; all pages lib-only)
Table: `community_resources`.
- `GET /resources`, `POST /resources`, `PATCH /resources/:id`, `DELETE /resources/:id`, `PATCH /resources/:id/pin`.
- New endpoints derive `user_id` from token (the lib currently passes it in).

### Slice 8 — Decommission Supabase
- Remove `@supabase/supabase-js` from `package.json` (+ lockfile).
- Delete `src/integrations/supabase/{client,types}.ts`; fix any stale imports.
- Remove `VITE_SUPABASE_*` from `.env.example` / config.
- **Comment out the old `supabase/functions/` Deno directory, then run the full regression / e2e suite to confirm the Lovable→Azure swap holds.** Remove the directory only after that passes.

---

## 7. Cross-cutting items (tracked once, applied where they appear)
- **Route names must NOT start with `admin`** (`admin`, `runtime`, `host` are reserved Azure Functions route prefixes — the host refuses to register them). Use suffix style instead: `quiz-options-admin`, `user-actions-admin`. All `admin-*` route proposals in §6 (e.g. `admin-courses`, `admin-course`, `admin-module`, `admin-lesson`, `admin-quiz`) must be renamed accordingly during planning (e.g. `courses-admin`, `course-admin`, `module-admin`, `lesson-admin`, `quiz-admin`).
- **No module-load-time side effects in functions.** Constructing clients that throw without config (e.g. `new Resend(...)`) at top level crashes the worker entry point and deregisters ALL functions. Initialize lazily inside handlers (see send-invitation-email).
- **Every new function MUST be imported in the `functions/index.ts` entry barrel** (`main: dist/index.js`) — an unimported function silently never registers.
- **`@azure/functions` stays pinned to exact `4.5.0`** — floating `^` pulled 4.14.0, which fails the worker handshake on the deployed (Windows, Node ~20) app. Don't bump without re-verifying registration via `func start` + a deploy smoke.
- **`invitation-link` contract reconciliation** — `{invitation_id}` callers → `{orgId}` pattern (Slice 3b).
- **`storage.ts` generic signer gap** — `azure-view-url` only authorizes lesson assets (Slice 4).
- **`OrgUsers.tsx` / `OrgMembersTab.tsx` dedupe** — near-identical (Slice 3b).
- **`getPublicUrl` false-positives** — synchronous URL builders, not data calls → plain URL construction (Slice 3a).
- **`supabase.auth.getUser()` (~7 sites)** — no endpoint; collapse into server-side token identity inside Functions.

---

## 8. Coverage reconciliation

Authoritative grep: **171 `supabase.from/.rpc/.storage/.auth` call sites across 28 files.**
- **~162 → new endpoints** across Slices 0.5–7.
- **~7 `supabase.auth.getUser()`** → server-side token identity (no endpoint).
- **2 `getPublicUrl`** → plain URL construction.
- All 28 files map to a slice; `Slice 8` deletes the `integrations/supabase` client/types that back them.

(`Settings.tsx`, missed by the initial discovery pass, is folded into Slice 4.)

---

## 9. Assumptions, risks, out of scope

**Assumptions**
- Azure PostgreSQL is a disposable sandbox until prod (free to read/write/delete in tests).
- The seeded DB schema matches what the written Functions expect; the first **authenticated** call per endpoint (a real Entra login in a preview env) is what proves each DB round-trip — unauth smoke (401) only proves deploy + auth gate.
- ~~Backend deploy/config (Slice 0) is in scope for this effort.~~ **Done 2026-06-03.**

**Risks**
- **Schema drift** between Supabase and Azure Postgres could break endpoints — caught at Slice 0 smoke + per-slice integration tests.
- **RLS loss:** Azure Postgres has no row-level security; every endpoint must enforce tenant/role authorization in app code (already a theme in the function matrix — preserve it).
- **`main` is ruleset-protected;** all slices land via reviewed PRs (preview env per PR is the e2e surface).
- Endpoint counts (~75 new) are estimates from discovery; exact shapes finalised per slice during planning.

**Out of scope**
- Building net-new product features (migration parity only).
- Custom domain / DNS for the SWA.
- Production data migration (sandbox is wiped before prod).
