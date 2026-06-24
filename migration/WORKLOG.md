# Migration Worklog — Lovable/Supabase → Azure

Chronological log of all planning and decision work. Picks up where git log leaves off.

**This file is append-only history** — dated entries recording what happened and why. The LIVE state (known-issues ledger, current checkpoint, pickup pointers) lives in **`migration/STATUS.html`** — load that at session start, not this; where a dated entry here and STATUS.html disagree, STATUS.html wins. The May-era 25-task plan (`docs/superpowers/plans/2026-05-17-lovable-supabase-migration.md`) was superseded on 2026-06-03 by the vertical-slice spec (`docs/superpowers/specs/2026-06-03-supabase-azure-cutover-design.md` — disk-only until 2026-06-06, tracked since).

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

**✅ Gate 4 PASSED 2026-06-05:** user-verified on the PR-6 preview — profile name save persists and the language change applies with the spinner resolving cleanly. PlatformSettings/OrgSettings manual testing stays deferred until admin elevation (tracked test debt).

---

## 2026-06-05 — Slice 5: Community (commits dbf1c71 → 595e49f)

**Who:** emil & martin (subagent-driven session)

**16 new endpoints (55 functions total once deployed):** `community-categories`, `community-posts` (list — server-side joins + per-post comment counts, replacing the old client N+1), `community-post`, `community-post-create`, `community-post-update`, `community-post-delete`, `community-comments`, `community-comment-create`, `community-comment-update`, `community-comment-delete`, `community-report-create`, `community-reports`, `community-report-update`, `community-post-moderate`, `community-comment-moderate`, `ai-champions` (read-only — champion writes stay in Slice 3c). Each with mock contract tests (functions suite 284 → 538 passing; tests mock `shared/auth`, `shared/db`, `shared/profile`; never touch a real DB).

**Authorization parity** was derived per-endpoint from the original RLS policies in `supabase/migrations/` (the slice's plan carried a per-endpoint authz table with policy provenance). Highlights:
- Restricted categories: create gated (global → platform admin only; org → org/platform admin); authors cannot edit posts in — or move posts into — restricted categories; author edits blocked on hidden posts (RLS `USING`-as-`WITH CHECK` parity).
- Comments preserve the RLS UPDATE/DELETE asymmetry: an author can DELETE but not EDIT their own hidden comment.
- Org-admin overrides never apply to global-scope content (`is_org_admin(get_post_org_id(...))` is false for NULL org) — global moderation is platform-admin-only.
- Reports: per-reporter+target dedupe → 409 "You have already reported this content." (check-then-insert with the unique-index backstop — same accepted TOCTOU pattern as `enroll`); `reviewed_by`/`reviewed_at` now server-set (was client-supplied).

**4 frontend files cut over (zero `supabase.*`):** `lib/community-api.ts` (full rewrite over `callApi`; exported signatures preserved — `fetchReports` gained an optional `opts` param, `updateReport.admin_notes` widened to nullable), `AIChampionsList.tsx`, `org-admin/OrgCommunityModeration.tsx`, `platform-admin/PlatformCommunityModeration.tsx`. `CommunityFeed`/`PostDetail`/`PostEdit` untouched (lib-only consumers; compile unchanged). Frontend typecheck/build/tests green.

**FIXED (moved from Known Issues, was confirmed manually 2026-06-04):**
- **Creating ANY post failed "Not authenticated" — community and org posts alike.** Root cause: every write in `community-api.ts` gated on `supabase.auth.getUser()`, always null under MSAL. Fixed by the `callApi` rewrite; the server now derives identity from the token (`getProfile`).
- **Dashboard infinite spinner for users with NO org membership.** The data effect early-returned without resolving `loading` when `user` existed but `currentOrg` never arrived, so the existing `!currentOrg` empty state was unreachable. Fixed: profile-gated three-way loading guard (`profile` = user-context-resolved marker) + `EmptyState` fork on `memberships.length === 0` (new `dashboard.noMembership*` i18n keys, en+da) + a 3-case component test proving loading resolves (root suite 10 → 13).

**Deploy status (2026-06-05):** the GitHub Actions deploy was blocked by GitHub's ToS block on `Azure/functions-action` (run 27031634593: build job green, deploy job dead at action download — see Operational quirks). **Deployed manually instead** (emil): `func azure functionapp publish func-ai-education-migration` from `functions/` (after `npm install`/`build`/`test` — 538 passing locally). **Smoke: all 16 new endpoints return 401 unauthenticated (0/16 failures)** against the regionalized hostname. 55 functions live. This also closed the transient "community categories are gone" preview observation from earlier today (the preview frontend was calling endpoints that weren't deployed yet).

**Decisions / notes:**
- `comment_count` counts only comments the caller could see (hidden excluded for non-admins) — deliberate improvement over the old client, which counted hidden comments for everyone. The single-post endpoint returns no `comment_count` (parity — only the feed renders it; PostDetail renders the live thread).
- `community-reports` with neither `orgId` nor `scope:'global'` is platform-admin-only — deliberate tightening vs RLS (which would have let org admins see their orgs' reports); no frontend caller uses that mode.
- Embedded `profile`/`organization` JSON is narrower (`id`+`full_name` / `id`+`name`) than the full TS `Profile`/`Organization` interfaces — matches the old Supabase embedded selects; consumers only read those fields.
- Review nits (explicitly non-blocking): report-update tests assert param membership not index order; Dashboard test name implies an admin-flag coupling that doesn't exist; vi.hoisted factories return superset mock objects in the comment suites.

---

## 2026-06-05 — Worklog Split: STATUS.md Created

**Who:** emil & martin

This file had fused two documents with opposite lifecycles: an append-only history and a high-churn live ledger. Split by lifecycle:
- **`migration/STATUS.md`** (new, ~70 lines) — Known Issues & Open Items, Current State, Picking Up From Here. The file sessions load and edit in place.
- **`migration/WORKLOG.md`** (this file) — dated entries only, append-only. Slice sessions append their entry here AND move fixed ledger items out of STATUS.md.

Also reviewed `.githooks/pre-push` while at it: found it has **never been active on this machine** (`core.hooksPath` unset; CLAUDE.md's first-time setup step was never run here), its memory-freshness check targets a file/path from the original macOS setup that doesn't exist here, and its bug-backlog grep doesn't scan `migration/`. **Decision: deliberately left dormant** — the ledger is maintained by process (overseer cross-checks each slice report), not enforcement. Don't re-suggest activating it.

---

## 2026-06-06 — Slice 6: Ideas (commits 33ca16e → ebed793)

**Who:** emil & martin (subagent-driven session)

**12 new endpoints (67 functions total deployed):** `ideas` (list — server-side comment AND vote counts + profile embed, replacing the old client N+1), `idea` (single — counts, `user_has_voted`, organization embed; `{idea:null}` maybeSingle parity), `idea-create` (forced `status='draft'`, server-set `user_id`), `idea-update` (author+draft-only, field whitelist), `idea-submit` (draft→submitted + `submitted_at`), `idea-status-update` (org/platform admin; supabase-js parity: `admin_notes` only-when-provided, `rejection_reason` forced null unless rejected), `idea-delete` (author ANY status OR org admin OR platform admin — per in-repo RLS), `idea-vote` (org derived from the idea row; `UNIQUE(idea_id,user_id)` → 23505 → 409), `idea-vote-remove` (idempotent own-vote delete), `idea-comments` (profile embed, ASC; zero-rows parity), `idea-comment-create` (CTE insert + profile join; same-idea parent check), `idea-tags` (distinct caller-visible tags). Each with mock contract tests (functions suite 538 → 720 passing; tests mock `shared/auth`, `shared/db`, `shared/profile`; never touch a real DB).

**Authorization parity** derived per-endpoint with policy provenance in the slice plan (`docs/superpowers/plans/2026-06-06-slice-6-ideas.md`, disk-only). **Key finding:** the `ideas`/`idea_votes`/`idea_comments` CREATE TABLE + base RLS never landed in `supabase/migrations/` (Lovable-managed migration gap; the Azure schema was reconstructed from generated types.ts — see `01-schema.sql:391`). Only the DELETE policies (20260202140817) and the org-admin UPDATE (20260401095857) are in-repo; base policies were reconstructed from UI behavior and marked `[R]` in the plan. Highlights:
- **Drafts are author-private for every role** — no org/platform-admin visibility bypass (list/tags filter them, single returns `{idea:null}`, comments return `[]`, writes 404). Rationale: the admin-bypass convention covers org-membership checks, not author privacy of unpublished content; no UI path views another's draft.
- `idea-update` is author+draft-only with NO admin path — org-admin writes go through `idea-status-update` (RLS 20260401095857 had no column/status restriction, so admins may set any status incl. back to draft).
- `idea-delete` mirrors the in-repo RLS exactly: authors delete ANY status (the draft-only policy was explicitly replaced in 20260202140817).
- Deliberate tightenings (documented in plan): updates cannot move ideas between orgs; parent comments must belong to the same idea; vote/comment writes 404 other-author drafts (old RLS likely allowed blind inserts).
- `ideas.org_id` is NOT NULL — no global-scope ideas, so Slice 5's NULL-org admin-leak lesson doesn't apply here.

**Frontend:** `src/lib/ideas-api.ts` fully rewritten over `callApi` — zero `supabase` references; all 12 exported signatures byte-compatible (`voteForIdea`/`createIdeaComment` keep their now-server-ignored `orgId` params; list functions keep the old `|| []` fallbacks). All four ideas pages (IdeaLibrary, IdeaSubmit, IdeaDetail, OrgIdeasManagement) are lib-only consumers — compile unchanged. Typecheck/build green; root suite 13 → 16.

**FIXED (moved from STATUS.md Known Issues):**
- **Submitting an idea / saving a draft / voting / commenting failed under MSAL** (confirmed 2026-06-04, re-confirmed 2026-06-05) — the `supabase.auth.getUser()` gate in ideas-api always returned null. The server now derives identity from the bearer token (`getProfile`).
- **Unenroll dialog rendered literal `<strong>` markup AND claimed "This will remove all your progress"** — false: `unenroll` deletes only the `enrollments` row; per-lesson progress persists. Dialog now renders via react-i18next `<Trans>` (first use in the codebase; `strong` is in the default `transKeepBasicHtmlNodesFor`) with honest "progress will be kept" copy in en+da; the success toast's identical lie fixed too. Unenroll NOT made destructive.
- **Courses.tsx no-org flash** — adopted Dashboard's profile-gated three-way loading guard (Slice 5 pattern) + new 3-case `Courses.test.tsx` (incl. the keep-spinner case Dashboard's tests don't pin).

**Deploy status (2026-06-06):** the GitHub ToS block on `Azure/functions-action` is STILL active (`gh api` → 403 reason "tos") — CI deploys remain broken. Deployed manually (emil): `func azure functionapp publish func-ai-education-migration`. **Smoke: all 12 new endpoints return 401 unauthenticated (12/12)** against the regionalized hostname. 67 functions live. Separately, workflow action versions were bumped to Node 24-compatible majors mid-session (user commit 7545cb2) ahead of GitHub's 2026-06-16 cutoff.

**Decisions / notes:**
- `idea-comments` returns `{comments: []}` (not 404) for missing/invisible ideas — zero-rows RLS parity, mirrors `community-comments`; the slice plan's original 404 wording was corrected after the final integration review.
- Write paths distinguish 404 (missing) from 403 (not author) for non-draft ideas — matches the community template; the existence-probe nuance was reviewed and accepted as suite convention.
- `<Trans>` precedent established as the canonical mechanism for emphasis inside translated strings (the codebase previously had none; other dialogs hardcode untranslated JSX emphasis).
- Mid-session the Anthropic API had a sustained overload (529s); Task 3's reviews were retried and all per-task review gates completed (several on Sonnet).
- Review nits (explicitly non-blocking, filed in STATUS.md): order-insensitive param assertions in idea-update's happy-path test; idea-comments' own-draft-but-non-member case unpinned; `fetchIdeaComments` keeps the legacy loose `any[]` type.

---

## 2026-06-06 — Slice 6 addendum: draft-save 400 hotfix (commit 97dfaab)

**Who:** emil & martin

User preview-testing immediately caught a Slice 6 regression: **saving an idea draft failed** ("Failed to save draft"; console showed `idea-create` → 400) while fully submitting worked. Root cause (systematic-debugging session): `IdeaSubmit`'s form defaults every field to `''` — including `business_area`, a PG **enum** server-side. The old Supabase lib coerced with `|| null` in `createIdea`; the Slice 6 rewrite sent fields verbatim, so an unselected business area sent `business_area: ""` and the endpoint's enum validation 400'd. A completed form carries a real enum value — hence submit worked.

Fix (lib layer, where the old architecture also did it; server stays strict): restored `createIdea`'s `|| null` coercions verbatim and added `''→null` for `business_area` in `updateIdea` (the second save of an existing draft hits the same validation; the OLD update path would actually have thrown a PG enum-cast error on this too — latent pre-migration bug, now fixed). New `src/lib/ideas-api.test.ts` pins the payload coercions (root suite 16 → 20). Frontend-only — no function redeploy needed.

**Lesson for remaining slices (2, 3a–3c, 7):** when cutting a lib over to `callApi`, preserve the old lib's value coercions (`|| null`, `|| []`), not just its call shapes — forms in this codebase initialize selects/text fields as `''`, and the new endpoints validate enums strictly.

---

## 2026-06-06 — Slice 6 addendum 2: drafts invisible to their author (commit b5db7bb)

**Who:** emil & martin

Second preview-testing catch: draft save now succeeded (`idea-create` 200) but the draft never appeared in the Drafts tab (`ideas` 200 with an empty array). Root cause: **identity-domain mismatch** — `useAuth().user.id` is the Entra `oid` claim, while `ideas.user_id` is the profiles-row UUID. Pre-migration, Supabase's auth uid WAS profiles.id, so `idea.user_id === user?.id` comparisons worked; post-migration they never match. Four sites had it: IdeaLibrary's drafts-tab server filter (sent the OID as `user_id` → endpoint matched nothing), its client-side safety filter, IdeaSubmit's draft-load guard (editing an own draft refused to populate), and IdeaCard's `canDelete`. Sibling pages (PostDetail, PostEdit, IdeaDetail) already compare `profile?.id` — the stragglers are now aligned, with an IdeaLibrary component test pinning the wire-level filter (root suite 20 → 22). No data repair needed: the server always derives `user_id` from the token, so pre-fix drafts were stored correctly.

**Lesson for remaining slices (recorded in STATUS):** after cutover, audit pages for `=== user?.id` / `user.id` ownership comparisons — the identity for DB-row ownership is `profile.id`. `ResourceLibrary.tsx:255` has the same bug class (Slice 7 scope).

---

## 2026-06-06 — STATUS Ledger Converted to HTML

**Who:** emil

Per a new global preference (human-facing documents as styled HTML instead of markdown), `migration/STATUS.md` became `migration/STATUS.html` — same content, same in-place maintenance convention, now a self-contained styled page (severity-coded badges, no external dependencies). Forward-looking references in this file's preamble, the collab design spec, and the collab-setup/Slice-6 plans were updated to the `.html` path; dated history entries were left as written.

---

## 2026-06-06 — Pre-Elevation Playwright Regression Sweep (verdict: GO)

**Who:** emil & martin (Playwright MCP session driving the PR-6 preview as learner Martinh)

Full learner-surface regression sweep (Suites A–F: shell/auth, course flow, settings, community, ideas, expected-degradation spot checks) run via browser automation as the **final learner-state snapshot before platform-admin elevation**. **Every learner-flow step PASSED** — including all historic regressions re-verified: language-save spinner resolves, empty-select idea drafts save (no 400), drafts visible to their author, unenroll dialog renders real bold with honest progress-kept copy, duplicate-report 409 correct server-side.

**Key outputs (all filed in STATUS.html):**
- 🎯 `azure-view-url` 403 repro captured (was "needs repro"): video blob 403 vs PDF blob 200 for the same lesson/caller → per-path authz in the function. Candidate Slice 2 rider.
- NEW (medium): storage-account CORS blocks SAS'd PDF fetch from the app origin — Phase-1 Q5's "SAS pattern doesn't need CORS" was wrong for fetch()-based viewers.
- NEW (low): profile-save toast never appears; duplicate-report 409 swallowed by the UI.
- Observations: completion semantics unclear ("Completed 0" despite passed quiz); no course-review entry point despite CourseReviewDialog's Slice 1 cutover; idea authors CAN delete own submitted ideas (contradicts Slice 6's "deletes are admin-owned" doc — reconcile).
- Deep-links also redirect to dashboard — extends the human-logged refresh bug; "Copy link" unusable until fixed.
- Resources (Slice 7 pending): reads serve STALE Lovable-Supabase data on the anon key; writes fail 401 silently.
- Left behind: one PW-SWEEP report record on a seeded post (learners can't retract reports) — in the post-elevation queue to dismiss.

---

## Live sections moved (2026-06-05)

"Known Issues & Open Items", "Current State", and "Picking Up From Here" now live in `migration/STATUS.html` (originally created as `STATUS.md`, converted 2026-06-06).
Update the live ledger THERE; append dated history entries HERE.

## 2026-06-06 — Two-Person Collaboration System (issue #7, PR #34)

**Who:** emil & Claude ("cowork brainstorm" session)

Researched (4 parallel web agents over Anthropic docs + practitioner accounts) and designed a two-developer Claude Code collaboration system — spec at `docs/superpowers/specs/2026-06-06-two-person-claude-code-collaboration-design.md` — then implemented it on `emil/7-collab-setup`:

- **Trunk goes PR-only:** local Node PreToolUse guard hook (`.claude/hooks/guard-trunk.mjs`, verified exit-2 on a trunk checkout, exit-0 elsewhere) + a `trunk-pr-only` GitHub ruleset (Martin creates — admin-only; verbatim command in the plan, Task 11).
- **Ledger moved to GitHub Issues** (#8–#33: 6 slices, 11 bugs incl. every Playwright-sweep finding, 4 hardening, 2 CI, 2 polish, 1 post-cutover transition). Claims = assignee (soft) + draft PR (hard); the issue template carries a "Files touched" field for the parallel-safety overlap check.
- **Committed shared config:** CLAUDE.md/AGENTS.md rewritten (collab rules; stale macOS adr-kit memory pointer replaced by `docs/tooling/adr-kit.md`); `.claude/rules/{functions,frontend}.md` path-scoped conventions; `pickup`/`handoff`/`slice-workflow` skills; `settings.json` hooks-only (stale jq/`cavemem` hooks dropped; a shared permission allowlist was proposed and REJECTED by user decision — permissions stay in each developer's `settings.local.json`).
- **Specs now tracked** (the cutover spec was disk-only — owner-approved reversal). STATUS.html slimmed to non-issue-shaped content only.
- **Review gate:** cross-review by convention; the server enforces PR-only with 0 required approvals, so solo stretches self-merge after a clean `/code-review`. **Deploys:** trunk-only, post-merge, announced on the merged PR.

Pending: Martin's onboarding (ruleset creation, trust prompts, .env handoff, adr-kit doc enrichment) + his cross-review of PR #34 — the system's first end-to-end exercise.

---

## 2026-06-06 — Slice 7: Resources Cutover (issue #12, PR #36)

**Who:** martin & Claude (solo, post-PR-34 collaboration system live)

First slice executed entirely on the new two-developer workflow: claim PR (#36) on `martin/12-resources-cutover` off fresh trunk, cutover work, `/code-review`-driven hardening, self-merge after a clean review (Emil's PR #35 carried no overlapping file scope), CI deploy from fresh trunk.

**Endpoints (4 live; pin folded into update):**
- `/api/resources` (POST) — list + filter (search/type/tags) + the org's distinct tag list in one round trip. Authz: platform admin OR active org member.
- `/api/resource-create` (POST) — `user_id` server-derived from the bearer token (never client-supplied); RESOURCE_TYPES validated against the form's `<Select>` options since the column has no DB CHECK constraint.
- `/api/resource-update` (POST) — whitelist update (`title`, `description`, `resource_type`, `url`, `tags`, `is_pinned`); platform admin OR author OR org admin.
- `/api/resource-delete` (POST) — same authz; hard delete (cascade kills no children — community_resources is a leaf).

`/api/resource-pin` was deployed in the initial cutover commit (`286fd5a`) and **deleted during code-review hardening** — same authz as `/api/resource-update`, `is_pinned` already in its whitelist, and the client's `toggleResourcePinned` was discarding the embedded-profile payload the pin endpoint computed. Frontend now routes pin/unpin through `/api/resource-update` (signature unchanged).

**Frontend cutover (zero `supabase.*` on the four touched files):**
- `src/lib/resources-api.ts` rewritten over `callApi`. `user_id` dropped from `CreateResourceInput`. `fetchResources` returns `{ resources, allTags }`.
- `src/pages/community/ResourceLibrary.tsx` — ownership compare moved from `user?.id` (Entra OID) to `profile?.id` (the Slice 6 bug class, hit at the predicted spot); two `useQuery`s collapsed into one.
- `src/components/community/{ResourceCard,ResourceForm}.tsx` — already on the post-cutover surface; no changes needed.

**Code-review hardening (9 findings → 7 commits stacked on `286fd5a`, net −100 LOC):**

Post-cutover `/code-review` (extra-high effort, 9 finder angles + verify + sweep) surfaced 9 findings; all addressed in-PR before merge via subagent-driven development (implementer + spec-compliance review + code-quality review per task, sequentially). Commits in order:
- `97f6ed7` — **delete `/api/resource-pin`** (71 LOC handler + 109 LOC tests).
- `8787c0d` — **`resource-update` validation tightening**: reject `title: null` (was leaking PG NOT NULL error as 500), explicitly reject unknown update keys (parity with `community-post-update`), return **404 instead of 403** for the unauthorized branch so cross-org resource IDs can't be enumerated. +7 tests. `35cd1e1` follows up with two narrative-scar nits from the reviewer.
- `214fc03` — same 403→404 swap in `/api/resource-delete`.
- `12d4433` — **escape LIKE metacharacters** (`%`, `_`, `\`) in `/api/resources` search input — a search of `snake_case` previously matched every non-empty row. +1 test.
- `c253543` — single-fetch `ResourceLibrary` + server returns `allTags` via `array_agg(DISTINCT unnest(tags))` regardless of filters (preserves the UX: tag dropdown stays unfiltered).
- `1810324` — extracted `RESOURCE_PROFILE_PROJECTION` to `functions/shared/resources.ts` — the embedded-profile JSON shape lived in three call sites and tests only asserted `LEFT JOIN profiles` as a substring, so drift would have silently changed the API contract.

**Deploy + smoke (CI restored — ToS block lifted!):**

The GitHub ToS block on `Azure/functions-action` listed as a current quirk in STATUS.html has **lifted since the 2026-06-05 outage** (verified mid-session via `gh api repos/Azure/functions-action` returning the repo data, not a 403). CI deploy works again — used `gh workflow run main_func-ai-education-migration.yml --ref feature/lovable-migration` (run 27073659044, build 32s + deploy 40s) instead of the manual `func publish` workaround. The related `Azure/azure-functions-core-tools` and `Azure/homebrew-functions` repos remain blocked; the lift is partial.

Smoke against `func-ai-education-migration-c0fgeqdnfvd6h0cf.swedencentral-01.azurewebsites.net`: all 4 endpoints return 401 + `Missing Bearer token` unauthenticated; `/api/resource-pin` correctly returns 404 (endpoint absent post-deletion). Authed 200 deferred to Gate 4 (user-verified e2e against the PR-6 preview).

**Counts:** functions 67 → **71** (added 5, deleted 1); test suite 720 → **788** (+73 new, then −11 pin tests, +6 hardening tests, net **+68**). PR #36 final diff: 12 files, +1,078 / −85.

**Decisions / notes:**
- The 403→404 swap on update/delete is deliberate info-disclosure mitigation — it costs admins the ability to distinguish "doesn't exist" from "exists but you can't touch it" when debugging. Accepted; UUIDs are unguessable so the trade-off cost is theoretical, the leak was concrete.
- Silent-drop of unknown update keys was changed to explicit 400 rejection (parity with `community-post-update` which surfaces typos rather than letting them no-op). The original silent-drop was an artifact of mirroring Supabase's permissive upsert; the explicit version is the suite's preferred shape.
- `RESOURCE_PROFILE_PROJECTION` is the first shared SQL fragment in `functions/shared/`. Future endpoints returning embedded profiles should use it.

**Follow-up filed (#41, label `polish`, non-blocking):** the single-fetch refactor in `c253543` made `/api/resources` part of the per-keystroke search query, so the tags query refetches per character (was per-org cached before). Two fix options laid out — debounce `searchQuery` (a new `useDebouncedValue` hook) or split tags into its own endpoint — plus a companion GIN-index migration matching the pattern `community_posts` and `ideas` already have. Migration-era data volumes make this invisible in practice.

**Lesson for remaining slices (2, 3a–3c, 8):**
- Run `/code-review` BEFORE marking the cutover PR ready — the 9-finding sweep here would have grown the diff if caught post-merge. Subagent-driven development handled the fix sweep cleanly (extract task list, one implementer per task with spec + quality review, controller preserves context).
- The Slice 6 lesson (audit `=== user?.id` → `profile?.id`) hit exactly where predicted (`ResourceLibrary.tsx:255`). Keep the audit-for-OID-vs-UUID step in every cutover.

---

## 2026-06-06 — OrgSelector → /api/organizations (issue #37, PR #44)

Single-component frontend cutover: `src/components/OrgSelector.tsx` swapped from `supabase.from('organizations').select('*').order('name')` to `callApi('/api/organizations', {})` (the endpoint already shipped with Slice 0.5). Out of scope per #37: the four other `from('organizations')` call sites (`CoursesManager` #8, `OrgAnalytics`/`OrganizationsManager`/`OrganizationDetail` #9) — they'll cut over with their owning slices.

**Diff:** `OrgSelector.tsx` (+18 / −12) and new `OrgSelector.test.tsx` (+109; 5 tests — endpoint path, auto-select on empty, no-auto-select-when-set, non-admin skips fetch, spinner lifecycle).

**Code-review fixes (3 findings, all in-PR):**
- `catch` added so callApi rejections (network / 401 / 403 / 500 / MSAL `acquireTokenSilent` interaction-required) log via `console.error` instead of becoming unhandled rejections — frontend.md's "silent failures were a recurring migration bug class" rule.
- `if (organizations)` upgraded to `if (Array.isArray(organizations))` plus a `console.warn` on the else branch, so a backend shape regression is observable rather than silent (the typed generic doesn't validate at runtime).
- Dropped the unused `React` import in the new test file (Vite's automatic JSX runtime).

**Verify:** `npx tsc --noEmit -p tsconfig.app.json` exit 0; `npm run build` ok; `npm test` 27/27 (8 files); zero `supabase.*` on the two touched files. No backend / functions changes → no deploy.

---

## 2026-06-06 — Slice 2: Course Authoring (issue #8, PR #35, branch emil/8-course-authoring)

**Who:** emil & Claude (subagent-driven session; ran CONCURRENTLY with Slice 7/PR #36 — the collab system's first parallel exercise; claim via draft PR #35 off fresh trunk, rebased over the moved trunk after #36 landed: hub-file appends only — barrel, WORKLOG, STATUS)

**15 new endpoints (barrel at 86 post-rebase over Slice 7):** `courses-admin` (manager list — all courses + full org_course_access matrix in one call), `course-create` (server-set `created_by_user_id = profile.id`, `is_published=false`), `course-update` (whitelisted dynamic SET: title/description/level/thumbnailUrl/isPublished), `course-delete` (FK cascade — modules→lessons→quizzes→questions→options + enrollments/access/progress/attempts/reviews, matching old behavior), `course-access-set` (single `ON CONFLICT (org_id, course_id)` upsert replacing the client find-then-update-or-insert), `course-access-bulk` (ONE atomic INSERT…SELECT over published courses replacing the silent client loop), `course-structure-admin` (course + modules + nested lessons; one JOIN query for all lessons — no N+1; `{course:null}` maybeSingle parity), `module-create/update/delete`, `lesson-create/update` (full-row update, server nulls deprecated `video_url` — old payload parity), `lesson-delete` (**absorbs the old 3-step client sequence**: reads `azure_blob_path`, SAS-deletes the blob with swallow-and-continue parity via `shared/sas.ts`, then deletes the row; returns `blobDeleted`), `quiz-admin` (full editor read WITH `is_correct`, killing the per-question `quiz-options-admin` N+1), `quiz-admin-save` (**the suite's first transactional endpoint** — new `withTransaction` helper in `shared/db.ts`; atomic upsert-quiz → delete-questions(cascade) → reinsert questions+options, replacing the old 7-statement client sequence that could strand a half-built quiz). Functions suite: +236 tests on this branch (723 → 959 pre-rebase); combined with Slice 7 the post-rebase suite is 1027 passing (+3 DB-integration tests that skip without DATABASE_URL).

**Authorization parity — fully in-repo provenance this time** (no Slice-6-style `[R]` reconstruction): migration 20260127153401 grants "Platform admins can do everything with <courses|modules|lessons|quizzes|questions|course access>" and NOTHING else writes; 20260127174142 hardened `quiz_options` SELECT to platform-admin-only (`is_correct` secrecy). All 15 endpoints are platform-admin-only with zero org logic; `courses` has no `org_id` (global-scope content — org admins have no authoring path at all, per the spec rule "org-admin overrides never apply to global-scope content").

**3 frontend files cut over (zero `supabase.*`):** `platform-admin/CoursesManager.tsx` (fetchData 3 queries → `courses-admin` + existing `organizations`), `platform-admin/CourseEditor.tsx` (fetchCourse+fetchModules+N+1 → one `fetchStructure()`; lesson delete collapses to ONE call — the client-side azure-delete-blob invocation is gone), `components/platform-admin/QuizEditorDialog.tsx` (fetch + save each become a single call). Frontend build/tests/tsc green (root suite 27 post-rebase, incl. #44's OrgSelector tests).

**FIXED:**
- **Course authoring entirely broken under MSAL** (all writes failed — no Supabase auth session). The slice headline.
- **Issue #8 audit item:** `created_by_user_id: user?.id` (CoursesManager:116) sent the Entra OID where a profiles UUID belongs — resolved server-side; the client no longer sends any user id.
- **Latent pre-migration bug mooted:** the old editor's options fetch passed `{questionId}` to `quiz-options-admin`, which destructures `{quizId}` — editing an existing quiz silently loaded zero options. The new `quiz-admin` batched read replaces it; `quiz-options-admin` is now orphaned (left registered; Slice 8 decommission sweep).
- **togglePublish swallowed errors silently** — now surfaces a destructive toast (callApi throws; sanctioned micro-improvement).

**Deliberate tightenings (documented in the disk-only slice plan):** atomic quiz save; `quiz_options.sort_order = array index` (old client inserted none → all 0, nondeterministic learner-side option order); atomic access bulk; 404 on missing rows for update/delete (suite convention; old Supabase deletes were silently idempotent).

**Deploy status (2026-06-06):** the `Azure/functions-action` ToS block lift was independently verified in this session too (`gh api` → 200; Slice 7's entry above documents the lift and the first CI deploy — issue #30 closable). Per collab rules, deploy runs from fresh trunk after this PR merges, via `gh workflow run main_func-ai-education-migration.yml --ref feature/lovable-migration`; smoke results announced on PR #35. Gate 4 (user e2e on the PR-6 preview, needs an elevated profile for the admin pages) pending post-deploy.

**Review nits (explicitly non-blocking):** course-update single-field test asserts param position via COLUMN_MAP order; `CardTitle`/`CheckCircle2` imports in QuizEditorDialog were already unused pre-cutover (left as-is); failed module/lesson saves now keep the dialog open (old code closed it even on error — improvement, noted as drift).

---

## 2026-06-07 — PR #35 pre-merge review-fix sweep (commits 1e46f4f → c154172)

**Who:** emil & Claude (xhigh multi-agent review of PR #35 — 9 finder angles, per-finding adversarial verification, 28 candidates → 15 verified findings — then a subagent-driven fix sweep: 7 tasks, each through implementer → spec review → quality review, plus a final whole-range review).

**Fixed on the branch (14 commits):**
- **Cross-lesson quiz overwrite (severe):** `QuizEditorDialog` kept stale state across lessons (`quizLessonId` never reset, one mounted instance); a failed `quiz-admin` load for lesson B left lesson A's questions save-able into B's quiz via `quiz-admin-save`'s delete-and-replace. Fixed structurally — `key={quizLessonId}` remount + `loadError` guard (error+Retry replaces the form; Save disabled). Also: passingScore reset in the no-quiz branch (leaked across lessons) and clamped [0,100] client-side (>100 previously round-tripped to a server 400).
- **SAS-URL thumbnail persistence (severe, activated by the Azure cutover):** `extractLmsAssetPath` only knew Supabase prefixes, so saving ANY field of an existing course persisted the full expiring signed URL into `thumbnail_url` (`?? editThumbnailUrl` fall-through); after token expiry the thumbnail 403'd unrecoverably. Fixed in `src/lib/storage.ts` — Azure branch (end-anchored host check, lookalike-domain safe, never throws, `''`-proof). Reads now SELF-HEAL corrupted rows (re-extract → re-sign) and the next save normalizes. Data audit of existing rows = issue #49 (post-merge; now mostly verification).
- **Orphaned blobs on cascade delete:** `course-delete`/`module-delete` cascade-deleted lessons without cleaning their blobs (while `lesson-delete` did — intra-PR inconsistency). Both now collect descendant `azure_blob_path`s pre-delete and best-effort sweep post-delete (`{blobsDeleted, blobsFailed}` + client warnings + endpoint-level warn).
- **lesson-delete hardening:** new shared 404-tolerant `deleteBlob()` in `functions/shared/blob.ts` (adopted by `azure-delete-blob` too — kills the duplicated inline copy that had already diverged on 404 handling); row-first ordering (`DELETE…RETURNING` before the irreversible blob delete); `blobDeleted: boolean|null` (null = no blob) and the client now surfaces blob-cleanup failures (the old warning toast had been dropped in the cutover).
- **Admin load paths:** `CoursesManager.fetchData` had no try/catch → infinite spinner on any API failure; `CourseEditor.fetchStructure` had try/finally without catch → unhandled rejection + misleading "Course not found". Both: error block + Retry; the misleading branch is now unreachable on failure.
- **Shared validators:** `functions/shared/validate.ts` (`isStringOrNull`/`isNonEmptyStringOrNull`/`isIntOrNull` + `validateLessonFields`) dedups the character-identical ~24-line blocks in lesson-create/update; storage-path fields tightened to non-empty-or-null (UI verified to never send `''`).
- **Perf minors:** `Promise.all` for the independent query pairs in `courses-admin` / `course-structure-admin` / `quiz-admin` (gating existence checks stayed serial).

**Gates:** functions suite 1027 → **1105 passed / 3 skipped**; root suite 27 → **60** (first component tests for QuizEditorDialog, CoursesManager, CourseEditor + storage.ts unit tests); tsc + build clean both packages. No new endpoints (shared modules don't register — barrel unchanged at 86).

**Deferred to issues (deliberately not blocking #35):** #46 sort_order ownership (pre-existing, touches course-player-data), #47 `requirePlatformAdmin` sweep (24 endpoints; lands as its own PR right after #35 merges — functions/shared contract, serialize), #48 admin mutation architecture (useMutation + cache patching), #49 thumbnail_url SAS data audit (depends on #35).

**Process notes:** the T6 spec reviewer caught a real regression green tests missed (`setLoading(true)` in fetchData blanked the page on every post-mutation refetch — fixed before it landed); the storage.ts task silently dropped out of the initial task extraction and was caught during handoff while writing the PR comment (completed as T7 through the same pipeline — lesson: diff the agreed scope list against the task list before dispatching). Review nits left as-is: two cosmetic casts in validate.ts; `deleteBlob` path-encoding precondition noted as a follow-up candidate; `course-player-data` is now the un-parallelized sibling (natural rider for #46–#48 work).


---

## 2026-06-07 — Slice 3a: Organizations cutover (issue #9, PR #45, branch martin/9-organizations-cutover)

**Who:** martin & Claude (subagent-driven session for the post-review fix-pass; the prior Slice 3a slice work shipped earlier in this branch). PR #45 squash-merged as `a017bff` after a 15-finding `/code-review --max` pass and an 11-commit tactical fix-pass.

**3 new endpoints (barrel at 89 post-merge):** `organization-create` (whitelisted body INSERT; 23505 → 409 on duplicate slug), `organization-update` (dynamic SET over a whitelisted key set name/slug/logo_url/seat_limit; single `UPDATE…RETURNING` after the fix-pass collapsed the prior SELECT+UPDATE round-trip; 404 on no-match, 409 on 23505), `organization-delete` (single `DELETE…RETURNING id` after the fix-pass; cascade FKs handle dependents). **1 existing endpoint modified:** `organizations` LIST branches gained a `member_count` correlated subquery (eliminating the per-org `count('*')` N+1 in `OrganizationsManager`) with a `::int` cast (BIGINT → JS number) and `om2` alias to avoid collision with the outer `JOIN org_memberships om` in the member branch. All 3 new endpoints are platform-admin-only with `getProfile()` + `is_platform_admin` checks; provenance from migration `20260127153401_*.sql:269-276` ("Platform admins can do everything with orgs" — the only DML-granting policy).

**Authorization parity:** validate → authz → DML (no enumeration via 404-vs-403, since non-admins hit 403 before the row probe). After the fix-pass collapsed the SELECT existence checks, the 404 now comes from `RETURNING` returning null, which fires only after authz has passed — the property holds.

**2 frontend files cut over** (org-table calls only; memberships/invitations/profiles remain on supabase pending Slice 3b/3c, tracked in issue #54): `OrganizationsManager.tsx` (list + create + logo-URL builder via `callApi`; snake→camel translation at the fetch boundary; `setCreating` cleared in `finally`), `OrganizationDetail.tsx` (read + update + delete + logo-URL via `callApi`; `setSaving`/`setDeleting` cleared in `finally`). New `src/lib/storage-url.ts` `buildPublicUrl(storagePath)` helper replaces three inline `${VITE_STORAGE_BASE_URL ?? ''}/${path}` compositions (`OrganizationsManager`, `OrganizationDetail`, `OrgAnalytics`); throws on missing env so a misconfigured environment surfaces an upload error rather than silently writing a broken URL.

**FIXED in the original Slice 3a work** (commits `449ced5`, `486d5d0`): the recurring stranded-spinner bug class on the three handlers (now wrapped in `try/finally`); the per-org `count` N+1 in the manager.

---

## 2026-06-07 — PR #45 pre-merge fix-pass (commits 043e507 → 6b5c37f, 11 commits)

**Who:** martin & Claude (subagent-driven; per-task implementer → spec review → code-quality review pipeline, plus a final whole-implementation review). xhigh `/code-review --max` over PR #45 returned 15 findings: 11 fixed in this fix-pass, 4 architectural items + 1 deferred UX filed as follow-up issues #50–#54.

**Fixed on the branch (11 commits, all green-on-CI per the gates):**
- **Sort regression (severe UX):** `ORDER BY o.name` had silently replaced the original `.order('created_at', { ascending: false })`. Restored to `ORDER BY o.created_at DESC` on both LIST branches; test pinned the SQL substring.
- **`editOrgSchema` ↔ backend drift (the canary for #51):** front-end min(1) for name/slug accepted inputs the backend (min 2) rejected with a destructive toast after save. Now min(2) with matching error messages.
- **`UPDATE…RETURNING` and `DELETE…RETURNING` collapses:** `organization-update` and `organization-delete` each dropped the existence-check SELECT, halving the DB round-trips and closing the TOCTOU window where a concurrent delete between SELECT and UPDATE produced `{ organization: null }` in the response. Test mock chains collapsed accordingly; `OrgRow` interface removed from update (only used in delete's RETURNING generic now).
- **`Organization.member_count?: number`** added (snake_case to mirror the API; optional because the single-org branch doesn't return it). Fetch-boundary intersection in `OrganizationsManager` simplified to `Organization[]`; `OrgSelector`'s typing is now accurate without intersection gymnastics.
- **Silent-fail UX × 3:** destructive toasts on `fetchOrgs`, `fetchData` (org), and **partial post-create failures**. The `handleCreate` restructure was the largest single change — `let postCreateError: string | null = null` first-failure-wins chain across the supabase membership/invitation/RPC/email steps; on any failure a "Organization created, but follow-up step failed: <reason>" destructive toast replaces the green one, dialog still closes, list still refreshes (the org exists either way). Each remaining `supabase.*` call carries an inline `TODO(slice-3b):` comment naming the future callApi endpoint.
- **`buildPublicUrl` helper + 3 callsite migrations** (see Slice 3a entry above).
- **Partial index** `org_memberships_org_id_active_idx ON org_memberships (org_id) WHERE status = 'active'` — supports the new `member_count` correlated subquery and the existing `isActiveMember` lookup. `IF NOT EXISTS` keeps re-runs idempotent.

**Deferred to follow-up issues** (each captures a specific finding plus its acceptance criteria):
- **#50** (structured error codes for 4xx + `isUniqueViolation` helper) — replaces the exact-string slug-conflict match in `handleCreate` and dedups the 23505 → 409 mapping that appears in `organization-create` and `organization-update`.
- **#51** (shared org-validation module) — single source of truth for slug regex + name/slug length; the editOrgSchema drift above is exactly the bug class this prevents.
- **#52** (`corsResponse` return type → `HttpResponseInit` + cast cleanup) — ~100 `as HttpResponseInit` casts across the function tree; touches files outside any single slice, lands as its own PR.
- **#53** ('Try again' button on the OrganizationDetail empty state) — with the new toast the failure is no longer silent, but full-page reload is still the only retry; deferred UX polish.
- **#54** (scope clarification for the remaining `supabase.*` in cut-over files) — memberships/invitations/profiles still call Supabase in `OrganizationsManager`/`OrganizationDetail`; explicit slice assignment so the grep gate doesn't trip.

**Gates** (post-merge on fresh trunk): functions suite **1156 passing / 3 skipped** (Slice 3a's +51 endpoint tests + 2 new ORDER BY assertions added inline; test mock-chain collapses in update/delete kept the test count flat); root suite **65 passing** (the 5 new `storage-url.test.ts` cases); `npx tsc --noEmit -p tsconfig.app.json` exit 0; `npm run build` ok. Zero `supabase.from('organizations')` / `org-logos getPublicUrl` matches in the two cut-over files; zero inline `VITE_STORAGE_BASE_URL` compositions in `src/` outside the helper.

**Process notes:** the per-task two-stage review caught one cosmetic finding (unused `existingOrg` constant in `organization-update/index.test.ts` post-collapse) explicitly flagged non-blocking and left as-is; the final whole-implementation review noted one unused `beforeEach` import in `storage-url.test.ts` at sub-threshold confidence (also left). The `gh issue create` heredoc commands hit a backtick-in-heredoc parse conflict on issue #52's body; resolved by switching that issue (and the two after it) to `--body-file` with the body in a temp file. Spec at `docs/superpowers/specs/2026-06-07-pr-45-fix-pass-design.md`; implementation plan at `docs/superpowers/plans/2026-06-07-pr-45-fix-pass.md` (both tracked in the bookkeeping PR alongside this entry).

**Deploy status:** trunk-deploy from `a017bff` pending; the new `org_memberships_org_id_active_idx` migration applies via the deploy workflow's migration step. Gate 4 user-e2e on the PR-6 preview pending post-deploy.

---

## 2026-06-07 — Slice 3a Gate 4 user-verified (PR-6 preview, post-deploy)

**Who:** martin & Claude (Playwright MCP-driven e2e on `black-forest-0d7f96c03-6.westeurope.7.azurestaticapps.net`, platform-admin profile `martin vladinov`).

**Pre-check (proves the deploy was needed):** `/api/organization-{create,update,delete}` all returned `404` against the live function host before the trunk deploy, then `401` (auth required, route now registered) after. Same probe before merge had shown the FE still POSTing to `https://cairuxpyfshugwjrrqha.supabase.co/rest/v1/organizations` (→ 401) — confirming the preview was on pre-cutover code. Per AGENTS.md "deploys only from fresh trunk after a merge", Gate 4 is a post-merge verification.

**Verified on the preview:**

- LIST renders `member_count` (`Test Org` row shows `3 / 50` from the correlated subquery — no N+1 in the network panel).
- CREATE happy path: `POST /api/organization-create → 200`, toast "Organization created!", new row "E2E Test Org · e2e-test-org · 0 / 25" appears (member_count = 0 on a fresh org as expected).
- CREATE duplicate-slug: re-submit with slug `e2e-test-org` → `POST /api/organization-create → 409 Conflict`; inline error "This slug is already taken" appears under the slug field (not toasted); dialog stays open; no stranded spinner (the `setCreating(false)` in `finally` from the original Slice 3a work clears state correctly).
- UPDATE: edit the new org (name → "E2E Test Org (renamed)", slug → "e2e-test-renamed", seat limit 25 → 100); `POST /api/organization-update → 200`; heading, breadcrumb, `/e2e-test-renamed` subtitle, and `0 / 100` seats card all reflect the new values; toast "Organization updated".
- DELETE: confirm in alert dialog; `POST /api/organization-delete → 200`; toast "Organization deleted"; redirected to list; deleted row gone, only the pre-existing `Test Org` remains (cascading FKs handled dependents).

**Negative parity:** no Supabase REST calls in any of the org CRUD paths. The `org_memberships` and `get_platform_invitations_safe` calls observed on the detail page are the explicitly-scoped Slice 3b/3c residue (issue #54) — `TODO(slice-3b)` markers in the source.

**Gate 4 status:** ✅ closed. Slice 3a complete. Slice 2's Gate 4 still pending the next trunk deploy.

---

## 2026-06-07 — Slice 3b: Memberships & invitations cutover (issue #10, PR #58, branch martin/10-slice-3b-memberships-invitations)

**Who:** martin & Claude (subagent-driven per-task implementer pipeline; clean `pr-review-toolkit:code-reviewer` pass — zero must-fix/should-fix findings; squash-merged as `38b29c0`).

**8 new endpoints (barrel at 97 post-merge):**
- `org-membership-create` (POST: orgId, userId, role, status?='active') — lookup-then-authz-then-INSERT; 23505 (UNIQUE org_id,user_id) → 409; 23503 → 404. Platform admin OR `isOrgAdmin`; RLS provenance `supabase/migrations/20260127153401_*.sql:279-285`.
- `org-membership-update` (POST: id, role?, status?) — load membership → 404 if missing → authz → dynamic SET clause over whitelisted keys → `UPDATE…RETURNING`; same authz model.
- `org-membership-delete` (POST: id) — load → 404 → authz → `DELETE…RETURNING id` (TOCTOU still earns 404).
- `invitations` LIST (POST: scope='org'|'platform', orgId?) — raw SQL wrapping the `get_org_invitations_safe` / `get_platform_invitations_safe` RPCs; columns enumerated explicitly, **token/token_hash deliberately omitted** (asserted by test that the SELECT string never matches `\btoken\b`); `WHERE status='pending'` always; `ORDER BY created_at DESC`. Org-admin scope filters to `invited_by_user_id = profile.id` (parity with `supabase/migrations/20260201171353_*.sql`); platform admins see all.
- `invitation-create` (POST: orgId, email, role, firstName?, lastName?, department?) — RETURNS the full row including `link_id`, eliminating the follow-up `get_invitation_link_id` RPC roundtrip. Email lowercased + trimmed; `invited_by_user_id` set from token (clients never supply it).
- `invitation-bulk-create` (POST: orgId, invites[1..500]) — sequential per-row try/catch; one bad row does NOT abort the batch (no wrapping transaction); response shape `{ results: [{ email, success, invitation?, error? }] }` preserves input order. Per-row 23505 → "An invitation for this email is already pending" string.
- `invitation-update` (POST: id, status='expired') — accepts only the cancel transition (other statuses 400). Lookup-then-authz-then-`UPDATE…RETURNING`; same column projection as `invitation-create` (no token/token_hash).
- `enrollment-create` (POST: orgId, userId, courseId, status?='enrolled') — admin-driven enrollment; **distinct from the learner-side `enroll`** (untouched). Course-published precondition (404 missing, 400 unpublished); `org_course_access.access='enabled'` precondition **only for non-platform-admins** (admin-override convention); 23505 (UNIQUE org_id,user_id,course_id) → 409; 23503 → 404.

**Test count:** `cd functions && npm test` → **1281 passing / 3 skipped** (+125 from this slice). Each endpoint: OPTIONS + 401 unauth + 401 no-profile + key 400s + 403 non-admin + happy platform-admin + happy org-admin + key error codes + 500 generic — averaging 16 cases per file.

**5 frontend files cut over** (+403 / -1160, net –757 lines):
- **`OrgMembersTab.tsx`** (12 → 3 supabase calls): membership read → `/api/org-memberships`; invitation RPC → `/api/invitations` `{scope:'org'}`; member precheck removed (was buggy — compared `full_name` to email — and replaced by the new endpoint's 23505 path); invitation create+link RPC collapsed into one `/api/invitation-create` call (link_id comes back); cancel → `/api/invitation-update {status:'expired'}`; role change → `/api/org-membership-update`; remove → `/api/org-membership-delete`. The 3 remaining `.from('ai_champions')` calls (read + insert + delete) keep `TODO(slice-3c)` markers — Slice 5 owns the GET (`/community/ai-champions`), Slice 3c owns the writes (`POST/DELETE /api/ai-champions`). `user?.id` → `profile?.id` audit applied on the row-action self-check.
- **`BulkInviteDialog.tsx`** (3 → 0): per-row INSERT loop + per-row `get_invitation_link_id` RPC collapsed into ONE `/api/invitation-bulk-create` call; iterate `results[]` for success/failure mapping; `link_id` is on each successful row already. `userId` prop kept on the interface (unused; future cleanup; see follow-up below).
- **`EnrollUserDialog.tsx`** (4 → 0): `org_course_access` + `courses` read collapsed into ONE `/api/org-course-access` call (existing endpoint already does the JOIN); `enrollments` read → `/api/enrollments`; per-course insert → `/api/enrollment-create`. Loading + enrolling flags now cleared in `finally`.
- **`OrganizationsManager.tsx`** (3 → 0; TODO(slice-3b) markers cleared): the post-create assign-existing-admin path → `/api/org-membership-create`; the post-create invite-new-admin path → `/api/invitation-create` (link_id from the response, no second roundtrip). Removed `invited_by_user_id: user?.id` (server-derived).
- **`OrganizationDetail.tsx`** (7 → 0; TODO(slice-3b) markers cleared): all 7 calls — membership reads, the platform-invitations RPC, the add/role/disable/reactivate/invite/cancel handlers — migrated. Member list reshape mirrors `OrgMembersTab`. The legacy follow-up `callApi('/api/invitation-link', ...)` in `handleInvite` deleted (link_id arrives with the create response).

**`OrgUsers.tsx` deleted** (-802 lines). Verified unrouted via `grep` across `src/`; the diff vs `OrgMembersTab.tsx` was purely cosmetic (whitespace + `<AppLayout>` wrapping + import order). Dedupe per the spec's "dedupe OrgUsers/OrgMembersTab" item: **dedupe = delete the dupe.**

**Authorization parity:** validate → authz → DB across every endpoint (same property as Slice 3a — no enumeration via 404-vs-403, since non-admins hit 403 before any row probe). Platform admins bypass the inviter-restriction on the LIST and bypass `org_course_access` on enrollment-create, both documented in inline comments.

**Order-by parity break (deliberate):** the members list in OrgMembersTab + OrganizationDetail now orders by `full_name` ASC (server-side, matching the existing `/api/org-memberships` shape) instead of the legacy `created_at DESC`. Same change Slice 3a accepted for organizations LIST sort regression — not a regression here since the server endpoint always ordered this way.

**Partial Profile DTO** returned by `/api/org-memberships`: rows include only `full_name, email, avatar_url, department` (matches the existing endpoint's projection). Code-reviewer grep verified no consumer in the cut-over files reads any of the missing fields (`first_name`, `last_name`, `is_platform_admin`, `preferred_language`). Risk surface is downstream readers that don't yet exist.

**Follow-up issues filed** (six, all hardening — none blocked the merge):
- **#61** (cosmetic: `SELECT 1 AS exists` in enrollment-create:57-58) — rename `AS exists` → `AS ok` to match the `shared/profile.ts:23` convention.
- **#62** (EnrollUserDialog: per-row error messages) — `EnrollUserDialog.handleEnroll`'s `catch (_err) { failed++; }` swallows per-row error messages; preserves pre-migration UX but a 403 from the `org_course_access` precondition currently surfaces as the misleading "may already be enrolled". Either surface error messages OR call a future bulk endpoint.
- **#63** (BulkInviteDialog: drop the dead `userId` prop) — server now derives `invited_by_user_id` from the token; `BulkInviteDialog`'s `userId` prop is unused; clean up the interface + the OrgMembersTab call site.
- **#64** (Invitation TS type: `token` is required-but-never-returned) — `src/lib/types.ts:49` has `token: string`; the API never exposes it. Tighten to `token?: string` or remove — prevents future regressions where someone reads `invitation.token` expecting a value.
- **#65** (invitations LIST: test gap for empty-string orgId on `scope='platform'`) — only the `scope='org'` empty-orgId branch is tested.
- **#66** (org-membership-create + seat-limit) — endpoint trusts client-supplied `status: 'invited'`; backend `INSERT` doesn't enforce `org.seat_limit` (UI-only gate at `OrganizationDetail.tsx:735`). Parity with pre-migration RLS (org admins had full `ALL`).

**Closes #54** (the post-Slice-3a "scope clarification for remaining supabase.* in cut-over files" issue): every `TODO(slice-3b)` marker resolved, `OrganizationsManager` + `OrganizationDetail` are now supabase-free except for the explicit Slice 3c residue tracked in `OrgMembersTab`/`UserProgressDialog` etc.

**Gates** (pre-deploy on the merged trunk SHA `38b29c0`): functions suite **1281 passing / 3 skipped**; root suite **65 passing**; `npx tsc --noEmit -p tsconfig.app.json` exit 0; `npm run build` exit 0. Zero `supabase.(from|rpc|storage|auth)` matches in the 5 cut-over files; only the 3 deliberate `.from('ai_champions')` calls in `OrgMembersTab` remain (Slice 3c).

**Deploy status:** trunk deploy via `gh workflow run main_func-ai-education-migration.yml --ref feature/lovable-migration` (run #27091444197). Gate 4 user-e2e on PR-6 preview pending post-deploy.


---

## 2026-06-07 — #14: azure-view-url 403 for video blobs (PR #59)

**Who:** emil & Claude.

**Root cause:** `canAccessAsset` in `functions/azure-view-url/index.ts` hand-inlined `public.can_user_access_lms_asset` (the RPC the original Supabase edge function called) but dropped the `l.azure_blob_path = $2` predicate. `CoursePlayer` sends `lesson.azure_blob_path` as `blobPath` for video lessons, and video paths live ONLY in that column (`video_storage_path` is the legacy Supabase column — NULL on the seeded Welcome Video). The EXISTS never matched → 403 for every video; PDFs went through `document_storage_path` (which WAS checked) → 200. Exactly the Playwright-sweep repro in the issue.

**Fix:** one-line — `OR l.azure_blob_path = $2` added to the lessons EXISTS, restoring lesson-branch parity with the canonical RPC (`01-schema.sql`; its thumbnail branch remains unported — consolidation tracked in #60); no loosening beyond the original RLS-derived authz. TDD: new contract test pins all three lesson asset columns in the authz SQL (watched it fail on the missing predicate first).

**Out-of-scope observations (recorded on PR #59, no live bug):** `azure-view-url` also lacks the canonical thumbnail branch (`c.thumbnail_url`) — no caller requests thumbnails there (they use `asset-signed-url`, which has it). Sibling `asset-signed-url` likewise lacks the `azure_blob_path` predicate — no caller sends such values there today. Both folded into follow-up #60 (shared `canAccessLmsAsset` helper, full RPC parity). The xhigh `/code-review` pass on this PR confirmed both as latent-only and routed the rest: thumbnail exact-match 403 consequence → comment on #49, error-classification heuristic (`includes('token')` → 401, JSON-parse → raw 500) → comment on #25, video fixture path-shape nit → comment on #32.

**Gates (re-run after rebase onto post-Slice-3b trunk @212cddc):** functions suite passing (see PR for the count at merge time); `npx tsc --noEmit -p tsconfig.app.json` exit 0; `npm run build` ok. Runtime verification (video 200 + SAS on the PR-6 preview) pending the next trunk deploy — the live function still 403s videos until then.

**Deploy status:** functions changed → needs a trunk deploy after merge.

---

## 2026-06-07 — Slice 2 trunk deploy + combined verification sweep (retroactively logged)

**Who:** emil & Claude (deploy from the main session; sweep in the dedicated Playwright tester session). Logged retroactively later the same day from the PR/issue evidence trail — the sweep session recorded its results on the issues but appended no WORKLOG entry, which let a stale "Slice 2 pending deploy / Gate 4 pending" picture persist into the checkpoint.

**Deploy (08:13–08:16 UTC):** trunk @`2087ce4` (Slice 2's 15 endpoints) via CI run **27087057009** (`gh workflow run main_func-ai-education-migration.yml --ref feature/lovable-migration`), build + deploy green; smoke 15/15 endpoints return 401 `Missing Bearer token` unauthenticated on the regionalized hostname; **86 functions live** at that point (Martin's deploys later the same day — Slice 3a, then Slice 3b's run #27091444197 — brought it to **97**). Announced on PR #35 per convention.

**Combined verification sweep (PR-6 preview, platform admin; results recorded ~09:56 UTC):**
- **Slice 2 Gate 4 PASSED** (closing comment on #8): manager list (`courses-admin` 200) → create draft course → module + text lesson (persists through leave/reopen) → quiz with options + pass threshold (`quiz-admin-save` 200, reopens intact) → publish + Test Org access grant (`course-access-set` 200) → enrollable in learner view → full cascade cleanup verified. Sub-results: upload chain blocked at the blob PUT by storage CORS (#15 — environment, not Slice 2 code; CORS applied and #15 closed the same day) and no-reorder-control evidence posted to #46. **Slice 2 fully accepted.**
- **Slice 7 Gate 4 PASSED** (closing comment on #12): resources list via `POST /api/resources` 200 with **zero `*.supabase.co` requests**; create/edit/pin/search/delete all green; ~1.2 requests/keystroke measured (→ #41). **Slice 7 fully accepted.**
- **#31 post-elevation queue CLOSED:** "re-ran every suite blocked by the org-context bug: ALL PASS" — report dismissal, OrgSettings round-trip, moderation actions, ideas kanban, junk cleanup. Leftover favicon junk noted on #32; standing findings #38–#40 remain open.

**Ledger correction:** the Slice 3a and 3b bookkeeping written concurrently still described Slice 2's Gate 4 as pending ("74 live" / "pending Gate 4"). Checkpoint corrected (our-side facts only) in PR #59; Martin's slice narratives left untouched.

---

## 2026-06-07 — #14 merged + deployed (PR #59 → trunk @5ff8758)

**Who:** emil & Claude. PR #59 squash-merged (cross-review waived by emil — the xhigh `/code-review` pass on the PR stood in; Martin active on Slice 3b concurrently). Trunk deploy via CI run **27091801153** (build + deploy green). Unauth smoke 4/4 `401 Missing Bearer token` on the regionalized hostname: `azure-view-url` (the fix) plus `org-membership-create`/`invitations`/`enrollment-create` — confirming Slice 3b's batch registered in the same deploy (97 live). Issue #14 closed. Remaining acceptance: authed video-200 on the seeded Welcome Video (PR-6 preview) — rides the next tester-session sweep alongside Slice 3b's Gate 4.

---

## 2026-06-07 — Slice 3c: AI-champions writes + user-progress (issue #11, PR #73)

**Who:** emil & Claude (subagent-driven: implementer → spec-compliance review → code-quality review per task; final integration review over the whole branch).

**Scope shipped:** 3 new endpoints + 2 frontend cutovers — the last two org-admin components off Supabase.
- **`ai-champion-create`** — POST `{orgId, userId}`; authz platform admin OR org admin (RLS provenance `20260202125422`); **`assigned_by = profile.id` server-derived** — the old client sent `user.id` (Entra OID, wrong UUID space post-migration); resolves the issue #11 `user?.id` audit item. 23505→409, 23503→404.
- **`ai-champion-delete`** — POST `{orgId, userId}`; same authz; **idempotent 200** even on a zero-row delete (Supabase `.delete().eq()` parity — deliberate divergence from `org-membership-delete`'s lookup-then-404, rationale inline: orgId is client-supplied and scopes the DELETE directly).
- **`user-progress`** — POST `{orgId, userId}`; platform admin OR org admin ONLY (self-access deliberately omitted — the admin analytics dialog is the only consumer; learner-side reads live in Slice 1 endpoints). Aggregates UserProgressDialog's old 5-query client fan-out into ≤5 constant server queries (old client: 3 + 2 per course) and returns the dialog's exact camelCase shape; quiz keys **omitted (not null)** when absent to preserve the dialog's `!== undefined` badge guard (JSON.stringify drops undefined). RLS-parity visibility filter for non-platform-admins (`is_published` + `org_course_access` enabled — mirrors the old PostgREST null-embed skip); `ORDER BY c.title` is a deliberate determinism tightening. Multi-org-admin caller-org approximation documented in the plan/PR.
- **`OrgMembersTab.tsx`** — the 3 remaining champion calls → `callApi`; supabase import gone; spinner now cleared in `finally` (review fix — frontend.md stranded-spinner class).
- **`UserProgressDialog.tsx`** — `fetchUserProgress` collapses to ONE `callApi` call (−151 lines); the four interfaces retained as the API response contract.

**Review trail:** two-stage review per task + final integration review (verdict: ready to merge, zero must-fix). Review fixes landed along the way: 401-body assertion in the delete test, a 13th user-progress test pinning multi-course Map isolation (passed first run), parity comments on the org-wide progress/attempt fetches, cast-safety invariant comment, spinner-finally.

**Follow-up to file:** champion-toggle double-click race in `OrgMembersTab.handleToggleAiChampion` (pre-existing — no in-flight guard; needs an `updatingRole`-style `toggling` state). Surfaced by the Task 4 quality review; not blocking.

**Gates** (work branch pre-merge): functions suite **1316 passed / 3 skipped**; root suite **65 passed**; `npx tsc --noEmit -p tsconfig.app.json` exit 0; both builds exit 0. Grep gates: **zero `supabase` matches across `src/components/org-admin/**`**; zero `*OrgUsers*` page files (deleted in 3b, completes the issue #11 grep gate); `@/integrations/supabase/client` importers down to `OrgAnalytics.tsx` (#72) + the shim itself — Slice 8 decommission surface is now one file.

**Deploy status:** functions changed → needs a trunk deploy after merge (**100 functions** expected live: 97 + 3). Gate 4 (champion badge toggle on the Team tab + member progress dialog in Analytics, PR-6 preview) rides the next tester sweep post-deploy.

---

## 2026-06-07 — Slice 3c merged + deployed (PR #73 → trunk @63bccec)

**Who:** emil & Claude. PR #73 squash-merged after emil's separate-session multi-angle review (9 finder angles → 11 findings: 5 fixed on the branch pre-merge — deliberate-divergence comment on the user-progress visibility filter, stale-data reset in UserProgressDialog, Promise.all on the three OrgMembersTab fetches, Promise.all on user-progress queries 2–4, blind-delete form in ai-champion-delete; 3 no-change routed to #25/#74/#48; #75 filed for the 5×-duplicated course-visibility predicate; 2 deferred). Trunk deploy via CI run **27097283659** (build + deploy green, no host restart needed). Unauth smoke **4/4 401** on the regionalized hostname: `ai-champion-create`, `ai-champion-delete`, `user-progress` + `organizations` control — **100 functions live**. Issue #11 closed. Branch `emil/11-slice-3c` deliberately KEPT (may be reused for fixes the UI tester sweep finds). Remaining acceptance: Slice 3c Gate 4 (champion badge toggle + member progress dialog, PR-6 preview) — handed to the tester sweep alongside Slice 3b's Gate 4 and the #14 authed video-200 re-check.

---

## 2026-06-07 — Tester sweep (3c Gate 4 PASS) + #72 OrgAnalytics cutover (PR #77)

**Who:** emil & Claude (sweep in the dedicated Playwright tester session; triage + #77 in the main session).

**Sweep results (PR-6 preview, platform-admin, evidence on the linked threads):**
- **Slice 3c Gate 4 PASSED 6/6** (PR #73 comment): champion toggle on/off round-trips (`ai-champion-create`/`-delete` 200, body exactly `{orgId, userId}` — no client-side assigned_by), badge persists across reloads; progress dialog renders the full aggregate off exactly ONE `user-progress` 200 (quiz badge only on quiz lessons — the omitted-keys contract held); empty state clean; zero `*.supabase.co` requests. **Slice 3c fully accepted.**
- **Slice 3b Gate 4 partial** (#10 comment): invitation create/copy/cancel + role change all PASS (invitation EMAIL 500 is #22, expected). Remove-member N/A and enrollment-create blocked by sandbox data (no disposable member; both learners already enrolled in the only org course) — closing residue noted on #10.
- **#14 re-check CONFIRMED** (#60 comment): `azure-view-url` 200 authed, mp4 206, real playback — the video fix is verified end-to-end; the standing "authed video-200 rides the next sweep" item is RESOLVED.

**#72 (PR #77): OrgAnalytics cutover — the LAST supabase-importing file.** Dropdown → `/api/organizations` (client-side name sort — endpoint stays `created_at DESC` per the accepted 3a decision); logo update → `/api/organization-update`. **Self-review caught a critical authz-parity gap the delegated review missed:** `organization-update` was platform-admin-only with a provenance comment claiming that was the only UPDATE-capable RLS policy — but migration `20260128223657` ("Org admins can update their org logo", FOR UPDATE `is_org_admin(id)`) deliberately enabled org admins, and the logo flow lives on the `requireOrgAdmin` route. Fixed in the same PR: org admin of the target org may update `logo_url` ONLY (old RLS was row-scoped; tightened to the migration's stated intent), +5 contract tests. LESSON (memorialized): per-table RLS provenance = grep ALL migrations, not the base policy block; check route guards; RLS UPDATE denials are silent zero-row updates, not errors. Repo-wide: **zero `@/integrations/supabase/client` importers besides the shim** — Slice 8's frontend surface is now `client.ts` + the npm package.

**Gates (branch, pre-merge):** functions **1321 passed / 3 skipped** (+5), root 65, builds + tsc exit 0. Functions changed (`organization-update`) → redeploy follows this merge (run id announced on PR #77; function count stays 100).

**Triage from the sweep (not yet filed):** invite links hardcode `https://ai-uddannelse.dk` (`src/lib/config.ts:4` `PLATFORM_BASE_URL`, Lovable-era) — preview-minted invites can't be accepted on the preview origin; candidate issue.

---

## 2026-06-07 — #72 deployed + verified + closed (trunk @820569d)

**Who:** emil & Claude. PR #77 trunk deploy via CI run **27099804563** (organization-update authz; function count unchanged at 100), unauth smoke 3/3 401. UI spot-check on the rebuilt PR-6 preview PASSED (org filter populated + scoping, logo update 200, zero supabase requests) — #72 closed. Org-admin-ROLE logo upload remains contract-tested only (no org-admin login in the tester session) — noted as residue, not blocking. Work branches `emil/11-slice-3c` and `emil/72-org-analytics-cutover` deleted post-verification.

---

## 2026-06-07 — #16 fixed: refresh/deep-link routing + view-mode persistence (PR #85)

**Who:** emil & Claude (isolated worktree session, run in parallel with the admin-settings session holding the main working tree).

**Root cause (3 cooperating defects, diagnosed before fixing — full writeup on PR #85):** (1) `AuthContext.isLoading` tracked only MSAL `inProgress`, not the `/api/user-context` fetch — on hard refresh, `ProtectedRoute` evaluated `requirePlatformAdmin`/`requireOrgAdmin` against a still-null profile ("not loaded yet" ≡ "not authorized") and bounced every admin route to `/app/dashboard` with `replace`. (2) Deep links died across the login round trip: MSAL cache is sessionStorage (fresh tab = unauthenticated), `ProtectedRoute` redirected to `/login` without saving the location, and `Login` navigated to a fixed role home. (3) `viewMode` was in-memory `useState` — every reload reset it to Platform Admin, which also fed defect 1 via `effectiveIsPlatformAdmin`. Ruled out: static layer (navigationFallback correct) and `main.tsx`'s pre-render `handleRedirectPromise` (load-bearing prior fix 2494c32 — untouched).

**Fix (PR #85, TDD — 6 failing tests watched fail first):** `contextLoading` flag widens `isLoading` until user-context resolves (cleared in `finally`; signed-out users never "loading", so cold login renders immediately); new `src/lib/post-login-redirect.ts` sessionStorage stash written by `ProtectedRoute`, consumed once by `Login` (in-app-path validated); `viewMode` persisted per tab; `signOut` clears both keys. Code review (7 finder angles): 3 findings fixed pre-merge (stale stash/viewMode across sign-out, validation dedup), remainder refuted/dispositioned on the PR. Gates: 82/82 root tests, tsc, build all exit 0. Frontend-only — NO function deploy; the trunk push rebuilds the PR-6 preview. Gate-4 preview script on PR #85 (cold-login regression guard, refresh-stays-put, copy-link in fresh tab, view-mode persistence) — USER verification on the rebuilt preview pending.

---

## 2026-06-07 — #16 Gate 4 user-verified + closed

**Who:** emil & Claude. All four Gate-4 steps PASSED on the PR-6 preview (trunk @acaf771): cold Entra login with no /login bounce (regression guard), hard refresh stays on the origin route, copied deep links open their target in a fresh tab, sidebar view mode survives reload. View-mode persistence failed emil's FIRST manual pass but passed on re-test with zero code change in between — attributed to a stale cached bundle from before the preview rebuild (no DevTools storage evidence ended up being needed). Issue #16 CLOSED (manually — `Closes #N` doesn't auto-fire on non-default-branch merges). Frontend-only: no function deploy this slice; production (`main`) untouched until the PR-6 cutover. Work branch `emil/16-deeplink-routing` deleted post-verification.

---

## 2026-06-07 — Admin-settings hardening bundle: #38 #39 #40 (PR #84)

**Who:** emil & Claude (subagent-driven: implementer + spec review + quality review per fix; /code-review high on the full diff).

- **#38** `PlatformCommunityModeration` — queries ALL report scopes (the backend no-filter mode was already platform-admin-only by Slice 5 design; zero backend changes), per-report scope badge (org name via `/api/organizations` lookup with 5 min staleTime, "Global" otherwise), scope-aware view link, de-globalized header copy. 4 tests incl. an exclusive window.open assertion that fails on an inverted scope mapping (mutation-checked).
- **#39** `OrgSettings` — profile-gated three-way guard (spinner / `EmptyState` "select an organization" / form). Zero editable controls without an org. Review fix: the guard ignores the save-triggered shared-`isLoading` refetch so the form no longer swaps to a full-page spinner mid-save. 5 tests.
- **#40** `PlatformSettings` — `populated` flag set only after a successful read; the editable form (and all Save/SMTP-test buttons) structurally unreachable otherwise — error `EmptyState` + retry instead; `saveSetting` no-ops as defense-in-depth. The branding/SMTP wipe path is impossible by construction and mutation-pinned (unconditional `setPopulated(true)` fails 2 tests). 5 tests, fixture-only SMTP values.

All new strings i18n en+da. **Frontend-only — no function deploy** (trunk push rebuilds the PR-6 preview). Gates: build exit 0, **79/79 tests**, tsc exit 0, zero `supabase` in touched files. Review trail: 7 finder angles → 31 candidates → 2 fixed in-PR (spinner-swap, staleTime), follow-ups **#86** (comment-report deep link) + **#87** (useOrganizations/org-guard/PageSpinner dedup) filed; 2 deferred findings documented on PR #84 awaiting issues (PostDetail viewer-org feature gate blocks platform-admin view-content; `platform-settings-update` replace semantics need server-side validation); rest refuted/accepted with reasons on the PR.

---

## 2026-06-07 — Slice 3b Gate 4 closed: org-admin half user-verified (#78, PR #83)

**Who:** martin & Claude (Playwright tester session, PR-6 preview, `viewMode='org_admin'` via the bottom-left profile-menu Switch View — no SQL elevation needed, see [[project-role-view-switcher]]).

**Closes the partial Gate 4 from the 2026-06-07 combined sweep** (#10 comment: "Remove member N/A and enrollment-create blocked by sandbox data"). All eight Slice 3b endpoints now have at least one user-verified path; the two that the sweep skipped were re-attempted here with their explicit blockers addressed.

**Per-endpoint results (UI-driven unless noted; zero `cairuxpyfshugwjrrqha.supabase.co` requests observed throughout — only the deliberate Slice 3c residue would be `*.ai-champions` and those are now also migrated):**

| # | Action | Endpoint | Result |
| - | - | - | - |
| 1 | OrgMembersTab → Invite Member (single) | `POST /api/invitation-create` | **200** + pending row appears; `send-invitation-email` 500 follows (#22 graceful fallback, RESEND_API_KEY unset on preview) — toast still confirms "invited", refetch chain 200 |
| 2 | OrgMembersTab → Bulk Invite (CSV: 2 fresh + 1 duplicate of step-1 email) | `POST /api/invitation-bulk-create` | **200** with `results[]` showing **3 successes** — see "Finding A" below; UI shows "3 invitations created successfully", 3 `send-invitation-email` 500s follow per row (#22 same fallback) |
| 3 | OrgMembersTab → Cancel pending invite (the leftover `invitee@test-org.example`) | `POST /api/invitation-update` | **200** + row removed from pending list + "Invitation cancelled" toast |
| 4 | OrgMembersTab → row-menu Promote to Admin → confirm; then Change to Learner → confirm | `POST /api/org-membership-update` (×2) | **200** each; role chip flips Learner ↔ Admin in-place; refetch chain 200 |
| 5 | OrgMembersTab → row-menu Remove from Team (Learner User) → confirm | `POST /api/org-membership-delete` | **200**; row gone from members table; seats stat dropped 3 → 2 |
| 5b | OrganizationDetail (Platform Admin viewMode) → Add User (Learner User, role=Learner) | `POST /api/org-membership-create` | **200**; Learner User restored, seats stat 2 → 3, AI Champion badge preserved (championship row is independent of membership lifecycle) |
| 6 | EnrollUserDialog → Learner User → AI Fundamentals — **UI dead-end** (already enrolled; cascade-delete did NOT remove the enrollment row when membership was deleted in step 5) | n/a | UI returns "Already enrolled" — see "Finding B" |
| 6-via-fetch | Direct `fetch` from the authenticated browser session, duplicate-enrollment payload `{orgId,userId,courseId}` matching Learner User's existing AI-Fundamentals row | `POST /api/enrollment-create` | **409 `{"error":"User is already enrolled in this course"}`** — endpoint deployed + reachable + duplicate-detection path correct |
| 2-followup | Direct `fetch` invitation-bulk-create with 2 rows: 1 valid + 1 with `firstName.length === 101` (server's `validateOptionalText` rejects >100) | `POST /api/invitation-bulk-create` | **200** with `results[0].success=true` + `results[1].success=false, error:"firstName must be a string of 100 characters or fewer"` — concrete proof the per-row try/catch keeps the batch alive, which Finding A prevented from firing through the UI path |

**Finding A — to file (`hardening`):** `invitations` table has NO unique constraint on `(org_id, email) WHERE status='pending'`. The bulk-create endpoint's `23505 → 'An invitation for this email is already pending'` branch (`functions/invitation-bulk-create/index.ts:118-127`) and the symmetric branch in `invitation-create` are **dead code today** — DB accepts duplicate pending rows. OrgMembersTab now renders `gate4-single-2026-06-07@example.test` **twice** in the pending list as a result. Suggested fix: `CREATE UNIQUE INDEX invitations_pending_unique_per_org ON public.invitations (org_id, email) WHERE status = 'pending';` after a dedupe backfill. Not blocking — Finding A doesn't break any user-facing path; the per-row catch path itself IS proven correct by the firstName>100 fetch test. Issue draft body parked at `/tmp/issue-dup-pending.md` in the session (auto-mode classifier blocked the `gh issue create`).

**Finding B (kept as accepted trade-off, not an issue):** removing an `org_membership` row does NOT cascade-delete the user's `enrollments` for that org. The orphaned enrollment surfaces if the user is re-added — EnrollUserDialog shows "Already enrolled". This matches the remove-member confirmation copy ("their progress data will be retained but they won't be able to continue learning until re-invited") and the existing accepted-trade-off section in STATUS.html on enrollment TOCTOU. Adding to the operational quirks list rather than filing.

**Cold-load redirect (timing note re #16/#79):** during my viewMode toggle dance I hit the deep-link-to-dashboard redirect three times when navigating `/app/admin/...` URLs directly after switching viewMode. This is the same family as #16 (just fixed by PR #85, merged DURING this session — `acaf771`) and very likely #79 (cold-load redirect on `/app/admin/organizations/:orgId`). PR #85 was merged after I'd already collected my walk-through observations; the redirect behavior I saw was on the pre-#85 build of the preview. Once the trunk rebuild lands the #85 fix, the next tester sweep should confirm both #16 (the PR #85 Gate-4 script) and #79 (re-verify the deep link) — and #79 likely closes alongside.

**State left behind on the preview env:** 5 pending invitations under `gate4-*@example.test` (single + 3 bulk + 1 dup-pending from Finding A, all expire 14/06/2026) plus 1 from the fetch-per-row test (`gate4-perrow-ok-2026-06-07@example.test`). Not cleaning — they're scoped to Test Org, expire in 7 days, and serve as walkthrough audit trail.

**Closes #78.** Slice 3b is now FULLY user-verified end-to-end. The "Admin-page test debt" entry's Slice 3b dialog line in STATUS.html stays open (Vitest debt for OrgMembersTab/dialogs is a separate task from runtime Gate 4).

---

## 2026-06-07 — Two frontend bug fixes bundled: #70 + #89 (PR #92)

**Who:** emil & Claude. Two disjoint-file bug fixes claimed and shipped in one PR (overlap check: `CreateOrgDialog` in `OrganizationsManager.tsx` vs `PostDetail.tsx` — no shared lines, no competing draft PR). Code review skipped by user direction (small, well-scoped); solo self-merge.

- **#70** — Create Organization dialog was clipped at the viewport edge on short (~700px) windows, leaving the Create button unreachable (no inner scroll region). Added `max-h-[85vh] overflow-y-auto` to its `DialogContent` (`OrganizationsManager.tsx:257`) — the repo's established scrollable-dialog idiom, identical to `CourseEditor.tsx`'s sibling `max-w-lg` dialog.
- **#89** — `PostDetail`'s community gate (`PostDetail.tsx:184`) redirected to `/app/dashboard` on `!features.community_enabled`, where `features` is the VIEWER's effective flags (platform + their own `currentOrg` override, `usePlatformSettings:144-149`), not the reported post's org. A platform admin clicking "View content" from an org-scoped moderation report got bounced when their own org had community disabled (or none selected); backend authz (`community-post:49`) already permitted them. Added `&& !effectiveIsPlatformAdmin` (view-mode-aware: `isPlatformAdmin && viewMode === 'platform_admin'`) — admins are exempt, org admins stay gated by their own org (the correct scope for them). New `PostDetail.test.tsx` covers both branches (admin → post renders; non-admin → redirect). This is the FIRST of PR #84's two deferred review findings to land; the other is **#90** (platform-settings-update server-side validation, still open).

**Frontend-only — no function deploy** (trunk push rebuilds the PR-6 preview). Gates: `npm run build` exit 0, **98/98 tests** (2 new), `tsc --noEmit -p tsconfig.app.json` exit 0, zero `supabase.*` in touched files. Work branch `emil/70-89-org-dialog-scroll-postdetail-gate` deleted post-merge. Issues #70 + #89 closed manually (`Closes #N` doesn't auto-fire on non-default-branch merges).

---

## 2026-06-08 — #22 send-invitation-email verified + closed (Resend domain stood up)

**Who:** martin & Claude (Playwright MCP, PR-6 preview, platform-admin viewMode on Test Org).

**Closes #22.** Pre-cutover owner action — verify-only, no code change. The Slice 3b walkthrough on 2026-06-07 documented `send-invitation-email` 500-ing per-invite as the graceful fallback after `invitation-create`'s 200 (`new Resend(undefined)` throwing on lazy init); root cause was unset `RESEND_API_KEY` on the function app. Today's session stood up the prerequisites and verified end-to-end:

- **Resend domain `ai-uddannelse.dk`** added in EU region, apex (no subdomain — no other mail flows from this domain today; if/when reminders et al. ship, all-transactional means no apex-isolation benefit). DNS at GoDaddy: 1 ownership TXT, 1 DKIM TXT (`resend._domainkey`), 1 return-path MX + 1 return-path TXT on `send.` (custom return path enabled to drop the "via resend.com" badge). All green in Resend. DMARC deferred (optional).
- **Key Vault `ai-education-migration`** uses RBAC (not access policies): function app's managed identity (`8ef8a119-...`) granted `Key Vault Secrets User` at the vault scope; owner granted `Key Vault Secrets Officer` to write the secret. Secret `ResendApiKey` set (Resend "Sending access" key scoped to `ai-uddannelse.dk`).
- **Function app settings** added: `RESEND_API_KEY` as a KV reference (`@Microsoft.KeyVault(VaultName=ai-education-migration;SecretName=ResendApiKey)`) — resolved green in the portal — plus `STATIC_ASSETS_BASE_URL=https://ai-uddannelse.dk` (used for the email logo at `${BASE}/logo-light.png`; the apex SWA is fine for preview-sent emails since the logo image is identical). Function app restarted clean.

**Verification (Playwright e2e on preview):** platform-admin profile `martin vladinov` → Test Org → Invite User → `verify-22-2026-06-08@example.test` (Learner) → `POST /api/send-invitation-email` returned **200** with Resend message ID `25930f03-5ede-4aea-a01a-0e6f77c16038` (`x-resend-daily-quota: 0`, `ratelimit-remaining: 4/5`). The function's `ALLOWED_LINK_DOMAINS = ['ai-uddannelse.dk']` check passes because the frontend's `getInviteLink()` hardcodes the prod domain in the link — which is exactly the underlying mechanism for **#80** (preview-minted invites can't be accepted on preview because the link points at prod). For #22's AC ("invitation email sends in preview e2e"), that hardcoding is incidental and the verification is unambiguous: function returned 200, Resend accepted. Screenshot at repo-root `pr22-verify-invite-200.png` (attached to the issue close-out).

**Operational notes (worth keeping):**
- KV uses RBAC — `az keyvault set-policy` fails with `Cannot set policies to a vault with '--enable-rbac-authorization' specified`. Use `az role assignment create --role "Key Vault Secrets User|Officer" --scope $(az keyvault show --name <vault> --query id -o tsv)` instead.
- KV references are silently broken if the role assignment is missing — value renders as the literal `@Microsoft.KeyVault(...)` string at runtime. Portal "Configuration → Application settings → row" shows a green ✓ when resolved; check that, not the CLI output (which omits values).
- Node 20 EOL warning surfaces on every `az functionapp config appsettings set` — pinned intentionally (`.claude/rules/functions.md`: Node 22 crashes the worker's gRPC handshake). Ignore until that's re-verified.

**Docs-only PR** (no source files touched — AC was verify-only). Work branch `martin/22-resend-secrets-verify`.

---

## 2026-06-12 — #17 per-course access gate on `course-player-data` (PR #96)

**Who:** martin & Claude. Solo self-merge (`/code-review` run + fixes applied this session; user waived the re-run). Disjoint from Emil's open PR #95 (tooling).

**Closes #17.** `course-player-data` returned the full course payload (modules + lessons + progress + review) to ANY authenticated profile — a learner could load any *published* course, including ones their org was never granted access to. Cross-org read exposure in a multi-tenant product ("fix before go-live").

- **Backend gate** (`functions/course-player-data/index.ts`) — parity with `quiz-by-lesson`, keyed on `courseId`: platform admins bypass (suite convention); everyone else needs an `active` membership in an org that has the course `enabled` AND `is_published = TRUE`, else **403 `Course access denied`**. Runs after the 404 existence check and before any module/lesson content is fetched, so a denied request leaks nothing.
- **Frontend** (`src/pages/learner/CoursePlayer.tsx`) — the endpoint can now 403; `fetchData` had no try/catch/finally and stranded the spinner on any failure. Wrapped it: clear `loading` in `finally`, toast a friendly message, fall through to the existing "not found" empty state with a Back button. Also covers 404/transient.
- **Self-review fixes (commit `3f75f0b`):** added `.catch` to the `onReviewSubmitted` re-fetch (a 2nd call site to the same endpoint — the now-possible 403 was an unhandled rejection); added a contract test pinning *non-admin + unpublished → 403* with the gate SQL asserted BY VALUE (`is_published = TRUE`, `oca.access = 'enabled'`, `om.status = 'active'`) so an allow-all regression fails the test instead of slipping past a loose table-name substring check; removed a dead `useCallback` import.
- **Notes left on the PR (not changed):** the gate grants via *any* member org while downstream progress/review use the client `orgId` (user's-own-data only — no cross-tenant leak); the access-check SQL is hand-duplicated across many endpoints (a `hasCourseAccess` helper in `shared/profile.ts` is the deeper fix — `isActiveMember`/`isOrgAdmin` already establish the `SELECT EXISTS(...) AS ok` pattern); pre-existing stranded-spinner when `currentOrg` is null (early return sits outside the try); ungated sibling writes `lesson-progress`/`enrollment-complete` (out of scope — worth a follow-up issue).

**Gates:** `functions` tsc 0 + **1324/1327** (1 new test; `course-player-data` 7/7); frontend tsc 0, build OK, **98/98**. **Function deploy required** (`course-player-data` source changed) — deployed from fresh trunk via CI (`functions-action` ToS-block lifted; `func` CLI still uninstallable). **Gate 4 (authed smoke: 403 non-member / 200 member) is user-verified and PENDING.** Work branch `martin/17-course-player-access-gate`.

---

## 2026-06-12 — #19 course-review entry point in the learner flow (PR #97)

**Who:** martin & Claude, in a parallel git worktree (`../lw-issue-19`) alongside the #17 chat. Solo self-merge after a subagent-driven two-stage review (spec compliance + code quality, both clean — serves as the `/code-review` gate). Disjoint from Emil's open PR #95 (tooling) and from #17 (`functions/course-player-data`).

**Closes #19.** `CourseReviewDialog` was built and rendered in `CoursePlayer.tsx` but reachable ONLY through the transient "Leave a Review" button inside `CourseCompletionDialog`, which appears for the single instant the final lesson completes. Holes: a quiz last-lesson's "Finish Course" button navigates straight to `/app/courses` (no prompt — the 2026-06-06 sweep's symptom); revisiting a completed course had no entry point (so editing a review was impossible despite the dialog's "Update Your Review" mode); `courseJustCompleted` + dialog dismissal gave no second chance.

**Decision — surface, not remove.** The review feature (both dialogs + the gated `/api/course-review` endpoint + edit-existing support) was intentional Slice-1 functionality, so per the issue's accept-or-remove AC we added a reliable entry point rather than deleting the path.

- **Frontend-only** (`src/pages/learner/CoursePlayer.tsx`): a persistent sidebar button under the progress bar, gated `features.course_reviews_enabled && progressPercent >= REVIEW_MIN_PROGRESS` (**20%**), label `existingReview ? 'Edit your review' : 'Rate this course'`, opening the existing dialog via `showReviewDialog`. The 20% threshold (vs complete-only) was the issue owner's call. The completion-dialog path is untouched; `onReviewSubmitted` already refetches so the label flips to "Edit your review" after a first submit.
- **New `CoursePlayer.test.tsx`** (5 tests): visibility threshold (0% hidden / 20% shown), feature gate (disabled → hidden even at ≥20%), rate-vs-edit label, dialog-opens-on-click (asserts the real portaled `role="dialog"`).
- **Out of scope (deliberately):** #18 completion semantics / quiz "Finish Course" navigation / `handleCompleteLesson`; #17 `functions/course-player-data` backend.

**Gates:** frontend tsc 0 (`-p tsconfig.app.json`), build OK, **103/103** tests (CoursePlayer 5/5). **No function change → no deploy required**; the trunk push rebuilds the PR-6 preview (frontend). **Gate 4 (authed: open a course → complete ≥20% → "Rate this course" appears → submit a rating → reload → label flips to "Edit your review") PENDING** on the preview. Work branch `martin/19-course-review-entry-point`. Spec + plan under `docs/superpowers/{specs,plans}/2026-06-12-course-review-entry-point*`.

**Follow-up noted (not filed — auto-mode declined the issue create as out-of-scope):** `CoursePlayer.tsx` has no i18n wiring; every string is hardcoded English (pre-existing, whole-file), and the two new strings inherit that. Recommend a ticket to internationalize the page as a unit rather than special-casing two strings.

**Op-note for next session:** committing from a parallel worktree gets blocked by `guard-trunk.mjs` once the main checkout moves onto the protected trunk (it reads the branch from the session cwd, not `git -C <worktree>`). Fix: use the `EnterWorktree` tool with the worktree path to move the session cwd into the worktree, then commit. Plain `cd` doesn't persist (worktree is outside the allowed working dirs).

---

## 2026-06-12 — Slice 8: Decommission Supabase (#13, PR #98) — the LAST migration slice

**Who:** emil & Claude. Solo self-merge (code review skipped by user direction). Deps #8–#12 all closed. Branched off trunk; rebased onto trunk after #96/#97 landed mid-session — the `CoursePlayer.tsx` overlap flagged on the PR resolved as a clean auto-rebase (#96's `fetchData` try/catch and my two comment rewords occupy different regions; zero conflict).

**Closes #13.** Removes the now-dead Supabase surface — the app no longer depends on it:
- Deleted orphaned `src/integrations/supabase/{client,types}.ts` — zero importers (the `supabase` client and the `Database` type were self-referential within those two files only).
- Dropped `@supabase/supabase-js`; regenerated `package-lock.json` (9 packages removed).
- Stripped `VITE_SUPABASE_URL` / `_PROJECT_ID` / `_PUBLISHABLE_KEY` (+ the anon-key comment) from the SWA build workflow.
- Removed dead `supabase/functions/` (11 Deno edge functions, all superseded by `functions/`) + `supabase/config.toml`.
- Reworded residual `supabase` comments/test-strings across 6 `src/` files (`storage.{ts,test.ts}`, `ideas-api.{ts,test.ts}`, `IdeaLibrary.test.tsx`, `CoursePlayer.tsx`) — **behaviour-preserving**. `extractLmsAssetPath` matches legacy `/storage/v1/object/{sign,public}/lms-assets/` URLs by **path prefix, not hostname**, so the code itself carried no "supabase" string — only comments + test-fixture hostnames did. That legacy fallback path is RETAINED.

**Decision — retained `supabase/migrations/`:** removed `functions/` + `config.toml` (dead runtime/CLI config) but KEPT the 43 SQL migrations as historical RLS-provenance (referenced by the `slice-workflow` playbook + the post-cutover authz-consolidation #47/#60/#75). The issue's grep AC is scoped to `src/`, unaffected. Flagged on PR #98 for the reviewer in case they want migrations gone too.

**Gate 3 (acceptance) green, re-verified post-rebase:** `grep -rniE supabase src/` → **0 matches**; `npm run build` exit 0; `npx tsc --noEmit -p tsconfig.app.json` exit 0; `npm test` **103/103** (20 files).

**Frontend/config-only — no function deploy** (no Azure Functions code changed; 100 functions stay live). The trunk push rebuilds the PR-6 preview with the supabase-free bundle.

**Gate 4 (full all-roles e2e regression):** the issue's third AC — user-verified on the rebuilt PR-6 preview, PENDING. This is the LAST slice before PR #6 → main (#69): remaining road-to-merge = the all-roles regression sweep + the at-merge infra flips (#33 + domain/Entra + SWA backend re-link).

**Issue #13 closed manually** (`Closes #N` doesn't auto-fire on non-default-branch merges). Work branch `emil/13-decommission-supabase` deleted post-merge.

---

## 2026-06-24 — MVP shipped: PR #99 (`mvp` → `main`) merged + deployed

**Who:** martin & Claude. Pre-merge review by Claude (multi-agent), fixes by Claude on the `mvp` branch; **merged by martin** (the `main` ruleset requires 1 approval from a non-author and has no admin bypass, so neither the author nor an `--admin` override could self-merge — see op-note).

**The umbrella merge.** PR #99 brought the whole MVP to trunk in one merge commit (`fd66153`): the full backlog sweep (35 issues auto-closed), CI test gates (`.github/workflows/ci.yml`), the navy UI re-skin, backend hardening, and the collaboration system **re-pointed at `main`** (#33). `main` had not moved since PR #6; `mvp` was 64 commits ahead, 0 behind. Frontend tests 103→**231**, functions 1324→**1383** (3 `DATABASE_URL`-gated skips).

**Pre-merge review (this session).** Three specialized agents over the backend hardening + auth/access surface. Verified **clean**: `requirePlatformAdmin` sweep (#47, faithful 1:1 across 19 endpoints), access predicates (#60/#75), the `internalError` CWE-209 sweep (#25 — a net security improvement over `main`, which leaked `err.message`), settings merge (#90), enrollment completion (#18). **Three findings fixed on-branch** (commit `cdbc9d5`), each test-pinned:
- **C-2** — `org-membership-create` seat limit was a check-then-insert race (two concurrent adds at limit−1 both passed). Now one `withTransaction` + `SELECT … FOR UPDATE OF o`, serializing concurrent adds.
- **Silent-failure** — `invitation-bulk-create` swallowed unexpected per-row DB errors (no `context.error`) and leaked the raw driver message into the per-row result. Now logged server-side + constant `"Could not create invitation"` (the #25 leak was still open inside the batch loop).
- **I-1** — org name now validated on its **trimmed** length (whitespace-only rejected) and persisted trimmed (`normalizeOrgName`); frontend zod mirrors with `.trim()`; parity test gains whitespace fixtures.

**Deploy.** Auto-deploy green on merge — functions (run `28097464299`) + SWA (`28097464267`) + CI (`28097464257`). **Smoke OK** on the regionalized host (`func-ai-education-migration-…swedencentral-01`): unauth **6/6 → 401** + OPTIONS preflight 204 (incl. all three changed endpoints). Host healthy, no restart needed.

**Issue hygiene.** #33 (re-point collab) auto-closed correctly. **#26 was wrongly auto-closed** by commit `4a4db7a`'s close-keyword despite a scrubbed PR body — the TLS change shipped **inert** (see below), so it was **reopened** and linked to #103. Follow-ups filed: **#103** (DB TLS `verify-full` is inert — the `pg` Pool lets `?sslmode=require` overwrite the explicit `ssl` object, so the embedded CA bundle / `verify-full` / `DATABASE_SSL_INSECURE` hatch are all dead code; connections still succeed via Node's default store = no behavior change, no outage; needs the URL-merge fix **plus staging cert validation** before any flip), **#104** (substring auth detection in 5 blob handlers), **#105** (course-visibility schema-drift test).

**Remaining (all human-gated):** Azure prod cutover flips (SWA backend re-link + `VITE_API_BASE_URL=""`, prod Entra redirect URIs, custom domain + `VITE_PLATFORM_BASE_URL`); the open backlog #103/#104/#105/#28/#49/#71/#91/#29; a full all-roles e2e regression sweep on the deployed app.

**Op-notes for next session:** (1) the `main` ruleset needs **1 approval from a non-author** with **no bypass actors** — neither self-approve nor `gh pr merge --admin` works; a second account/dev must approve, or temporarily add a bypass actor. (2) Removing `Closes #X` from a PR **body** is not enough — **commit-message** keywords on the branch also auto-close on merge to the default branch (that's how #26 closed). (3) Deploy smoke: several "read" endpoints (e.g. `organizations`, `platform-settings`) are **POST-only** — an unauth GET returns a misleading 404; smoke with POST and expect 401. Work branch `martin/mvp-merge-bookkeeping` for this ledger update.
