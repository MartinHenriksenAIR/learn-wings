# Migration Worklog — Lovable/Supabase → Azure

Chronological log of all planning and decision work. Picks up where git log leaves off.
For implementation progress, see the implementation plan: `docs/superpowers/plans/2026-05-17-lovable-supabase-migration.md`.

---

## 2026-05-17 — Phase 0: Discovery + Planning

**Who:** le-dawg + Claude

**Done:**
- Full codebase inventory: 10 Supabase Deno Edge Functions, 42 PostgreSQL migrations, 190 lines of RLS/auth.uid() references, 12 frontend call sites for supabase functions, `@supabase/supabase-js` v2.93.1 + `lovable-tagger` v1.1.13 dependencies
- Azure resource inventory: `func-ai-education-migration` (Node 22, empty), `psql-ai-education-migration` (PG Flexible Server), `staieducationmigration` (blob storage), `stapp-ai-education-migration` (SWA), `ai-education-migration` Key Vault
- Identified all Supabase-specific constructs to drop: auth schema references, RLS policies, `handle_new_user` trigger, `on_auth_user_created` trigger, `is_platform_admin/org_admin/org_member` functions, `current_org_ids_for_user`, old `can_access_lms_asset` (single-arg version)
- Wrote full migration spec: `migration/lovable-supabase-removal/` (00–10 + patches + proposed-iac + rollback)
- Wrote 25-task implementation plan: `docs/superpowers/plans/2026-05-17-lovable-supabase-migration.md`

**Decided:**
- Auth: multi-tenant Microsoft Entra ID (NOT Azure AD B2C) — see Q1 + ADR-0005
- Audience type: `AzureADMultipleOrgs` (work/school accounts from any tenant; no personal MSA)
- Authority: `https://login.microsoftonline.com/common`
- Frontend auth: `@azure/msal-browser` + `@azure/msal-react`, `loginRedirect` flow
- Backend JWT validation: `jwks-rsa` + `jsonwebtoken`, RS256, issuer regex (multi-tenant)
- User identity: `oid` + `tid` composite (both required for global uniqueness)

**Open questions filed:** 10 questions in `migration/lovable-supabase-removal/10-open-questions.md`

---

## 2026-05-19 — Phase 1: Azure Verification + Q Resolution

**Who:** le-dawg + Claude

**Done:**
- Ran Azure CLI queries to resolve Q3–Q7 against live infrastructure
- Queried Lovable MCP to get DB counts (22 profiles — Q8)
- Confirmed Supabase project `cairuxpyfshugwjrrqha` is Lovable-managed — not in owner's Supabase Dashboard (Q9)

**Resolved all 10 open questions:**

| Q | Resolution |
|---|-----------|
| Q1 Auth provider | ✅ Multi-tenant Entra ID (decided in Phase 0) |
| Q2 DB migration | ⚠️ Not a blocker — Task 23 only; 4–6h effort; needs pg_dump + RLS strip |
| Q3 Key Vault secrets | ✅ 3 secrets exist (`storage-account-key`, `postgresql-admin-password`, `acr-password`); `database-url` superseded 2026-06-03 — `DATABASE_URL` set directly as a Function App app setting; `resend-api-key` still missing (see Known Issues) |
| Q4 SWA settings | ✅ Empty — add 4 `VITE_*` vars at deploy time |
| Q5 Storage CORS | ✅ No rules — SAS pattern doesn't need CORS |
| Q6 VNet | ✅ Not needed — public endpoint + `AllowAllAzureServicesAndResourcesWithinAzureIps` rule |
| Q7 Custom domain | ⚠️ `ai-uddannelse.dk` not linked to SWA — **[USER ACTION REQUIRED pre-cutover]**: CNAME + Azure Portal + Entra redirect URI |
| Q8 User count | ✅ 22 profiles — manual merge feasible at cutover |
| Q9 seed-mock-users security | ✅ Mitigated by migration — Lovable-managed Supabase, risk ends at cutover |
| Q10 Email logo | ✅ Move to `email-assets` blob container — Task 16 |

**Azure findings logged:**
- PostgreSQL admin user: `AIUadmin`
- Function App outbound IPs: 19 IPs (logged in Q3 for postgres firewall hardening post-cutover)
- Storage containers already present: `lms-videos`, `lms-documents` (email-assets must be created — Task 16)
- Function App plan: Dedicated App Service Plan `ASP-AIEducation-bfca` (not consumption — no cold starts)

---

## 2026-05-19 — Phase 2: ADR Setup + adr-kit Fixes

**Who:** le-dawg + Claude

**Done:**
- Set up adr-kit MCP server (solution8-com/AIRStack-ADRKit v0.2.7)
- User created `.mcp.json` manually (agent hard-blocked from writing this file — Claude Code security constraint)
- Schema bug in adr-kit prevented `adr_approve` — manually installed schema from GitHub as workaround
- Created `CLAUDE.md` + `AGENTS.md`: sequential ADR approval rule, migration safety constraints, Lovable AIR workspace ID
- Created 9 baseline ADRs (`docs/adr/ADR-0001` → `ADR-0009`) — all accepted

**ADR decisions locked:**
| ADR | Decision |
|-----|---------|
| 0001 | React 18 + Vite SPA — no SSR, no Vue/Angular |
| 0002 | TypeScript strict mode — no plain JS in src/ or functions/ |
| 0003 | shadcn/ui + Radix UI + Tailwind — no MUI/Antd/Chakra |
| 0004 | TanStack Query v5 — no SWR/Redux/Zustand |
| 0005 | Multi-tenant Entra ID (`AzureADMultipleOrgs`) — no Supabase Auth, no custom JWT |
| 0006 | Azure Functions v4 Node.js 22 (dedicated S1 plan) — no Express/Deno/Bun |
| 0007 | Azure PostgreSQL + `pg` client — no ORM, no Prisma, no Supabase client |
| 0008 | Azure Blob Storage + SAS tokens — no Supabase Storage, no S3 |
| 0009 | Resend for email — no Nodemailer/SendGrid |

**Bugs found and fixed upstream:**
- Filed GitHub issues #23 and #24 on `kschlt/adr-kit`
- Filed PR #1 on `solution8-com/AIRStack-ADRKit` (fixes: wrong MCP config filename `.claude-mcp-config.json` → `.mcp.json`, wrong JSON key `"servers"` → `"mcpServers"`, removed stale hardcoded tool list, fixed schema path resolution, added package-data config)

**ADR YAML bug fixed:**
- All 9 ADRs had `]approval_date` concatenated on one line — broke YAML parsing in adr-kit tools
- Fixed with newline insertion; also fixed ADR-0005 audience ambiguity and ADR-0006 billing contradiction

---

## 2026-05-20 → 2026-06-02 — Implementation Phases (see git log)

Backend scaffolding, MSAL frontend auth, the original function ports, and ADR-0010→0012
landed during this window. Not re-narrated here — `git log` on `feature/lovable-migration`
plus `docs/handover-supabase-migration-2026-05-20.md` cover it.

---

## 2026-06-03 — Repo Hygiene + SWA Pipeline Fix

**Who:** emil & martin

**Done:**
- Untracked `.env`, added to `.gitignore` (PR #5 → main)
- Fixed the failing SWA deploy ("GitHub action was run in a different branch than the one the build is requested for"):
  - Rewrote `.github/workflows/azure-static-web-apps-black-forest-0d7f96c03.yml` to the canonical token workflow (`repo_token: ${{ secrets.GITHUB_TOKEN }}`, no OIDC `github_id_token`)
  - Flipped SWA `deploymentAuthPolicy` from GitHub-linked to `DeploymentToken` (az rest PATCH)
- gh CLI lesson: pushes touching `.github/workflows/` need the gh credential helper with workflow scope, not GCM (`git -c "credential.helper=" -c "credential.helper=!gh auth git-credential" push ...`)

---

## 2026-06-03 — Cutover Re-Planning (Vertical Slices)

**Who:** emil & martin

**Done:**
- Audited remaining Supabase usage: 166 direct `supabase.from/.rpc` calls across 23+ frontend files beyond what the 25-task plan had covered
- Re-planned remaining work as **vertical feature slices 0–8**, each with a 5-gate Definition of Done, designed for subagent-driven execution
- Spec lives at `docs/superpowers/specs/2026-06-03-supabase-azure-cutover-design.md` — **deliberately untracked** (disk-only, per owner decision)

**Decided:**
- DB content: synthetic seed data, not a production dump — sandbox DB is disposable until prod cutover
- Execution model: fresh Claude sessions per slice driven by `/goal` + handoff prompt, this session as overseer

---

## 2026-06-03 — Slice 0: Backend Stand-Up (commits 0ca1fb7 → 90d1073)

**Who:** emil & martin

The function app showed **"0 functions found"** on every deploy. Three stacked root causes:

1. `package.json` `main` was a scaffold glob placeholder → replaced with a single-entry barrel `functions/index.ts` (+ `main: dist/index.js`). Barrel imports are now mandatory for every new function module.
2. `new Resend(process.env.RESEND_API_KEY)` at module top level throws when the env var is unset, crashing the worker entry and deregistering ALL functions → lazy init inside the handler. Convention: no load-time side effects that can throw.
3. Function/route names may not start with `admin` (reserved host prefixes: admin/runtime/host) → `admin-user-actions` renamed `user-actions-admin` (+4 frontend call sites).

**Also fixed:**
- Node 22 worker crashed with gRPC `14 UNAVAILABLE` → pinned `WEBSITE_NODE_DEFAULT_VERSION=~20` (contradicts ADR-0006 "Node.js 22" — see Known Issues)
- `^4.5.0` floated `@azure/functions` to 4.14.0 mid-debugging → pinned exactly `4.5.0`
- Functions vitest picked up root postcss/tailwind config → empty postcss plugins in `functions/vitest.config.ts`
- App settings configured: `DATABASE_URL` (password URL-encoded — it contains `#`), storage account creds, `ALLOWED_ORIGINS`, `ENTRA_CLIENT_ID`, `AzureWebJobsFeatureFlags=EnableWorkerIndexing`

**Outcome:** all functions registered and serving.

---

## 2026-06-03 — Slice 0b: DB Schema + Synthetic Seed (commit 20df6f3)

**Who:** emil & martin

- Azure PG was found **EMPTY** — the assumed "seeded 4.4 GB" was WAL/system overhead
- Squashed the 42 `supabase/migrations/*.sql` into `migration/azure/01-schema.sql` (RLS/auth/storage stripped; `uuid_generate_v4`→`gen_random_uuid`; Entra delta: `profiles.entra_oid/entra_tid/email/avatar_url`; `quiz_options.sort_order`; 3 RPCs ported with explicit `p_user_id`)
- `migration/azure/02-seed.sql`: synthetic org/profiles/course/quiz/enrollment — fixed UUIDs documented in `migration/azure/README.md`
- `pgcrypto` allow-listed via server param `azure.extensions=PGCRYPTO`
- Applied and verified: **30 tables live** in `AI_Education`

---

## 2026-06-03 — Slices 0.5 + 1: Shared Reads + Learner Flow (fresh subagent session)

**Who:** emil & martin (subagent-driven session)

- 14 new endpoints deployed (organizations, profiles, org-memberships, courses, enrollments, org-course-access, quiz-by-lesson, learner-dashboard, learner-courses, enroll, unenroll, course-review, org-course-progress, org-course-enrollees) — 33 functions total
- New `functions/shared/profile.ts` (`getProfile` via `entra_oid+entra_tid`, `isActiveMember`, `isOrgAdmin`) — **the canonical identity/authz pattern for all future endpoints**
- 5 learner frontend files cut over to `callApi`: CoursePlayer, Dashboard, Courses, CourseReviewDialog, CourseProgressTab
- **Identity retrofit** (commits 3bd87c3 → a348dfd): course-player-data, lesson-progress, enrollment-complete, grade-quiz, and all four `azure-*` functions migrated from raw token claims to `getProfile`; `invitation-link` rewritten against `invitations.link_id` (was querying a non-existent table)

**Accepted trade-offs:** enroll has a harmless check-then-insert TOCTOU (unique constraint backstops it); platform admins bypass org-membership checks suite-wide by convention.

---

## 2026-06-03/04 — E2E Surface + Login Debugging (PR #6 preview)

**Who:** emil & martin

Getting an authenticated end-to-end test environment up surfaced a chain of issues, all fixed:

- **SWA preview `/api` 404:** linked backends don't support preview environments → backend UNLINKED (f4f5cff); frontend calls the function app directly via `VITE_API_BASE_URL` (regionalized hostname `func-ai-education-migration-c0fgeqdnfvd6h0cf.swedencentral-01.azurewebsites.net` — the classic hostname does not resolve)
- **Direct calls 400 after unlink:** Easy Auth residue from the old SWA link → `authsettingsV2 platform.enabled=false` via az rest PUT
- **Preflights 500 (two causes):** platform-level CORS list intercepts ALL preflights before app code → emptied; `corsPreflightResponse` returned a bodied 204 — undici rejects bodied 204s → body removed (f6fad3f)
- **Post-deploy host parks in `Error`:** worker-restart exhaustion during zipdeploy churn → `az functionapp restart` after file sync settles recovers it (standing operational note)
- **Login silently bounced to /login:** React Router's `/`→`/login` replace destroyed the `#code=` hash before MSAL could consume it → `main.tsx` now awaits `handleRedirectPromise()` + `setActiveAccount()` BEFORE rendering (2494c32); also fixed Login.tsx navigating admins to non-existent routes
- **Hard refresh 404 on client routes:** added `public/staticwebapp.config.json` `navigationFallback` (8639615)
- Build-time `VITE_*` env added to the SWA workflow (69f0154) — including Supabase anon values still needed by unmigrated pages

**🏆 2026-06-04: full authenticated learner e2e PASSED** — real Entra login on the PR-6 preview → profile self-provisioned → dashboard → course list → enroll → course player → lesson progress → quiz completion, all against Azure Functions + Azure PG. This is Gate 4 for Slices 0.5 + 1.

---

## 2026-06-04 — Slice 4: Settings & Profile (commits f8f1126 → c468ec8)

**Who:** emil & martin (subagent-driven session)

**6 new endpoints deployed (39 functions total):** `profile-update`, `platform-settings`, `platform-settings-update`, `org-settings`, `org-settings-update`, `asset-signed-url` — each with mock contract tests (functions suite now 284 passing). `user-context` widened to also return `first_name/last_name/department/preferred_language/created_at` (its SELECT and INSERT…RETURNING omitted them, so Settings could never display saved values and `refreshUserContext()` couldn't round-trip).

**5 frontend files cut over to `callApi` (zero `supabase.*` remain):** `Settings.tsx`, `usePlatformSettings.tsx`, `platform-admin/PlatformSettings.tsx`, `org-admin/OrgSettings.tsx`, `lib/storage.ts`.

**FIXED (was Known Issues, confirmed manually 2026-06-04):**
- **Profile saves (first/last name, department) loaded forever and never persisted.**
- **Language change spinner spun forever** (the change itself applied via i18next+localStorage and survived refresh).

**Root cause pinned (answers the "which limb" question):** neither RLS nor `refreshUserContext()` — commit `d288e20` (the old Task 21 invoke-migration) removed `Settings.tsx`'s `import { supabase } …` line but left both `supabase.from('profiles').update(…)` call bodies. Each handler threw `ReferenceError: supabase is not defined` mid-flight — after `setSaving(true)`/`setLanguageSaving(true)`, before any toast or network call — and with no try/finally the spinner state stranded forever. Fix: both handlers now call `POST /api/profile-update` inside try/catch/**finally** (finally clears the spinner on every path, including a failed `refreshUserContext()`).

**Decisions / notes:**
- **`platform-settings` read preserves Supabase RLS parity:** the old policy was admin-only FOR ALL, so non-admins always read zero rows and the UI fell back to client defaults (i.e. custom branding/features never applied to non-admins pre-migration). The endpoint returns `{settings: []}` for non-admins — same behavior, and it keeps the SMTP credentials in the `email` key from leaking. Revisit as a product question if branding should apply platform-wide.
- `asset-signed-url` closes the `storage.ts:16` generic-signer gap: authorizes lesson video/document paths OR course thumbnails (`courses.thumbnail_url`) for org-accessible published courses; platform admins bypass. All blobs live in the single configured container — `file-upload.tsx` ignores its legacy `bucket` prop, so thumbnails sit next to videos.
- `usePlatformSettings` provider is now unauthenticated-safe (it mounts on /login; with no MSAL user it skips the network and uses defaults — `callApi` would otherwise throw 'Not authenticated' and strand `isLoading`).
- `msal-config.ts` dropped `storeAuthStateInCookie` (removed in msal-browser v5; was a TS2353). `npx tsc --noEmit -p tsconfig.app.json` now exits 0 (the other two errors were the Settings.tsx `supabase` TS2304s).
- PlatformSettings/OrgSettings pages can't be manually exercised until a profile is elevated — expected; this slice is code-cutover only, authed e2e on the PR-6 preview is the user's gate.

---

## Known Issues & Open Items (as of 2026-06-04)

### Broken — expected, slice-scoped

Shared root cause for all of these: the page/API layer still uses the Supabase client, which has NO auth session under MSAL — `supabase.auth.getUser()` returns null and RLS rejects/strands writes. Fixed per-slice as each area is cut over to `callApi`.

- KNOWN BUG (confirmed manually 2026-06-04): **creating ANY post fails as "Not authenticated" — community and org posts alike.** Every write in `src/lib/community-api.ts` (`createPost`, `createComment`, `createReport`, …) gates on `supabase.auth.getUser()`, which is always null under MSAL, so it throws before reaching the network. Fix = **Slice 5**.
- KNOWN BUG (confirmed manually 2026-06-04): **submitting an idea or saving an idea draft fails** the same way — `src/lib/ideas-api.ts` (`createIdea` incl. drafts, `voteForIdea`, `removeVoteFromIdea`, `createIdeaComment`) has the identical `supabase.auth.getUser()` gate. Fix = **Slice 6**.
- KNOWN BUG: the remaining still-Supabase areas (admin pages, resources — 23 files in total across Slices 2–8) fail or hang writes for the same root cause; not yet individually confirmed by manual testing.
- KNOWN BUG: `send-invitation-email` 500s when invoked — `RESEND_API_KEY` + `STATIC_ASSETS_BASE_URL` app settings unset.

### Broken — small, unscoped
- KNOWN BUG: Dashboard shows an infinite spinner for users with NO org membership (fetch never fires) — needs a frontend empty state.
- KNOWN BUG: `grade-quiz` silently records no `quiz_attempts` row for platform admins without a membership (pre-existing quirk, kept as-is).
- KNOWN BUG: `course-player-data` has no per-course access gate — any authenticated user with a profile can pull any published course's player payload. Inconsistent with `quiz-by-lesson`, which gates on org access. Align in a future slice.

### Accepted trade-offs (reviewed, deliberately kept)
- `enroll` check-then-insert TOCTOU on course availability — harmless; the `UNIQUE(org_id,user_id,course_id)` constraint backstops it.
- Platform admins can write `course_reviews` in orgs they're not members of — consequence of the suite-wide admin-bypass convention.

### Operational quirks (not bugs, recurring)
- Post-deploy the function host can park in `Error` (worker-restart exhaustion during zipdeploy file churn) — run `az functionapp restart` after the ~3 min file sync settles.

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

---

## Current State (post-e2e checkpoint — 2026-06-04)

**Branch:** `feature/lovable-migration` (PR #6 open; preview env is the live test surface)

**Done:** Slice 0 (backend stand-up), Slice 0b (schema + seed), Slice 0.5 (shared reads), Slice 1 (learner flow) — proven by a full authenticated e2e run. Slice 4 (settings & profile — code cutover + deploy + unauth smoke done; fixed the two live Settings.tsx bugs; authed e2e on the PR-6 preview is the user's gate).

**Remaining slices:** 2 (course authoring), 3a/3b/3c (org & user admin), 5/6/7 (community / ideas / resources), 8 (decommission Supabase).

---

## Picking Up From Here

1. Read this file's Known Issues + Current State sections — they supersede the 2026-05-19 checkpoint
2. Read `docs/superpowers/specs/2026-06-03-supabase-azure-cutover-design.md` (untracked, disk-only) — slice definitions, conventions (§7), Definition of Done gates
3. Read `migration/azure/README.md` — seeded UUIDs and how to elevate a profile
4. Read `docs/adr/` — 12 ADRs define what is and isn't allowed
5. Check `CLAUDE.md` for agent constraints before taking any action
