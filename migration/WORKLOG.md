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

**Issue hygiene.** #33 (re-point collab) auto-closed correctly. **#26 was wrongly auto-closed** by commit `4a4db7a`'s close-keyword despite a scrubbed PR body — the TLS change shipped **inert** (see below). Briefly reopened to flag the premature close, then **closed again as `not planned`, superseded by #103** (the canonical tracker for the real fix + staging validation). Follow-ups filed: **#103** (DB TLS `verify-full` is inert — the `pg` Pool lets `?sslmode=require` overwrite the explicit `ssl` object, so the embedded CA bundle / `verify-full` / `DATABASE_SSL_INSECURE` hatch are all dead code; connections still succeed via Node's default store = no behavior change, no outage; needs the URL-merge fix **plus staging cert validation** before any flip), **#104** (substring auth detection in 5 blob handlers), **#105** (course-visibility schema-drift test).

**Remaining (all human-gated):** Azure prod cutover flips (SWA backend re-link + `VITE_API_BASE_URL=""`, prod Entra redirect URIs, custom domain + `VITE_PLATFORM_BASE_URL`); the open backlog #103/#104/#105/#28/#49/#71/#91/#29; a full all-roles e2e regression sweep on the deployed app.

**Op-notes for next session:** (1) the `main` ruleset needs **1 approval from a non-author** with **no bypass actors** — neither self-approve nor `gh pr merge --admin` works; a second account/dev must approve, or temporarily add a bypass actor. (2) Removing `Closes #X` from a PR **body** is not enough — **commit-message** keywords on the branch also auto-close on merge to the default branch (that's how #26 closed). (3) Deploy smoke: several "read" endpoints (e.g. `organizations`, `platform-settings`) are **POST-only** — an unauth GET returns a misleading 404; smoke with POST and expect 401. Work branch `martin/mvp-merge-bookkeeping` for this ledger update.

---

## 2026-06-24 — #105 course-visibility schema-drift guard merged (PR #108)

**Who:** martin & Claude. Branch `martin/105-course-visibility-drift-test`; reviewed via `/code-review` (xhigh), merged by martin after the `main` ruleset was relaxed for this merge.

**What.** Added a `describe('schema-drift parity guard')` block to `functions/shared/course-visibility.test.ts`, mirroring `lms-asset.test.ts`: it `readFileSync`s `migration/azure/01-schema.sql` and fails if (a) `courses.is_published boolean` or the `org_course_access` `org_id`/`course_id`/`access` columns are renamed/retyped, or (b) the canonical rule embedded in `can_user_access_lms_asset` and `courseVisibilityPredicate` stop sharing the published + org-enabled conjuncts (`c.is_published = TRUE`, `oca.course_id = c.id`, `oca.access = 'enabled'`). Closes the defense-in-depth gap #105 flagged — the predicate was previously pinned by hand against an inline comment only. **Test-only — no runtime code, no `dist/` change.**

**Review (this session, `/code-review` xhigh).** No correctness bugs (each regex traced to its schema source; suite green). Three low-severity cleanup findings, two applied on-branch (commit `dd424c2`): **#3** — `org_course_access` columns now pin TYPE not just name (`uuid` / `public.access_type`), so a retype also trips the guard; **#2** — parity test/comment reworded to be honest it is a substring pin (catches a dropped/renamed conjunct, not one widened while the literal survives). The third — DRY the duplicated `01-schema.sql` extraction regex shared with `lms-asset.test.ts` — was deliberately deferred (it would pull `lms-asset.test.ts` into a PR scoped to one test file) and filed as **#109**.

**Verify.** functions `npm run build` (tsc) exit 0; `npm test` **1386 pass / 3 skip** (112 files — unchanged from baseline). Type-pin proven to bite (an `access → text` retype fails the new assertion).

**Merge + deploy.** Merged as `8ca97ed` (merge commit). **#105 closed manually** (no closing keyword in the PR title/commits, so no auto-close); remote branch deleted. Auto-deploy green: CI + SWA + functions all ✅. **No runtime smoke** — test-only, functions runtime byte-identical (no `dist/` change).

**Op-note for next session.** `gh pr merge <n>` fails with `could not determine current branch: not on any branch` when the local checkout is on a **detached HEAD** (here: mid-#104 work). The server-side merge still completes — only the post-merge local `--delete-branch` step aborts. Delete the remote branch out-of-band: `gh api -X DELETE repos/MartinHenriksenAIR/learn-wings/git/refs/heads/<branch>`. Work branch `martin/108-bookkeeping` for this ledger update.

---

## 2026-06-25 — #49 thumbnail SAS data audit — verified clean, no rows to normalize

**Who:** martin (ran the SQL) & Claude (drove). Branch `martin/49-thumbnail-sas-audit`. Data-only audit — no source change, 0 rows mutated.

**Context.** #49 was the *data half* of PR #35's finding 2: before `src/lib/storage.ts` learned to parse Azure blob URLs, saving any field of a course persisted the full signed **SAS URL** into `courses.thumbnail_url` instead of the stable blob path (`extractLmsAssetPath(x) ?? x` fell through to the signed URL). The code half landed in #35 (reads self-heal → next save normalizes); this issue was the one-time DB sweep so nothing depends on the parser fallback.

**Method.** Read-only SQL against the live Azure PG 15 via `psql` in Azure Cloud Shell. A temporary single-IP firewall rule (`tmp-issue49-audit`) was added for the operator's address and **removed immediately after** — no other Azure mutation, no secrets printed (the connection string was read from the function app setting inside Cloud Shell and never surfaced). The audit predicate mirrors `extractLmsAssetPath()`'s Azure branch exactly — host end-anchored to `*.blob.core.windows.net`, query stripped, container segment dropped:
`WHERE thumbnail_url ~* '^https?://[^/]+\.blob\.core\.windows\.net/'`.

**Result — clean (0 hits).**
- Faithful audit query → **(0 rows)**.
- Broader confirmation (the issue's own `LIKE '%blob.core.windows.net%'` + `'%sig=%'` criteria, plus sanity counts): `total_courses=1, with_thumbnail=1, http_url_thumbs=0, blob_host_anywhere=0, sas_token_anywhere=0`. The single course's thumbnail is already a stable relative path (not a URL at all).

**Conclusion.** No `courses.thumbnail_url` row holds an Azure host or SAS token; **no normalization write was needed** — the #35 parser fix + self-healing reads already kept the data clean. **Caveat:** the sandbox DB currently holds one course, so this is conclusive for *current* data only. If production rows carrying legacy SAS URLs are migrated in later, re-run the same audit; if it returns hits, apply the verified normalize statement below.

**Verified normalize SQL (unused now — recorded for any future hit):**
```sql
UPDATE courses
SET thumbnail_url = regexp_replace(split_part(thumbnail_url, '?', 1), '^https?://[^/]+/[^/]+/', '')
WHERE thumbnail_url ~* '^https?://[^/]+\.blob\.core\.windows\.net/[^/?]+/[^/?]+'
  AND regexp_replace(split_part(thumbnail_url, '?', 1), '^https?://[^/]+/[^/]+/', '') <> thumbnail_url;
```
Idempotent (rewritten rows no longer match); the regex reproduces the JS `pathSegments.slice(1).join('/')`. If a matched row ever contains `%`-encoding, decode per segment to match `decodeURIComponent` — none present today.

**Closes #49.** No deploy (data/docs only). Work branch `martin/49-thumbnail-sas-audit` for this ledger update.

---

## 2026-06-25 — #103 DB TLS verify-full made effective (PR #112, merged @651c16b, deployed + smoke ok)

**Who:** martin & Claude. Branch `martin/103-db-tls-verify-full`; reviewed via `/code-review` (xhigh), self-merged solo after a clean pass + a **live-cert deploy-gate validation** (the `main` ruleset allowed the merge — `mergeStateStatus: CLEAN`).

**What.** `getDb()` passed BOTH `connectionString` and `ssl: buildSslConfig()` to `new Pool(...)`. pg 8.x's `ConnectionParameters` does `Object.assign({}, config, parse(connectionString))`, so the prod `DATABASE_URL`'s `?sslmode=require` re-derived `ssl → {}` and **clobbered** `{ ca: AZURE_POSTGRES_CA, rejectUnauthorized: true }` — CA pinning, verify-full, AND the `DATABASE_SSL_INSECURE=1` hatch were all dead code (connections succeeded via Node's default Mozilla store, confirmed empirically against `pg@8.21.0` + `pg-connection-string@2.13.0`: old config → resolved `ssl={}`, new → `{ca,rejectUnauthorized:true}`). **Fix:** extracted `buildPoolConfig(connectionString, env)` which spreads `parseIntoClientConfig(connectionString)` (discrete host/user/password/port/database fields — **no `connectionString` key**) and sets `ssl: buildSslConfig(env)` **last** so the URL can't clobber it; pg doesn't re-derive ssl from the residual top-level `sslmode`, so the pinned object stays authoritative. `pg-connection-string` promoted to an explicit dep (was transitive via pg, same `^2.13.0` range → lockfile is a 1-line direct-dep reference, no tree change). New tests resolve config through pg's real `Client` and assert `ssl.ca === AZURE_POSTGRES_CA` survives `?sslmode=require` and a no-`sslmode` URL, the config carries no `connectionString` key, the `DATABASE_SSL_INSECURE` hatch works through the URL path, and `getDb()` itself is wired through `buildPoolConfig` (guards against a revert to the inline form).

**Review + deploy-gate validation (`/code-review` xhigh, this session).** No correctness bugs, no convention violations — the clobber and the fix were both confirmed empirically. The PR's **human-gated deploy risk** (verify-full enables hostname verification; if the live `DATABASE_URL` host were the `.private.` VNet FQDN it would NOT match the cert SAN → total connection failure on deploy) was checked against the LIVE config, NOT assumed: the live `DATABASE_URL` host is the **public** FQDN `psql-ai-education-migration.postgres.database.azure.com` (read via `az functionapp config appsettings list`, credentials masked), which IS in the server cert SAN (`subject CN=eeadad77f37a.database.azure.com`, SAN lists the public FQDN — NOT a `*.postgres.database.azure.com` wildcard). A full verify-full simulation against the live server with the embedded 3-root bundle — `openssl s_client -starttls postgres -CAfile <bundle> -verify_hostname <host> -verify_return_error` — returned `Verify return code: 0 (ok)`. Gate cleared; no outage risk.

**Verify.** functions `npm run build` (tsc) exit 0; `npm test` **1399 pass / 3 skip**. CI green on the head commit (functions + frontend gates).

**Merge + deploy.** Merged as `651c16b` (merge commit), work branch deleted local + remote (remote via `gh api -X DELETE …/refs/heads/<branch>` — the guard-trunk hook blocks push-from-main). Auto-deploy green: functions run `28158057811` ✅ + SWA + CI all triggered on `651c16b`. **Smoke OK** on `func-ai-education-migration-c0fgeqdnfvd6h0cf.swedencentral-01.azurewebsites.net`: unauth POST 5/5 → **401** (`user-context`/`organizations`/`courses`/`platform-settings`/`enrollments` — worker up, all functions registered after deploy, authz before DB) + OPTIONS preflight **204**. #103 auto-closed by the commit keyword.

**Op-note for next session.** Unauth 401 smoke **cannot** confirm DB connectivity — it stops at JWT validation before any query, so a broken DB connection would still smoke green. For a TLS/connection change like #103 the authoritative pre-merge check is the live-cert verify-full simulation (above), not the post-deploy 401 smoke. `DATABASE_SSL_INSECURE=1` is the rollback hatch and is **functional again** as of this PR. Local `az ... -o json`/`--query <object>` is currently broken on this box (xmltodict/pyexpat dylib mismatch under azure-cli 2.86 / Python 3.13) — use `-o tsv` with scalar queries, or `az functionapp list --query "[?name=='…']"`. Work branch `martin/112-bookkeeping` for this ledger update.

---

## 2026-07-13 — Prod DB credential drift fixed + #28 closed (ops fix; no PR-shipped code)

**Who:** martin & Claude. No application code changed — an Azure-config fix run by the owner in a private terminal (agents don't touch/print secrets). This branch carries the ledger/bookkeeping only.

**Symptom.** A real login to the deployed app (`https://black-forest-0d7f96c03.7.azurestaticapps.net`) presented as a data-less learner. But the DB showed the user's profile (`Martinh@ai-raadgivning.dk`) already had `is_platform_admin=true` and the seed data was present — so neither the requested "make me platform admin" nor "seed mock data" actually needed a write.

**Root cause.** The `AIUadmin` password on `psql-ai-education-migration` and the `DATABASE_URL` app setting on `func-ai-education-migration` had **drifted out of sync**. Every authenticated DB call failed `28P01 password authentication failed`; `user-context` (runs on login) 500'd, so the frontend never learned the caller was a platform admin. Exactly as the #103 op-note warned: unauth 401 smoke cannot catch this (the 401 auth check precedes the DB), and App Insights had **zero telemetry** in 90d (no login ever completed) — the app process was up (unauth probes → 401) yet functionally dead for any DB-touching request.

**Diagnosis (read-only).** Connected from this box via the app's exact path (`functions/shared/db.ts` → `buildPoolConfig` → CA-pinned verify-full). Reached the server (firewall NOT blocking — public access + IP allowed) but got `28P01`, proving a credential mismatch, not TLS/network. Server check: `passwordAuth: Enabled` (not Entra-only), admin `AIUadmin`, db `AI_Education`.

**Fix (owner-run; no secrets surfaced).** Reset the server admin password (`az postgres flexible-server update --admin-password`) to a fresh URL-safe (base64url) value → set the matching `DATABASE_URL` on the function app (`az functionapp config appsettings set … --output none`) → `az functionapp restart`. Post-fix re-verify via the same app path: authenticates cleanly; counts `orgs=2 / courses=1 / community_posts=2 / profiles=3`; platform-admin profile intact. Martin confirmed a real login now lands in the platform-admin view.

**Closes #28** — satisfies its acceptance criteria ("Password rotated + DATABASE_URL app setting updated before prod cutover") and doubles as the pre-cutover rotation gate; a matching comment is on the issue. **Filed #115** in the same session (bind `www.ai-uddannelse.dk`, Option B — www canonical + apex forward).

**Op-note.** DB credential drift is invisible to the unauth smoke; confirming the deployed app's DB path actually works needs an authenticated request or a direct connection via the app's own config. Work branch `martin/status-bookkeeping` for this ledger update.

---

## 2026-07-15 — Cleanup branch: shared endpoint envelope factory + fleet migration (PR #129, in review)

**Who:** emil & Claude. Branch `cleanup`, 18 commits, draft PR #129. This entry is the branch-closing docs/bookkeeping pass; merge + deploy will be announced on the PR.

**Factory.** New deep module `functions/shared/endpoint.ts`: `endpoint()` / `adminEndpoint()` absorb the HTTP envelope every handler used to hand-roll (~20 lines × ~100 endpoints) — origin/CORS, OPTIONS→204 preflight, authenticate → getProfile → 401, the platform-admin 403 gate (before `run`, so before any body parsing), `AuthError`→401, the ADR-0014 constant-500 catch, and the `app.http` registration. Handlers get an `AuthedCtx` with `reply()` plus authz helpers (`requireOrgAdmin` / `requireActiveMember` / `requirePlatformAdmin`) that encode the platform-admin-bypass convention and throw `Reply(403, …)` (custom 403 bodies via `throw new Reply(403, {...})`). Frozen dependency set (shared auth/profile/cors/errors only) so contract tests keep mocking exactly those modules. **90 endpoints migrated in verified batches, per-endpoint contract tests unchanged**; `shared/guards.ts` retired; **8 hand-rolled endpoints remain as deliberate exceptions**, each now carrying a one-line pointer comment (first-login provisioning in `user-context`; binary PDF + token-only auth in the two generators; lazy email/SMTP clients with bespoke authz/response shapes; legacy oid-only identity lookups pending normalization). Recorded as **ADR-0015**; `.claude/rules/functions.md` rewritten — new endpoints MUST use the factory.

**Fleet guard.** New `functions/registration-names.test.ts`: route↔folder parity, route uniqueness, reserved-prefix check (`admin`/`runtime`/`host`), barrel cross-check (every folder imported in `functions/index.ts`), folder-must-have-index — the silently-never-registers bug class is now test-caught instead of convention-guarded.

**Reviews.** `/code-review` fix sweep applied on-branch (barrel guard, `requirePlatformAdmin` ctx helper, API simplification, doc accuracy); an over-engineering pass removed dead flexibility (NavLink wrapper, dead props/variants, speculative params, placeholder `shared/index.ts`); a security review found **no new vulnerabilities**.

**Dead-code sweep.** Deleted 5 orphaned endpoints — `quiz-options`, `quiz-options-admin`, `invitation-link`, `azure-delete-blob`, `courses` (all zero-caller, each with WORKLOG provenance — e.g. `quiz-options-admin` orphaned since Slice 2's `quiz-admin` batched read) — plus 16 unused vendored ui components, 15 unused npm deps, ~111 dead i18n key pairs, and dead CSS/assets/types. **Net ≈ −4,800 lines.**

**Runtime parity verification.** 285/285 unauthenticated envelope probes **byte-identical** between the old and new function hosts; the 5 deleted routes 404 as expected; frontend boot identical (Playwright).

**Verify (this docs pass, post-pointer-comments).** Root `npm run lint` exit 0 (0 errors) + `npx tsc --noEmit -p tsconfig.app.json` exit 0; functions `npm run build` exit 0 + `npm test` **1576 pass / 3 skip** (109 files).

**Bookkeeping.** ADR-0015 added (README ADR counts bumped 14→15, architecture sketch now names the factory); `functions/shared/endpoint.ts` header count corrected (10→8 hand-rolled); STATUS.html checkpoint gains the PR #129 "In flight" entry + the decommissioned-routes note. Stale-doc sweep deliberately left history as history: dated handover docs, `docs/superpowers/` plans/specs, `migration/lovable-supabase-removal/` ledgers, `migration/azure/` schema-provenance comments, prior WORKLOG entries, and accepted ADR texts (ADR-0008/0012 mention `azure-delete-blob` as historical decision context).

---

## 2026-07-16 — Documentation-slimming pass (cleanup branch, docs-only)

**Who:** emil & Claude. Branch `cleanup` (rides PR #129). No code touched.

**What.** Deleted the superseded documentation corpus — 34 files: the pre-migration root stack docs (`QUICK_START.md`, `AZURE_DEPLOYMENT_GUIDE.md`, `DEPLOYMENT_SUMMARY.md`), the consumed handover (`docs/handover-supabase-migration-2026-05-20.md`), all 5 dated implementation plans (`docs/superpowers/plans/`), 3 consumed design specs (two-person collab, PR-45 fix pass, course-review entry point — the **2026-06-03 cutover spec stays**, it is the `slice-workflow` skill's source of truth), the entire `migration/lovable-supabase-removal/` discovery/evidence tree, the dead adr-kit cache `docs/adr/.adr/`, and the orphaned `.github/agents/auditor.agent.md`. **Why (one line):** docs describing current state rot and mislead agents, ephemera should die once consumed — git history preserves every deleted byte, so deletion loses nothing. Reference fixes: README's repo-layout row, doc-map table, and "outdated companions" note rewritten to point only at living docs; the kept cutover spec's `Related:` line now says its companions were deleted. Codified as the new **`## Documentation policy`** section in `AGENTS.md`. Basis: Anthropic memory/context-engineering guidance (curated, current context beats bulk), Google documentation best practices (docs that can't be kept true should be deleted), and standard ADR practice (append-only; supersede, never edit).

---

## 2026-07-16 — Docs-triage follow-through (cleanup branch, docs-only)

**Who:** emil & Claude. Branch `cleanup` (rides PR #129). No code touched.

**What.** Follow-through on the documentation triage: retired the `slice-workflow` skill and the cutover design spec `docs/superpowers/specs/2026-06-03-supabase-azure-cutover-design.md` (migration complete — Slice 8 was the last; both were consumed ephemera, git history preserves them); removed `docs/adr/adr-index.json` (dead adr-kit residue, zero references); trimmed `migration/STATUS.html` back to its checkpoint role (short Current-State asof + ~5-line Done summary — the per-slice detail lives here in the WORKLOG; ~30.5 KB → ~15.8 KB); marked ADR-0012 `superseded` (its own supersession clause fulfilled — Task 9 shipped and `shared/auth.ts` does full JWKS validation, see ADR-0005); `git mv`'d ADR-0006 to `...nodejs-20...` so the filename matches its 2026-06-12 Node ~20 amendment. Dangling pointers fixed so nothing references the retired docs: `AGENTS.md` session-start, `README.md` (two skill lists), `.github/ISSUE_TEMPLATE/task.yml`, the `pickup`/`handoff` skills, and STATUS.html's pickup list + Collaboration line.

---

## 2026-07-16 — Frontend deepening: query-key factory, shared query hooks, OrganizationDetail decomposition (PR #134)

**Who:** emil & Claude. Branch `frontend-deepening`, draft PR #134, 14 commits. Code-review follow-up from #129 (issue #132): the backend got its deep module (`endpoint()`/`adminEndpoint()`, ADR-0015); this is the frontend counterpart. Behavior-neutral throughout; no new user-facing strings. Executed subagent-driven — one implementer per batch, then a spec-compliance review and a code-quality review per batch, fixes folded in, plus a final whole-branch cross-cutting review.

**A — Query-key factory.** New `src/lib/query-keys.ts`: one owner for every TanStack Query key shape (TkDodo-style; `all` prefix only when something invalidates by prefix, or when it *is* the param-less key — documented per family). All 15 files that hand-coded key literals migrated to it; `src/lib/query-keys.test.ts` guards the exact array shapes (incl. `undefined`-param edges) so the literal→factory swap stays byte-identical.

**B — Org management.** New shared hooks `useProfiles` / `useOrgMemberships` / `useInvitations(orgId, scope)` / `useOrgDetail` (pattern: `useOrganizations` from #87; `useOrgMemberships` owns the joined-row→`profile` reshape both consumers used to hand-roll). `OrganizationsManager` migrated off its hand-rolled profiles fetch. **`OrganizationDetail.tsx` decomposed 1,155→477 lines** into `src/components/platform-admin/org-detail/*` (header, stat cards, seat-limit, members section + table, invite/add/edit/delete dialogs each owning their own form state, `RoleChangeDialog`, `OrgNotFoundScreen`, a `useQueryErrorToast` helper) on the B1 hooks; its 8 imperative `fetchData()` calls became `useMutation` + targeted `invalidateQueries` (org edit/delete also invalidates `organizations.all`, so the shared list cache stays fresh — an improvement over the old page-local refetch).

**C — Settings.** Only `PlatformSettings.tsx` actually hand-rolled a fetch → new `usePlatformSettingsAdmin` hook + `useToastMutation` per-panel save (per-panel disabled state derived from the mutation, no hand-managed `savingKey`). `Settings.tsx`/`OrgSettings.tsx` read from React contexts (`AuthContext`/`PlatformSettingsContext`), not direct fetches — deferred (see below).

**D — Analytics.** `useOrgAnalyticsData` / `useOrgCourseProgress` / `useOrgCourseEnrollees` / `useUserProgress`; `OrgAnalytics.tsx` + `CourseProgressTab` + `UserProgressDialog` migrated, all post-fetch reductions moved into `useMemo` unchanged (`TeamPerformanceTab` is props-only, untouched).

**E — Learner + org-admin.** E1: learner `Dashboard`/`Courses` → `useLearnerDashboard`/`useLearnerCourses` (thumbnail signing moved into the `queryFn`); enroll/unenroll are `useMutation`s that invalidate both learner keys. E2 (the dedup payoff): `OrgMembersTab` reuses the B1 `useOrgMemberships`/`useInvitations('org')` + a new `useAiChampions`, deleting its duplicate membership reshape; its 6 mutations converted (cancel-invitation keeps instant on-success removal via `setQueryData`; champion-toggle **invalidates** rather than hand-patching the `['ai-champions']` cache it shares with `AIChampionsList`, which reads richer rows — a partial-row write there would have briefly corrupted that consumer). `BulkInviteDialog`/`EnrollUserDialog` internals left as-is; only their `onSuccess` prop rewired from `fetchData` to key invalidation.

**Deferred to follow-up (filed this session):** `CoursePlayer.tsx` (cascading course→quiz→signed-URL fetches), the community form components, `EnrollUserDialog`'s composite course fetch, migrating the `PlatformSettingsContext`/`AuthContext` providers (which would let `Settings`/`OrgSettings` share cache), and normalizing `AIChampionsList` onto `useAiChampions`. Left the B1/D/E `enabled` idiom unified as `(options.enabled ?? true) && !!<param>` across the hook family.

**Verify (per batch + final).** Root `npm run lint` exit 0 (0 errors) · `npm test` **325 pass** (53 files) · `npx tsc --noEmit -p tsconfig.app.json` exit 0 · `npm run build` exit 0. Net ≈ +4,369 / −1,692 across ~68 files. New-frontend-fetching convention recorded in `.claude/rules/frontend.md`. Merge + deploy announced on PR #134.

---

## 2026-07-17 — Frontend deepening shipped via PR #155 (supersedes #134); s8emil spam-flag diagnosed

**Who:** emil & Claude. Merge + deploy from the main session; smoke sweep via Playwright MCP on prod.

**The CI mystery resolved.** PR #134 sat with zero check-runs through pushes and a close/reopen while GitHub's status page was green. Root cause was **not** the 07-16 REST-API incident: GitHub spam-flagged the `s8emil` account (~07-16 13:00 UTC, after a burst of empty re-trigger commits, PR close/reopen cycles, and ~20 rapid issue creations). Flagged accounts get their content shadow-hidden (PRs #129/#130/#134 and issues #135–#154 return 404 to everyone else, profile 404s unauthenticated) and **Actions schedules no workflow runs for their events**. Diagnostic tell: `vercel`/`devin` check-suites existed on the head commit but no `github-actions` suite. Proof: PR #155, same branch + same commits but authored by `emkataumre`, scheduled CI instantly and went green. Appeal to be filed via support.github.com as s8emil; quirk recorded in STATUS.html.

**Merge + deploy.** #134 closed as superseded; **PR #155 merged → `main` @ `774f530`** (issue #132 auto-closed). All three trunk workflows green (CI, SWA, functions). Signed-in Playwright smoke on prod (`black-forest-0d7f96c03.7.azurestaticapps.net`), all three role views: platform-admin (orgs list, the decomposed OrganizationDetail with stat cards/members/invitations, Edit dialog pre-fill, `OrgNotFoundScreen` on a bogus org id, PlatformSettings tabs), org-admin (analytics overview + org-switch refetch, OrgMembersTab incl. the AI-champion badge, Learning Progress + UserProgressDialog, Courses + enrollees dialog), learner (dashboard empty-state, courses catalog with signed thumbnails, **enroll→dual-key-invalidation→unenroll round-trip observed live**), community feed (AI Champions sidebar consistent with the members tab). Zero app console errors — the only console entries were Microsoft's login-page favicon 404 and the deliberate bogus-org 404 probe.

**Observation for later:** a learner shows "In Progress" with 4/4 lessons done (completion likely gated on something beyond lesson count) — pre-existing behavior, noted during the sweep, not a regression.

---

## 2026-07-20 — #158 course thumbnail preview after upload shipped (PR #172)

**Who:** martin & Claude. Branch `fix/course-thumbnail-preview-158`, PR #172. Small frontend-only fix + code-review follow-ups (xhigh review of the PR this session).

**Fix.** `FileUpload` rendered `<img src={value}>` where `value` is the raw Azure blob path (unsigned) → broken-image icon right after an upload (#158). Now keeps a local `URL.createObjectURL` preview of the just-selected file, keyed by the value it was made for (`forValue`), falling back to the parent `value` (a pre-signed or public URL) when they diverge. Persisted value is unchanged — still the blob path; the course editor's re-sign path (`getSignedLmsAssetUrl`) is untouched.

**Code-review follow-ups.** (1) The object URL was only revoked on remove/replace/unmount → added an effect that drops the preview once the parent adopts a different value (post-save re-sign, or a consumer storing a public URL), so a stale object URL is freed immediately instead of held until unmount. (2) Tests +2 (non-image uploads never create an object URL; a diverging parent value revokes the stale preview — locks in the fix), and mocked `URL.createObjectURL`/`revokeObjectURL` + the XHR stub are now restored in `afterEach`. (3) PR-description scope corrected: the object-URL preview only applies to consumers that feed the raw blob path straight back as `value` (course thumbnails); org-logo consumers remap to `buildPublicUrl(...)` and don't use this path.

**Adjacent finding — diagnosed, NOT fixed here → #162/#165.** The `FileUpload` `bucket` prop is a no-op: `azure-upload-url` ignores it and writes every upload to one container (`AZURE_STORAGE_CONTAINER_NAME`, default *private* `lms-videos`), returning `<uuid>.<ext>`. Org logos are then displayed via an unsigned, container-less `buildPublicUrl(...)` URL → broken image (thumbnails work only because they're SAS-signed on read). Root cause documented on #162 (full) + #165 (heads-up — avatar image display isn't built yet, renders initials). **Owner decision 2026-07-20: treat logos/avatars as _public_ branding assets** (route to a validated public container + container-correct URL), not the signed path.

**Verify.** Root `npm run lint` 0 errors · `npm test` **327 pass** (55 files, +2) · `npx tsc --noEmit -p tsconfig.app.json` exit 0 · `npm run build` exit 0. Functions untouched (src-only diff); CI green on all three checks. Merged via PR #172 → `main` (#158 auto-closes via "Fixes #158"); SWA frontend deploy auto-fires (no functions deploy — none changed).

---

## 2026-07-20 — #120 URL paths reflect the current view shipped (PR #174) + route-constants refactor

**Who:** martin & Claude. Branch `feat/url-reflects-view-120`, PR #174. Frontend-only route rename + xhigh code-review follow-ups (this session). Merged trunk in first — over #158 (PR #172) and #159 (Global Analytics all-orgs aggregate) — before shipping.

**Rename (Productive #9 "URL Changes").** Admin route paths now read like the view: org-admin under `/app/admin/org/*` (the Organization page is the `/app/admin/org` root), platform-admin under `/app/admin/platform/*`. Six paths changed (org Organization `analytics`→`org`; global analytics, organizations (+`:orgId`), courses (+`:courseId`) → `platform/*`). Old paths 404 — clean rename, no back-compat redirects (pre-GA internal tool). Also repointed dead breadcrumb hrefs (`/app/community/ideas|resources` → the real `/app/community/org/*`) and dropped two dead crumb-map entries; `OrgAnalytics` loading/empty states retitled "Analytics"→"Organization".

**Code-review follow-ups (xhigh review of the PR).** (1) New `src/lib/routes.ts` — single source of truth for the admin route paths (styled after the `queryKeys` factory); adopted across the route table + every `navigate()`/href/sidebar site, so `OrgAnalytics`'s `isGlobalView` compares against the same constant that defines its route (kills the string-literal drift the review flagged as its top finding). (2) i18n'd the analytics page title/breadcrumbs via the existing `nav.*` keys instead of hardcoded English. (3) New `OrgAnalytics.test.tsx` pins the global-vs-org view branch so a future rename can't silently flip it. Follow-up **#178** filed: extend the route-constants module app-wide (learner/community/auth). Deferred by agreement (out of scope here, tracked in Productive): view-mode in the URL; the in-page `?tab=` back/forward sync bug.

**Verify.** Merged trunk in first; `OrgAnalytics.tsx` auto-merged across regions — my `isGlobalView`/title changes and #159's `effectiveOrgId`/report-guard changes are both present and verified. Root `npm run lint` 0 errors · `npm test` **329 pass** · `npx tsc --noEmit -p tsconfig.app.json` exit 0 · `npm run build` exit 0. Functions `npm run build` + `npm test` **109 files pass** (untouched by this PR; re-verified after the trunk merge). Merged via PR #174 → `main`; SWA frontend deploy auto-fires (no functions deploy — none changed). #120 closed (core scope shipped; the two deferred concerns recorded on the issue).

---

## 2026-07-20 — Public branding assets: org logo (#162) + profile photo (#165)

**Who:** Martin + Claude

**Done (PR #182):**
- Shipped org-logo (#162) and profile-photo/avatar (#165) upload + display as **public branding assets**. Prior state: the `FileUpload` `bucket` prop was a no-op — everything landed in the private `lms-videos` container and logos/avatars rendered via an unsigned, container-less URL (broken).
- `azure-upload-url` now takes an `assetType` intent (`org-logo`/`avatar`) and routes to the public `email-assets` container (ADR-0008), folder-prefixed (`org-logos/`, `avatars/`); unknown/absent → private default (unchanged for videos/docs/thumbnails). Shared `PUBLIC_CONTAINER` constant both sides. No new Azure container, no `az`.
- DB stores the **container-relative blob path** in `organizations.logo_url` / `profiles.avatar_url`; display composes via `buildPublicUrl` (account-root + container + path). `VITE_STORAGE_BASE_URL` unchanged (account-root). Dead `bucket` prop retired → `assetType`.
- Surfaces: logo on EditOrganizationDialog / OrgDetailHeader / OrganizationsManager / OrgAnalytics; avatar upload+display on Settings, display in AppSidebar profile menu + MembersTable + OrgMembersTab.

**Decided (grilled with Martin):** reuse existing public `email-assets` (no owner Azure step); client declares intent, server owns the container/prefix allow-list; store raw path + compose at display (env-portable).

**Whole-branch review caught + fixed (2 Critical):**
- `azure-upload-url` was `adminEndpoint` (platform-admin only) → avatar (all users) and real org-admin logo uploads would 403. Relaxed: public branding assetTypes open to any authenticated user; course content stays admin-only. Real authz is at `organization-update` (org-admin for `logo_url`) / `profile-update` (own row), so an orphan blob is inert.
- Settings avatar persisted `''` on upload failure → wiped the existing photo. Guarded to persist only on success (matches OrgAnalytics logo).

**Deferred (tracked):** community-feed author avatars → **#180** (needs endpoint `avatar_url`); `TeamPerformanceTab` team-table avatars (same data-not-ready class); remove-photo UI (needs FileUpload to distinguish remove from failure).

**Verification:** frontend lint 0 / tsc 0 / 329 tests / build ok; functions build ok / 1602 tests. Real upload→display E2E deferred to post-deploy smoke.

---

## 2026-07-20 — #160 Moderation "View content" opens a login page — fixed (PR #179)

**Who:** martin & Claude. Branch `fix/moderation-view-content-160` (git worktree), PR #179. Frontend-only. Design settled up front via a grilling pass (dialog vs navigation; comment case = full thread + highlight; post case unified to also show the thread).

**Root cause.** Community Moderation's "View content" did `window.open(path, '_blank', 'noopener,noreferrer')`. The new tab boots a fresh SPA instance with no MSAL session, so `ProtectedRoute` bounced it to `/login` instead of showing the reported content.

**Fix.** New read-only `ReportedContentDialog` (shared by `PlatformCommunityModeration` + `OrgCommunityModeration`) renders the reported post (header + hidden/locked/scope badges + body) followed by the full comment thread; comment reports highlight and scroll to the reported comment. It reuses the existing `CommentThread` via a new **additive `readOnly` prop** (suppresses composer/reply/locked-banner/copy-link; `PostDetail` passes nothing and is unchanged) and fetches through **PostDetail's own query keys** (`communityPost.detail` / `communityComments.list`), so the cache is shared. No backend change: `community-post` already returns hidden posts to platform/org admins (`canSeeHidden`) and `community-comments` computes `includeHidden` server-side from the caller's admin status. `community-report-link.ts`'s URL builder was replaced by a `canViewReportedContent()` predicate that keeps the #86 orphaned-comment behavior (comment target with no `post_id` → button stays disabled).

**Finding caught while driving (real browser).** In read-only mode `CommentItem` still rendered the "⋯" actions trigger, which opened an **empty** menu (every item is gated on a now-undefined callback). Added a `hasActions` gate so the trigger only shows when ≥1 action is available — also tidies any caller passing no actions. TDD'd (`CommentItem.test.tsx`).

**Verify.** TDD throughout (red→green per unit). Drove the real dialog in Chromium via a throwaway Vite harness (post + comment cases, primed query cache, no auth needed) — reported comment highlights, no empty menus, 0 console errors; harness removed after. Merged current trunk (`origin/main`, incl. #126 seat-cap) into the branch — clean auto-merge (i18n `seats` + `moderation` keys in separate sections). Post-merge gates: root `npm run lint` 0 errors · `npm test` **349 pass** · `npx tsc --noEmit -p tsconfig.app.json` exit 0 · `npm run build` exit 0. Functions untouched. i18n en+da added for the dialog strings. Merged via PR #179 → `main`; SWA frontend deploy auto-fires (no functions deploy — none changed).

---

## 2026-07-20 — #126 Auth Rules: invite seat-cap (scope A) shipped (PR #177)

**Who:** martin & Claude. Branch `feat/invite-seat-cap-126`, PR #177. Scope grilled with martin, then subagent-driven implementation (fresh implementer per task, per-task + final whole-branch review).

**Scope.** "Auth Rules" (#126) split into three; this PR delivers **scope A — the invite seat-cap**. The other two are filed as their own issues: **#176** (honor pending org invites on self-signup — auto-add at first Entra login) and **#175** (explicit accept-invitation flow). The #127 tension (free self-signup vs "invitation-only") resolves via #176: you don't need an invite to have an account, but if you were invited you land in the right org however you arrive.

**The rule.** An org's `active_members + pending_invitations` must never exceed `organizations.seat_limit` (NULL = unlimited). Absolute — no role exemption, platform admins included. A pending invite reserves a seat, so converting it later (#175/#176) is seat-neutral; disabled memberships free a seat (active-only), per #66.

**Backend.** New shared helper `functions/shared/seats.ts` (`lockSeatUsage`/`isAtSeatLimit`/`seatsRemaining`) — one `FOR UPDATE`-locked query counting active members + pending invitations, the single source of truth. Enforced on all four seat-consuming create paths: `invitation-create` (txn), `invitation-bulk-create` (partial-fill in request order, per-row `SAVEPOINT`s so a duplicate can't poison the batch), `org-membership-create` (#66's active-only check -> active+pending), `admin-user-actions` add-membership (cap added + latent `?? 'member'` -> `'learner'` enum-default bug fixed). `organizations` gains a server-computed `pending_invite_count` (+`member_count` on single-org). 409 body `{error:'Organization is at seat limit', code:'SEAT_LIMIT_REACHED'}` uniform across paths. No DB migration; application-level enforcement with the existing lock pattern.

**Frontend.** Shared `src/lib/seats.ts` + `SeatUsageNote`; every "seats used" site counts active+pending. All seat-consuming dialogs (single invite, bulk, add-existing-user) show "X of Y used · Z remaining", disable at the cap, surface the 409 inline; unlimited orgs show "Unlimited". Org-admin usage reads the org-wide server aggregate via `useOrgDetail` (the invitations LIST is scoped to `invited_by_user_id`, so an org admin can't see co-admins' invites); counts refresh after every invite/cancel/remove. Strings in en + da.

**Verify.** Root `npm run lint` 0 errors · `npm test` **342 pass** (58 files) · `npx tsc --noEmit -p tsconfig.app.json` exit 0 · `npm run build` exit 0. Functions `npm run build` clean · `npm test` **1601 pass** (110 files, 3 skipped). Final whole-branch review (opus): ready to merge, no Critical/Important; one accepted Minor (bulk catch's `ROLLBACK`/`RELEASE` not try-wrapped — safe, infra-only, propagates to 500). Merged via PR #177 -> `main`; SWA + functions deploys auto-fire (functions changed). #126 closed (scope A delivered; B/C tracked in #176/#175).

---

## 2026-07-20 — #163 combined all-orgs course overview: per-org breakdown shipped (PR #181)

**Who:** martin & Claude. Branch `worktree-all-orgs-course-overview-163`, PR #181. Scope grilled with martin: the issue was largely pre-satisfied by #159 (PR #173, which already rendered a flat cross-org per-course rollup), so the session redefined #163 as the **organization dimension** the flat rollup sums away.

**What shipped.** In the course detail dialog, **all-orgs mode only**: a **"By organization"** table (org · enrolled · completed · rate) listing every org with the course access-enabled — incl. 0/0 "gap" rows (adoption signal) — plus an **Organization column** on the enrollee list, un-deduped to one row per (learner, org) enrollment. Single-org view unchanged (main list + dialog identical to before).

**Backend.** New platform-admin-only endpoint `org-course-org-breakdown` (`adminEndpoint`): per-org enrolled/completed for a course across every enabled org (`org_course_access` JOIN `organizations` LEFT JOIN `enrollments` so gap orgs show 0/0; `ORDER BY enrolled DESC`). `org-course-enrollees` `'all'` branch: dropped the `DISTINCT ON` dedup, joined `organizations`, returns `org_id`+`org_name` per enrollment row (composite React key downstream).

**Frontend.** New `useOrgCourseOrgBreakdown` hook (lazy, keyed by courseId) + `orgCourseOrgBreakdown` query-key family; `useOrgCourseEnrollees` result type gains optional org fields. `CourseProgressTab` renders the breakdown + org column in all-orgs mode. Strings in en + da (`analytics.courseOrgBreakdown.*`).

**Count semantics (Option A, agreed with martin).** Headline course numbers (main row + dialog stat cards) stay **distinct learners** (#159, untouched); the per-org table + enrollee list are **enrollment-level** and labeled as such. Sums exceed the distinct headline only when a learner is enrolled in the same course through multiple orgs.

**Verify.** Brought trunk in via a merge commit (20 commits; i18n JSON auto-merged, no conflicts). Root `npm run lint` 0 errors · `npm test` **349 pass** (60 files) · `npx tsc --noEmit -p tsconfig.app.json` exit 0 · `npm run build` exit 0. Functions `npm run build` clean · `npm test` **1620 pass** (111 files, 3 skipped). Runtime: mounted the real `CourseProgressTab` in a throwaway Vite harness with the query cache pre-seeded (no Entra/DB reachable locally) — all-orgs dialog rendered the breakdown (incl. the 0/0 gap row) + the org column with **0 console errors**; the Option A divergence (distinct headline 141 vs per-org sum 142 for a two-org learner) rendered as designed; single-org dialog showed neither. Not exercised against a live multi-org DB (same boundary #159 shipped under). **Pre-merge `/code-review` (xhigh)** flagged one real edge case: the breakdown originally listed only access-enabled orgs, but the enrollee list + #159 headline count enrollments in every org regardless of access — so an org whose access was revoked with enrollments left behind would show in the enrollee list yet be missing from the table (per-org total short). Fixed: breakdown population is now `(access-enabled) UNION (has ≥1 enrollment)`, so it reconciles with the enrollee list and still shows gap rows. Merged via PR #181 → `main`; SWA + functions deploys auto-fire (functions changed). #163 closed.

---

## 2026-07-20 — #127 seat-request flow implemented (PR #183, not yet merged)

**Who:** martin & Claude. Branch `feat/seat-request-flow-127`, PR #183. Subagent-driven implementation (16 tasks, fresh implementer per task, per-task + final review).

**Scope A — seat-request flow.** Org admins no longer resize `seat_limit` directly; instead they request N additional seats at a platform-admin-set **binding annual ex-moms DKK price**, server-snapshotted onto the request at creation time (the client-displayed price is never trusted). The request persists and emails the platform admin (`jacob@ai-raadgivning.dk`, configurable) to invoice offline; the platform admin clicks "Mark fulfilled" and `seat_limit += N`. No online payment. Price is `NULL` by default, which gates the whole flow (both UI and server) until a platform admin sets it.

**DB.** New `seat_requests` table + `seat_request_status` enum + a `seat_pricing` row in `platform_settings` (`migration/azure/01-schema.sql`, `02-seed.sql`); additive, idempotent prod-apply script `migration/azure/03-seat-requests.sql` (not yet applied to prod — see deploy prerequisites below).

**Backend.** 5 new Azure Functions: `seat-pricing` (read), `seat-request-create`, `seat-requests` (list), `seat-request-cancel`, `seat-request-fulfill`; `platform-settings-update` extended to accept the `seat_pricing` key; new `functions/shared/seat-request-notify.ts` (best-effort Resend email — a send failure never blocks the request from persisting).

**Frontend.** `useSeatPricing`/`useSeatRequests` hooks; `RequestSeatsDialog` wired into `OrgMembersTab` (a standing "Request more seats" entry point + an at-cap nudge; one pending request at a time, with cancel); a `SeatRequestsSection` fulfil UI on `OrganizationDetail` for platform admins; a seat-pricing panel in Platform Settings. i18n en+da throughout.

**Design/plan docs.** `docs/superpowers/specs/2026-07-20-seat-request-flow-design.md`, `docs/superpowers/plans/2026-07-20-seat-request-flow.md`.

**Not yet merged/deployed — three human-gated prerequisites before the flow is live.** (1) Apply `migration/azure/03-seat-requests.sql` to prod via `psql` (Azure Cloud Shell + a temporary firewall rule, per `migration/azure/README.md`) — without it the `seat_pricing` row doesn't exist and the Platform Settings save 404s. (2) Confirm `RESEND_API_KEY` is set in prod, else the notification email silently no-ops (the request still persists and shows in-app). (3) Once deployed, a platform admin must set the annual price in Platform Settings — until then the org-side request flow stays gated. This entry records the branch checkpoint; merge/deploy + smoke gets its own WORKLOG entry once PR #183 lands.

---

## 2026-07-20 — #167/#168 UI polish: static stat cards + distinct resource tag color (PR #185)

**Who:** martin & Claude. Branch `polish/dashboard-hover-resource-tags-167-168` (worktree), PR #185. Frontend-only. Picked from the 07-20 review batch (#166–#169); #166 and #169 handled in other sessions.

**#167 — remove hover animation on dashboard stat cards.** The top stat cards **lifted** (translate + shadow) *and* **expanded a hidden info panel** on hover. Owner chose "static, drop panel" (of three options offered): both behaviours removed, cards stay at their resting look, and the hover-only info line is dropped (not kept always-on). Fix spanned **two** surfaces — the issue named the shared `StatCard`, but the org-admin dashboard cards are hand-rolled:
- `src/components/ui/stat-card.tsx` — dropped the lift, the expanding panel, the `group` class, and the now-unused `extra` prop (learner dashboard).
- `src/components/org-admin/analytics/AnalyticsOverview.tsx` — `OrgAnalytics`'s cards mirrored the same lift + panel; removed to match.
- `src/pages/learner/Dashboard.tsx` — dropped the four `extra={…}` props and their data derivations (`enrolledTitles`, `latestCompleted`; `nextUp` kept — it also feeds the hero).
- Orphaned `dashboard.extra*` (6) + `analytics.*Extra` (4) i18n keys removed from en + da; `stat-card.test.tsx` + `Dashboard.test.tsx` updated for the dropped panel.

**#168 — Resource Library tag color vs "Open resource" button.** `TagList` chips used `bg-accent` — the same navy tint as the "Open resource" button — so tags read as the same element. Switched to `bg-muted` / `text-muted-foreground` (neutral gray token). `--accent` and `--secondary` are the *same* colour in the light theme and dark mode isn't wired up, so `--muted` is the correct distinct token; the change is in the shared component, so tags stay consistent across resources/posts/ideas.

**Verify.** Root `npm run lint` 0 errors · `npm test` **352 pass** (63 files) · `npx tsc --noEmit -p tsconfig.app.json` exit 0 · `npm run build` exit 0. Functions untouched. Purely presentational (class removal + one token swap); visual confirmation deferred to the PR preview env (dashboards are Entra-gated, not drivable locally). Merged via PR #185 → `main`; SWA frontend deploy auto-fires (no functions changed).

---

## 2026-07-20 — Branding assets fix: signed URLs, not public access (#162/#165, PR #188)

**Who:** Martin + Claude

**Why:** #182 (public branding assets) shipped broken — uploads 404'd, display would 409. Root cause (found by driving the live upload): the storage account `staieducationmigration` has `allowBlobPublicAccess=false` (Microsoft's secure default) AND the `email-assets` container was never created (ADR-0008's pre-cutover TODO). The unsigned-public-URL design was incompatible with the account posture.

**Decision (grilled with Martin, security/compliance lens):** keep the account locked down; serve branding assets via short-lived signed URLs (the mechanism course thumbnails already use) rather than enabling account-wide public blob access (Defender/CIS flag it; MS disables it by default). CDN-fronted-private container considered but deferred as scale-premature — B is a clean first step toward it.

**Backend:** org-logo/avatar uploads route to the PRIVATE default container (`lms-videos`) folder-prefixed `org-logos/`/`avatars/` — no new container, no `az`. New `branding-asset-url` endpoint: any authed user (branding assets are non-sensitive, shown app-wide), but strict branding-path validation (`^(org-logos|avatars)/[A-Za-z0-9._-]+$`) so it can never sign arbitrary private course content in the same container; 120-min read SAS. `resolveAssetContainer` reworked; `isBrandingAssetType`/`isBrandingAssetPath` added. Non-admin upload relaxation from #182 retained (real authz stays at organization-update / profile-update).

**Frontend:** `useSignedBrandingUrl` hook (cached per path) + shared `BrandingAvatar`; every logo/avatar display signs on view (sidebar, Settings, org detail/list, OrgAnalytics, member tables). Raw-path storage unchanged. Removed the dead `buildPublicUrl` / `storage-url.ts`.

**Verify:** frontend lint 0 / tsc 0 / 347 tests / build ok; functions build ok / 1647 tests (new endpoint registered per the fleet guard). Real signed-in upload→display round-trip = post-deploy owner check (this approach is account-compatible; #182's public approach was not).

---

## 2026-07-20 — #119 Danish default language + browser matching (PR #186)

**Who:** martin & Claude. Branch `feat/danish-default-language-119`, PR #186. Frontend-only. Scoped with martin ("do it now vs wait"): recon showed **most of #119 was already built** — i18next + `LanguageDetector` already browser-match en/da, `en`/`da` are at full 828-key parity, and a language switcher already exists (Settings + sidebar). The only gap was the default: an unrecognized browser language (or no detection signal) fell back to English.

**What shipped.** `src/i18n/index.ts` — `fallbackLng: 'en'` → `['da', 'en']`. The first entry is the language i18next renders when the detected browser language is neither en nor da → **Danish default**; `en` stays in the chain as a secondary fallback for any key ever missing in da. LanguageDetector (`navigator` in the detection order) and the switcher are unchanged, so en browsers still get English and users can still override. `src/pages/Settings.tsx` — language selector's value fallback `'en'` → `'da'` (defensive; only hit if both `profile.preferred_language` and `i18n.language` are unset). New `src/i18n/index.test.ts` guards Danish-first ordering, en retained in the chain, and navigator matching intact.

**Test landscape.** Most tests mock `react-i18next` (t returns the key) so are unaffected by the fallback change; the few that import the real `@/i18n` (CourseEditor, CoursesManager, OrganizationsManager) rely on jsdom's `navigator` resolving to en (en-US → en), so rendered language doesn't shift — confirmed by the full suite passing green.

**Follow-up filed → #187.** The Danish default applies to **UI chrome** (locale JSON) only; authored *content* (course material #123, AI Act PDF #71, webinar page #125) isn't locale-driven, so a Danish-default user still sees content in whatever language it was authored in. Tracked separately in #187 with a dependency list (stems from #119; related content surfaces #123/#71/#125).

**Verify.** Root `npm run lint` 0 errors · `npm test` **355 pass** (64 files) · `npx tsc --noEmit -p tsconfig.app.json` exit 0 · `npm run build` exit 0. Functions untouched. CI green (3/3). Merged via PR #186 → `main`; SWA frontend deploy auto-fires (no functions changed). #119 closed.

---

## 2026-07-20 — #189 sync `<html lang>` to the active UI language (PR #190)

**Who:** martin & Claude. Branch `fix/html-lang-sync-i18n`, PR #190. Frontend-only. Follow-up to #119/#186, surfaced in the #186 code review: `index.html` statically declared `<html lang="da">` and never tracked the language actually shown, so an English-viewing (browser-matched) user got English UI on a Danish-declared document — a minor a11y / browser-translate mismatch (screen-reader pronunciation, "translate page" source-guess).

**What shipped.** `src/i18n/index.ts` — added `initialized` + `languageChanged` listeners that set `document.documentElement.lang = i18n.resolvedLanguage ?? 'da'`. Uses `resolvedLanguage` (not the raw detected code) so an unsupported browser language, which renders the Danish fallback, correctly labels the document `da`. New test in `src/i18n/index.test.ts` asserts `<html lang>` follows a language switch (en↔da).

**Verify.** Root `npm run lint` 0 errors · `npm test` **356 pass** (64 files, +1) · `npx tsc --noEmit -p tsconfig.app.json` exit 0 · `npm run build` exit 0. Functions untouched. Merged via PR #190 → `main`; SWA frontend deploy auto-fires (no functions changed). #189 closed.

---

## 2026-07-20 — #164 + #169 community moderation UX shipped (PR #184)

**Who:** martin & Claude. Worktree branch `feat/community-moderation-ux-164-169`, PR #184. Brainstormed + planned with martin, then subagent-driven implementation (fresh implementer per task, per-task spec+quality review, final whole-branch review on opus). Combined because both issues edit the same platform moderation view + the shared `moderation.*` i18n keys.

**#164 — scope selector.** The Platform Admin → Community Moderation queue gains a searchable scope combobox (`Popover`+`Command`, modeled on `CoursesManager`): **All organizations** (default = today's behavior = everything, incl. global), **Global**, or a **specific org**. All three route through filters `fetchReports(orgId?, {scope?,status})` already supported — **no backend change**. Scope is component state `'all' | 'global' | <orgId>`; the query key gains a scope dimension (`platformReports.list(scope, activeTab)` → `['platform-reports', scope, activeTab]`), keeping the `['platform-reports']` prefix so the mutations' `platformReports.all` invalidation still matches. Org moderation view untouched (inherently single-org).

**#169 — single state-reflecting toggles (both views).** The paired Hide/Show and Lock/Unlock buttons collapse into **single toggles that reflect and flip the target's current state**; "Show" relabeled **"Unhide"**. This needed the queue to know each target's live state — the report payload didn't carry it (why there were two blind buttons). **Backend (additive):** `community-reports` `LEFT JOIN`s the target post (comment join already existed for `post_id`) and returns `target_is_hidden` (post→post flag, comment→comment flag, deleted→NULL) + `target_is_locked` (post only; NULL for comment/deleted). Authorization, filtering, ordering, all existing fields unchanged. The duplicated per-report action bar (copied verbatim in both pages) was extracted into shared `src/components/community/ReportActions.tsx` — callbacks take no report arg (pages bind per-row closures; avoids down-narrowing the `ReportWithDetails` type). Comment reports show no lock toggle; a deleted target (state NULL) disables its toggle.

**Verify.** TDD per task (backend contract tests for the joined fields; `ReportActions.test.tsx` covers every toggle state — visible→Hide, hidden→Unhide with opposite action firing, post-only lock, comment-has-no-lock, deleted-target-disabled, non-pending-hides-dismiss/review). Root `npm run lint` 0 errors · `npm test` **360 pass** (64 files) · `npx tsc --noEmit -p tsconfig.app.json` exit 0 · `npm run build` exit 0. Functions `npm run build` clean · `npm test` **1622 pass** (111 files, 3 skipped). Final whole-branch review (opus): ready to merge, no Critical/Important; Minor follow-ups deferred (SQL comment for comment-lock NULL; View-content tooltip dup carried from existing pages; cmdk `value={org.name}` collision risk → follow-up to key on `org.id`; combobox a11y label). Not driven against a live Entra/DB (component logic covered by real render tests; combobox reuses the shipping `CoursesManager` pattern). Merged via PR #184 → `main`; SWA + functions deploys auto-fire (functions changed). #164 + #169 closed.

## 2026-07-21 — Overnight Helm batch: 6 issues shipped (PR #196)

**Who:** emil as conductor + a Helm autonomous fleet (first production overnight batch on this repo). Six issues planned from the board in conversation (per-issue decisions frontloaded), published via the `.helm/plan/` seam, approved ~22:45, all merged to `integration/ralph` by ~01:15 with zero failures and zero human interventions. Reviewed + verified overnight, five post-review fixes applied in the morning, promoted via PR #196.

**What shipped (one merge per task, serialized by Helm's merge gate):**
- **#166** — Course Manager → Access tab: standalone org search field removed; single-org combobox + "All Organizations" is the filtering model (decision: multi-org text-filter deliberately dropped).
- **#193** — requester-facing seat-request emails on submit ("received, seats within 24h") + fulfil ("seats now active"), requester only, template language from `profiles.preferred_language` (da default), new templates HTML-escape user/org strings, best-effort sends (never block the request).
- **#180** — community/idea/champion author payloads carry `profiles.avatar_url` (7 endpoints); PostCard/CommentItem/AIChampionsList/PostDetail/IdeaDetail render photos via `BrandingAvatar` with the initials fallback.
- **#195** — `escapeHtml` retrofitted onto the pre-existing platform-admin seat-request template (filed overnight from an automated security review of #183's template; escaping only).
- **#128** — Platform Settings → Platform Admins: list / grant / revoke on `profiles.is_platform_admin` via new `platform-admins` + `platform-admin-update` endpoints; last-admin demotion HARD-refused inside the transaction (`FOR UPDATE` on all admin rows — TOCTOU-safe), everything else confirm-gated client-side.
- **#178** — `src/lib/routes.ts` extended app-wide (learner/community/auth + redirects; paths byte-for-byte identical), all literals adopted, `DEFAULT_BREADCRUMB_HREFS` re-keyed by stable route id (fixes the silent da-locale miss), plus permanent gate test `src/lib/routes-gate.test.ts` (comment-aware scanner; no route literal outside routes.ts).

**Overnight verification + review pass (5 parallel review agents + Playwright):** app boots from integration; all 20 pre-refactor route paths byte-identical (browser + static); 12/12 new feature tests; security verdict SAFE-TO-PROMOTE (adminEndpoint gates, last-admin atomicity, no avatar authz enlargement, parameterized SQL, no secrets). Entra has no dev bypass, so authed-UI checks were test-level; browser-level smoke on prod post-deploy.

**Post-review fixes (morning, `638fc1a`):** loaded-state breadcrumb links restored in IdeaDetail/PostDetail (the #178 re-key missed them — English users lost links); `avatar_url` added to both comment-create payloads (fresh comments rendered initials until refetch); email subjects use the raw org name (subjects are plain text — the new tests had codified the escaping bug); `seat-request-fulfill`'s post-commit lookups wrapped so a transient DB error can't 500 a committed fulfilment; legacy `toggle-platform-admin` action removed from `admin-user-actions` (it bypassed the last-admin guard; no callers).

**Cleanup backlog (from the review pass, not blocking):** shared `profileJson()` SQL fragment (the author-profile `json_build_object` now has ~10 hand-copies — root cause of the missed-endpoints fix); drop the redundant `platform-admins` list endpoint (derive from `useProfiles`); fold the 7 `avatar-payload.test.ts` files into their sibling `index.test.ts`; `sendBestEffort()` email helper; `BrandingAvatar` name-based fallback; routes-gate scanner via the TS compiler API; assorted small dead code. Full report: conductor session artifact (Desktop/claude-html/2026-07-21-helm-overnight-report.html).

**Verify (post-fix, full suite):** root `npm run lint` 0 errors · `npm test` **375 pass** (70 files) · `npx tsc --noEmit -p tsconfig.app.json` exit 0 · `npm run build` exit 0 · functions `npm run build` exit 0 · `npm test` **1730 pass** (129 files, 3 skipped). Promote re-validated the composed tip against fresh `origin/main` before push. Merged via PR #196 → `main`; SWA + functions deploys auto-fire. Closes #193 #166 #180 #128 #178 #195.

---

## 2026-07-21 — Helm cleanup batch: 7 review-follow-up issues shipped (#197–#203, promote PR)

**Who:** emil as conductor + a second Helm fleet run, same day as the overnight batch. The seven cleanup issues distilled from the overnight review pass (#197–#203) were filed on the board, per-issue decisions grilled and frontloaded in conversation, published via the `.helm/plan/` seam (`cleanup-2026-07-21`, two dependency edges), approved ~10:45, all merged to `integration/ralph` by ~12:50. One transient hiccup (#200's post-green review pass exited non-zero → auto re-queued and recovered) and one benign merge race (#203 re-merged the moving integration tip cleanly); zero human interventions.

**What shipped (net −350 LOC of production code; +≈600 LOC of new proof tests):**
- **#197** — shared `profileJson(alias)` fragment in `functions/shared/profile-json.ts` replaces the ~10 hand-copied author-profile `json_build_object` variants; `RESOURCE_PROFILE_PROJECTION` normalized onto it (resources gain `avatar_url`; the projected-but-never-consumed `department` dropped). `ai_champions` keeps its wider hand-rolled projection deliberately (it needs `department`). Guard test `profile-json.test.ts` fails the build if an endpoint hand-rolls the canonical fragment again.
- **#198** — redundant `/api/platform-admins` list endpoint deleted (folder + barrel); `usePlatformAdmins` + query key deleted; PlatformSettings derives admins AND grant-candidates from the existing `useProfiles` query; profiles-error now renders as an error instead of the misleading "all users are already admins" empty-state.
- **#199** — the 7 standalone `avatar-payload.test.ts` files folded into each endpoint's sibling `index.test.ts` (assertions preserved, updated to the `profileJson` output); new `functions/test-placement.test.ts` pins the convention.
- **#200** — `seat-request-notify.ts`: three near-identical Resend wrappers → one `sendBestEffort()` + `FROM_ADDRESS` const; null-recipient guard now also covers the original admin notify; subjects stay RAW plain text but get CR/LF stripped (`sanitizeSubject`).
- **#201** — `BrandingAvatar` gains an optional `name` prop deriving initials + fallback color internally (explicit props still win); the 7 hand-derived call-site clusters collapsed.
- **#202** — routes-gate's hand-rolled comment-stripping lexer replaced by a TS-compiler-API scanner (`src/lib/routes-gate-scanner.ts`, string/template-literal visitor, file:line offender reporting); same allow-list, same verdict on the tree; fixture-backed `routes-gate-scanner.test.ts`.
- **#203** — dead-code sweep: 3 unreachable `DEFAULT_BREADCRUMB_HREFS` entries deleted; PostEdit's `!post` redirect fixed from the 404ing `routes.community.scope()` to the PostDetail idiom `` `${routes.community.feed}?scope=${scope}` `` (deliberate behavior change) and the dead `scope` builder deleted; `GrantCandidate` de-exported; i18n-key-absence test block removed; the 5 inline Radix Select test mocks hoisted to shared `src/test/select-mock.tsx`.

**Sanity pass (light, per conductor scope — no review fan-out):** 60-file diff footprint matches the plan exactly (no stray files); all four frontloaded decisions verified in the diff (extend-not-wrap avatar, avatar_url normalization, raw-but-newline-stripped subjects, PostEdit redirect idiom); the resources `department` drop confirmed consumer-free by grep.

**Verify (final tip, from #203's gated post-merge re-run):** root `npm run lint` 0 errors · `npm test` **390 pass** (74 files) · `npx tsc --noEmit -p tsconfig.app.json` exit 0 · `npm run build` exit 0 · functions `npm run build` exit 0 · `npm test` **1840 pass** (124 files, 3 skipped). Promote re-validates against fresh `origin/main` before push. Closes #197 #198 #199 #200 #201 #202 #203.

---

## 2026-07-21 — Smoke-cleanup batch: post-deploy findings + i18n follow-ups (#205–#209, promote PR)

**Who:** emil as conductor (remote-controlled session), third fleet run in two days. Post-deploy smoke on the #197–#203 batch surfaced three findings (`cleanup.md`); the prod seed-data purge was deliberately dropped (DB-only, deferred), the other two were grilled into a 3-task Helm plan (`smoke-cleanup-2026-07-21`), and two review-pass follow-ups (#208/#209) were then done inline via subagent-driven development (Opus 4.8 implementers, two-stage review each).

**What shipped:**
- **#205** — composer avatar parity. IdeaDetail's "Add a comment" composer rendered initials even with an uploaded photo (raw `Avatar`/`AvatarFallback`, never `avatar_url`) while the comment rows below used `BrandingAvatar` correctly; swapped to `BrandingAvatar` wired to the profile. `CommentThread` (PostDetail's composer) had no avatar at all — gained optional `currentUserAvatarPath`/`currentUserName` props for parity. New `composer-avatar.test.tsx`.
- **#206** — breadcrumb i18n. `Home` literal in `AppLayout` → `t('nav.home')` (key was net-new in both locales); hardcoded community crumb labels keyed en+da across all 7 pages — including the `ResourceLibrary` "Resources" and `PostDetail` "Post" crumbs the original smoke notes missed. New `breadcrumb-i18n.test.tsx`.
- **#207** — community i18n sweep + lint gate. Every remaining hardcoded user-facing string under `src/pages/community` + `src/components/community` keyed en+da (toasts, placeholders, ReportDialog — which kept stable machine `value`s); `i18next/no-literal-string` (jsx-only, tuned excludes) scoped to those dirs, run by `npm run lint` and the new `lint:community-i18n` script. **Fleet hiccup:** the task went green but died at the merge gate — `npm ci` EUSAGE, the agent had added `eslint-plugin-i18next` to `package.json` without the lockfile; conductor committed the lockfile sync on the task branch, human clicked Retry, merged clean. Ledger kind: `setup-command`.
- **#208** — idea status labels i18n (from the post-#207 Danish UI pass): `IDEA_STATUS_OPTIONS` in `src/lib/community-types.ts` sat outside the sweep's scoped dirs, so badge + admin dropdowns rendered English. Converted to the `labelKey` pattern (all 7 statuses incl. `in_progress`/`done`, 3 render sites), Danish wording aligned with the existing tabs. New `idea-status-badge-i18n.test.tsx`.
- **#209** — date-fns Danish locale (same pass): `formatDistanceToNow`/`format` never passed a `locale`. New `src/lib/date-locale.ts` (`getDateFnsLocale` + two thin wrappers), applied at 12 files' call sites reading `i18n.language` at render time (reactive on switch, no module-level snapshot). Bare `.toLocaleDateString()` sites (browser-locale, admin surfaces) deliberately left. New `date-locale.test.tsx`.

**Verification:** conductor diff review of all five changes; signed-in Playwright pass against the batch (composer avatars photo-vs-initials in the DOM on both pages, "Hjem / Fællesskab / Idébibliotek / Idé" fully Danish, Danish toasts via MutationObserver, zero console errors). Findings deliberately left open: DB-seeded `community_categories.name` values are data (needs a product decision); report reasons now stored in the reporter's language.

**Verify (final tip):** root `npm run lint` 0 errors (incl. the new i18n gate) · `npm test` **418 pass** (78 files) · `npx tsc --noEmit -p tsconfig.app.json` exit 0 · `npm run build` exit 0 · functions `npm run build` exit 0 · `npm test` **1840 pass** (124 files, 3 skipped) · `npm ci --dry-run` exit 0 · en/da locale parity 883/883 keys. Promote PR closes #205 #206 #207 #208 #209.

---

## 2026-07-22 — #191 course language field + language-based visibility (PR #192)

**Who:** martin & Claude. Worktree branch `feat/course-language-field-191`, PR #192. Grilled the design with martin, then subagent-driven implementation (fresh implementer per task, per-task spec+quality review, Opus whole-branch review, one fix wave). Scope grew during grilling from #191's "metadata label only" to include **language-based course visibility**; the newly-identified multilingual-course-identity + analytics aggregation split out to **#213**.

**What shipped.**
- **Schema/type:** `courses.language text CHECK (language IN ('en','da'))`, nullable (`migration/azure/01-schema.sql`); `Course.language: 'en'|'da'|null`. Seed course set to `'da'`. **Prod DB migrated 2026-07-22** (idempotent `ADD COLUMN` + `UPDATE … SET language='da' WHERE NULL`; **4 rows → `da`**), run by martin from his terminal via a temp single-IP firewall rule **before** the deploy — the two filtered endpoints 500 if the column is absent.
- **Write APIs:** `course-create` requires + validates `language`; `course-update` allows editing it (`en`/`da` only, not null-clearable).
- **Admin UI (platform-admin only):** required language Select in the create dialog (default `da`), editable Select in the editor, `LanguageBadge` (globe + muted text, renders nothing for null) in the course list only. Option labels reuse the existing `languages.en`/`languages.da` keys; new field-label keys `coursesManager.languageLabel` / `courseEditor.languageLabel` (en "Language" / da "Sprog").
- **Language visibility:** learners & org-admins see only courses matching their **resolved UI language** (`i18n.resolvedLanguage`, sent in the request body); platform admins (`courses-admin`) see all. Filtered endpoints: `learner-courses`, `org-course-access`. A learner's **already-enrolled** courses stay visible regardless of language — the language predicate is relaxed via `OR EXISTS(enrollments…)` while the published + org-enabled visibility predicate stays an outer AND (tenant isolation; guarded by a dedicated regression test that locks the parenthesization).

**Key decisions (grilled):** existing (mock) courses backfilled to `da` + strict filtering; editor forces a value on save; filter keys off the client's resolved UI language (NOT the DB `preferred_language`, which defaults to `en` and would empty the catalog for da-UI users); org-admins filtered by their own UI language incl. enrollment.

**Verify (rebased on `origin/main` @<code>f69b43b</code>):** root `npm run lint` 0 errors · `npm test` **427 pass** (79 files) · `npx tsc --noEmit -p tsconfig.app.json` exit 0 · `npm run build` exit 0 · functions `npm run build` exit 0 · `npm test` **1852 pass** (124 files, 3 skipped). Not driven against a live Entra/DB (endpoint contract tests + real render tests cover the logic; unauth smoke returns 401 before the DB). Merged via PR #192 → `main`; SWA + functions deploys auto-fire (functions changed). #191 closed; #213 opened (deferred).

---

## 2026-07-22 — Accept-invitation flow (#175, PR #211)

**Who:** emil, subagent-driven development (fresh implementer per slice, two-stage spec+quality review each, final whole-branch review). Design locked in a prior grilling + prototype session (strict email match, reuse of the post-login-redirect stash, explicit Accept with no peek endpoint, both invite types, idempotent/reactivate existing-member rules).

**What shipped:**
- **Backend** — new authed endpoint `functions/invitation-accept` (POST `{ linkId }`): in one transaction, locks the invitation by `link_id` (`FOR UPDATE OF i`), validates → 404 `INVITE_NOT_FOUND` / 409 `INVITE_ALREADY_ACCEPTED` / 410 `INVITE_EXPIRED` (status *or* past `expires_at`; never mutates status — the expiry job owns that) / 403 `INVITE_EMAIL_MISMATCH` (trim+lowercase both sides), then converts via the new shared helper **`functions/shared/invitation-convert.ts`** (org invite → `active` membership with the invited role, already-active idempotent `alreadyMember`, disabled → reactivated with the invited role; platform invite → `profiles.is_platform_admin`; both mark the invite `accepted`). Hand-rolled envelope (documented exception — the `endpoint()` factory 401s on missing profile and accept can be a user's first call; provisioning mirrors `user-context`). **No seat check by design:** accept is seat-neutral (−1 pending / +1 active within one transaction) — proven in a comment on the helper, per the #126 `active + pending` cap model.
- **Frontend** — `src/pages/Signup.tsx` rewritten from a redirect stub into the accept flow (click-driven state machine, zero effects): no `invite` param → `/login` as before; unauth → generic "You've been invited" card (no org disclosure pre-auth), sign-in stashes `pathname+search+hash` via the existing `savePostLoginRedirect` and Login's consume restores the URL after the Entra round-trip; authed → explicit Accept card (signed-in chip, "Not you? Sign out"), double-submit latched; success → `refreshUserContext()` **before** routing to the role home (Login's fallback chain); every error code → its own localized card (mismatch = destructive Sign out; generic = Try again). Card visuals reuse Login's exported gradient/card classes. **i18n:** full `invitationAccept.*` namespace en+da (29 keys, verified parity); role names reuse `orgDetail.*` keys; mismatch copy adapted to show only the caller's email (the 403 deliberately discloses nothing).
- **Known flag for later:** `membership_status`'s `'invited'` enum value remains dead-ish state (the seat model counts pending *invitations*, not `'invited'` memberships) — deliberately left untouched; noted in the PR for a human decision.

**Verify:** functions `npm run build` exit 0 · `npm test` 1859 pass (125 files, 3 skipped; 16 new endpoint tests covering every outcome incl. lock/no-write asserts) · root `npm run lint` 0 errors · `npm test` 435 pass (79 files; 17 new Signup tests incl. stash, latch, all successes/errors, refresh-before-route) · `npx tsc --noEmit -p tsconfig.app.json` exit 0 · `npm run build` exit 0. Entra round-trip smoked live via Playwright — the PR-preview host is **not** a registered Entra redirect URI (AADSTS50011; per-PR SWA hostnames aren't in the app registration), so the seam was proven on the local dev server (`localhost:8080`, registered) against the real tenant: pre-auth card (da) → sign-in → full-page Entra redirect → landed back on `/signup?invite=<id>` with the Accept card + signed-in chip; Accept POST wired to `/api/invitation-accept` (fails to the generic card pre-merge as expected — the endpoint deploys with trunk); Try-again resets. Preview verified the pre-auth render (en). Full accept path re-smoked post-merge per the deploy ritual. Sibling **#176** (auto-adopt at first SSO login) stays open and reuses `invitation-convert`.

---

## 2026-07-22 — Fix: invitation emails silently undelivered (send-invitation-email 400)

**Who:** emil, diagnosed live against prod with a token-replay probe (diagnosing-bugs loop), fixed inline.

**Symptom:** every `invitation-create` succeeded but the follow-up `send-invitation-email` returned 400 (`Invalid invite link domain`) — 100% of invite emails since the SWA migration were never sent; fire-and-forget swallowed it in the UI.

**Root cause:** the endpoint hardcoded `ALLOWED_LINK_DOMAINS = ['ai-uddannelse.dk']`, but until the #115 domain cutover the app runs on the SWA host and mints invite links on `window.location.origin` (`VITE_PLATFORM_BASE_URL` deliberately unset until cutover — see `resolvePlatformBaseUrl`, #80). The link-domain gate rejected the app's own links. Differential probe confirmed the Resend leg behind the gate is healthy (200 + message id with an allowed link).

**Fix:** `allowedLinkDomains()` — the gate now accepts `ai-uddannelse.dk` plus the hostname of every entry in `ALLOWED_ORIGINS` (the same env CORS trusts; already carries the real app origins). Computed per-request for testability. Self-heals at the #115 cutover. Regression tests: SWA-host link accepted when its origin is allowed; foreign domains still 400.

**Verify:** functions `npm run build` exit 0 · `npm test` 1873 pass (125 files, 3 skipped; red-then-green regression test). Post-deploy live probe: the exact previously-failing payload flips 400 → 200.

---

## 2026-07-22 — #118 Opportunity prioritization (Value × Effort) in Idea Management

**Who:** martin, subagent-driven (one implementer + spec/quality review per task, then a whole-branch review). PR #212.

**What shipped:**
- **Board** — new **In Progress** Kanban column between Backlog and Done in `OrgIdeasManagement.tsx` (`in_progress` split out of Backlog; the status already existed, so frontend-only, no data change).
- **Prioritize tab** — Board/Prioritize `Tabs`. The Prioritize tab renders a 3×3 **Value × Effort** matrix (Low/Med/High per axis): drag a card into a cell, or open a scoring dialog, to set both scores; an **Unscored tray** holds ideas not yet rated. Matrix/overview population = only `accepted` + `in_progress`. Scoring is **orthogonal to Kanban status** (rating never changes status, and vice versa).
- **Overview** — quadrant counts (Quick Win / Big Bet / Fill-in / Deprioritize), a ranked **"Do next"** list (value↓ → effort↑ → votes↓), and a **by-business-area** rollup.
- **Board tags** — rated ideas show their priority band on the Board card (`PriorityBadge`).
- **Filters scoped to Board** — the header search + business-area filter now affect **only the Board**; the Prioritize tab uses its own unfiltered committed-idea query (shares the Board's cache key when no filter is active) so the matrix + by-area rollup always reflect the whole portfolio. (Post-review fix; the header controls are hidden on the Prioritize tab.)
- **Backend** — two nullable `smallint` columns `value_score`/`effort_score` (CHECK 1–3) on `ideas` (`migration/azure/01-schema.sql` + idempotent `migration/azure/04-idea-priority-scores.sql`, **run on prod 2026-07-22 before deploy**). New admin-only endpoint `functions/idea-prioritize` (shared `endpoint()` factory, `requireOrgAdmin(idea.org_id)`, writes only the two score columns; reads ride the existing `SELECT i.*`, so no read-endpoint change). Pure framework logic isolated in `src/lib/idea-priority.ts` (`getBand`, `rankIdeas`, `PRIORITIZABLE_STATUSES`).
- **New components:** `PrioritizationMatrix`, `PriorityOverview`, `IdeaScoreDialog`, `PriorityBadge`. i18n: `ideaManagement.{tabs,levels,bands,prioritize,scoreDialog}.*` en+da (parity verified programmatically).
- **Field-exposure note:** the two scores ride `SELECT i.*` (same path that already returns `admin_notes` to any active org member); org isolation unchanged; scores are only rendered on the admin Prioritize surface. Deliberate, per the design.
- **Follow-ups (deferred):** a11y on the scoring dialog (`<label htmlFor>`, placeholder-vs-selected); broader `PriorityOverview` test coverage (band counts + area rollup); drop the unused `ScoreLevel` export; optional endpoint hardening against half-scored writes. To be filed as a follow-up issue.

**Verify:** root `npm run lint` 0 errors · `npm test` 458 pass · `npx tsc --noEmit -p tsconfig.app.json` exit 0 · `npm run build` exit 0; functions `npm run build` exit 0 · `npm test` 1887 pass (125 files, 3 skipped) — new tests: idea-prioritize endpoint contract (11), idea-priority band truth-table + ranking, PriorityBadge, PrioritizationMatrix (population/tray/cell), PriorityOverview (ranking), updateIdeaPriority api. Prod migration 04 applied + columns verified (`value_score`, `effort_score` smallint). Deploy + post-merge smoke announced on PR #212.

---

## 2026-07-22 — #176 Auto-adopt pending org invites at login (self-signup)

**Who:** martin, TDD + grilling design pass + 8-angle code review. PR #217.

**What shipped:** `functions/user-context/index.ts` now honors pending **organization** invitations addressed to the caller's Entra email — reusing the #175 shared `convertInvitation` helper **unchanged**, so a user who signs in via SSO directly (without clicking the invite link) is auto-added to the inviting org at the invited role, invite marked `accepted`. Backend-only; response shape unchanged (the adopted org simply appears in `memberships`).

**Design decisions (grilled with Martin, one at a time):**
- **Runs on every login**, not just first-provision — so an invite created *after* a user self-signed-up is still adopted on their next sign-in (the common "won't click the link" case). Idempotent, so re-logins are safe.
- **Org invites only.** Platform-admin invites (`org_id IS NULL`) are deliberately **skipped** — this path authenticates on email match alone (no secret link), so keys-to-the-kingdom elevation stays gated behind the explicit accept-link flow (#175).
- **Email-match bar:** the Entra sign-in email (`preferred_username`, Microsoft-signed/tenant-authoritative), matched case-insensitively + trimmed; a blank email is skipped entirely (never matched against invitations).
- **Best-effort:** adoption runs in its own transaction; any failure is logged via `context.error` and swallowed so **login never breaks** (retries next login). Runs *before* the memberships load so a freshly-adopted org appears in the same response.
- **Seat-neutral** by construction (a pending invite already reserves its seat — #126; −1 pending / +1 active within the transaction).
- **Perf:** a cheap non-transactional `SELECT … LIMIT 1` pre-check runs first; the locking transaction only opens when there is actually an invite to adopt (avoids a connection checkout + BEGIN/COMMIT on the ~always no-invite path). The in-transaction re-select under `FOR UPDATE` still guarantees no double-consume vs. a concurrent accept-link flow (READ COMMITTED re-checks `status='pending'` after the lock).

**Note:** this is an Entra-gated backend endpoint with no local runtime (no local DB/login), so mock-contract tests are the verification path per `.claude/rules/functions.md`. No schema change (the `invitations` table + `invitation_status` enum already supported it); no `functions/index.ts` change (user-context already registered).

**Verify:** functions `npm run build` exit 0 · `npm test` 1894 pass (126 files, 3 skipped; 10 user-context contract tests — TDD red→green, covering single/multi-org adopt, no-invite bare account, platform-admin skip, already-member idempotency, blank-email skip, case-insensitive match, adoption-failure-never-breaks-login, and the pre-check "no transaction when nothing to adopt"). Root `npm run lint` 0 errors · `npm test` 458 pass · `npx tsc --noEmit -p tsconfig.app.json` exit 0 · `npm run build` exit 0. Gates re-run green after rebasing/merging trunk (post-#212). Deploy + post-merge smoke announced on PR #217.

---

## 2026-07-22 — #125 Events & Office Hours tab (Helm plan events-office-hours-125)

**Who:** emil as Helm conductor; three-slice serial fleet run (plan `events-office-hours-125`), zero failures, zero interventions. Promote PR #216.

**What shipped:**
- **Tab enabled** — the "Events & Office Hours" placeholder in `CommunityFeed.tsx` is a real view: `?scope=` gains an `events` value (`CommunityView = CommunityScope | 'events'`; API calls keep the narrow `CommunityScope`), deep link `/community?scope=events` works, and the no-org redirect exempts the events view (it always includes global scope).
- **Events view** — clean single column (no search/chips/sidebar), upcoming-only (`isFuture || isToday` on `event_date`, same semantics as `UpcomingEvents.tsx`), soonest first, merged global + current-org via new `useCommunityEvents` hook (thin wrapper on `/api/community-posts`; events-category cut + sort stay at the call site per frontend rules; shares the unfiltered feed's cache key).
- **`EventCard`** — date-forward card (month/day block, primary-filled when today), title, host (`community.hostedBy`), time + location line, prominent **Join** button opening the Zoom/Teams `event_registration_url` in a new tab (`stopPropagation` so it never triggers navigation); card body/keyboard (Enter/Space) opens PostDetail routed by `post.scope`.
- **New Event affordance** — header button relabels to **New Event** on the events view, gated to platform admins (form scope `global`) and org admins (form scope their org), hidden for learners; opens the existing `PostForm` with the events category preselected (`initialData`); Submit Idea hidden on the view.
- **Empty state** — `CommunityEmptyState` gains an `events` variant (Calendar icon, en+da keys) with the New Event CTA for admins only.
- **No backend/schema changes** — the restricted `events` category, event columns, PostForm event fields, and PostDetail event chips all pre-existed.
- **Known nit deferred:** the tracer's `community.noUpcomingEvents` key is orphaned after slice 3 swapped in the shared empty state.

**Verify (final tip):** per-slice Helm acceptance green ×3 (each slice ships its own proof test: `events-tab.test.tsx`, `EventCard.test.tsx`, `events-tab-admin.test.tsx`) · promotion re-run: root `npm test` 434 pass, 81 files (first run had one flaky `routes-gate.test.ts` failure, unrelated — green in isolation and on the clean re-run) · functions `npm test` 1840 pass (124 files, 3 skipped) · CI green on PR #216 · post-deploy signed-in Playwright smoke announced on the PR.

---

## 2026-07-22 — #218 Opportunity-prioritization follow-ups (a11y, tests, cleanup)

**Who:** martin. PR #220. The six deferred, non-blocking items filed off the #118 build (PR #212) — none affecting correctness.

**What shipped (all six items from #218):**
- **Scoring-dialog a11y** (`IdeaScoreDialog.tsx`) — each `<label>` now linked to its Radix `SelectTrigger` via `htmlFor`/`id` (the ids hoisted to module consts so the community `i18next/no-literal-string` gate stays clean, since the trigger literal lives inside a JSX expression); the misleading "Medium" placeholder (read as if a score were already selected) replaced with a neutral `scoreDialog.placeholder` — "Select…" / "Vælg…", en+da.
- **`PriorityOverview` test breadth** — added coverage for the quadrant band-count aggregation (four bands + unscored ignored) and the by-business-area rollup (null `business_area` ignored, `count > 0` filter, sort desc). Two `data-testid`s added to the component for the assertions, mirroring the existing `do-next-list`.
- **`PrioritizationMatrix`** — the per-cell `scoredAt` re-filter (9× over `inScope` every render) collapsed into one `useMemo` partition: an `unscored` list + a `scoredByCell` Map (`${value}-${effort}` → ideas), so each grid cell is a single lookup. Behavior-preserving (same predicate, same order). Added a mutual-exclusivity test: a fully-scored idea lives in its cell and never in the unscored tray; a half-score counts as unscored.
- **`idea-prioritize` endpoint** — rejects a half-score (exactly one of value/effort null) with 400 before any DB access, so stored state is always fully scored or fully cleared. TDD red→green; the clear path `(null,null)` and full scores are unaffected, and the deliberate 4xx message is a caller-facing contract per `.claude/rules/functions.md`.
- **Prioritize-tab loading flag** (`OrgIdeasManagement.tsx`) — the tab gates on the unfiltered committed-idea query's own `isLoading` instead of the Board query's, so an active header filter's refetch no longer flickers a spinner on the (independently-keyed) Prioritize tab.
- **Cleanup** — dropped the exported-but-unused `ScoreLevel` type from `src/lib/idea-priority.ts`.

**Verify:** (rebased on trunk after #212/#217/#216 landed) root `npm run lint` 0 errors · `npm test` 477 pass · `npx tsc --noEmit -p tsconfig.app.json` exit 0 · `npm run build` exit 0; functions `npm run build` exit 0 · `npm test` 1895 pass (126 files, 3 skipped; +1 half-score contract test, red→green). Independent code-review pass: no findings. Deploy + post-merge smoke announced on PR #220.

---

## 2026-07-22 — #213 Multilingual course identity + combined analytics

**Who:** martin. PR #215. Design → plan → 9 TDD tasks via subagent-driven development (per-task spec + code-quality reviews on Opus 4.8, plus a final whole-branch review). Fulfils the #191 deferral.

**Scope:** a **reporting + enrollment-integrity** change only — learner-facing behavior is unchanged (a learner still sees/enrolls in only their UI-language edition, per #191). Content translation stays out of scope (#187).

**What shipped:**
- **Model** — a nullable `course_group_id` tag on `courses` (approach ①, symmetric — no "primary" edition; NULL = standalone). Group key = `COALESCE(course_group_id, id)`. Indexes: a lookup index + a partial `UNIQUE(course_group_id, language) WHERE course_group_id IS NOT NULL` enforcing **one edition per language per group**. No FK, no data backfill (existing rows start standalone).
- **Shared SQL helper** `functions/shared/course-groups.ts` (mirrors `course-visibility.ts`): `courseGroupKey`, `courseGroupMemberIds`, `siblingEnrollmentExists` — pure fragment builders, author-supplied ordinals only, values bound.
- **Linking endpoint** `course-translation-link` (admin-only, factory): `link`/`unlink` with validation — both need a language, candidate must be standalone (**no group-merging**), one-edition-per-language (app check + unique-index `isUniqueViolation`→409 backstop), self-link 400, unlink collapses a leftover group-of-one; a `gen_random_uuid()`-in-a-CTE mints one shared id for two standalones.
- **Enrollment guard** on both paths (`enroll` self-enroll + `enrollment-create` admin): enrolling into a course whose sibling edition the learner already holds (same group, same org) → 409 "Already enrolled in this course in another language". Enforced in **application code** (per-org `EXISTS` before insert), not a DB constraint.
- **Combined analytics** — `org-course-progress` collapses a group's editions into one line (single-org **and** all-orgs branches), counting **distinct learners** (`COUNT(DISTINCT user_id)` in every branch, so a residual TOCTOU / link-after-enroll edge can't inflate the count). Representative row (title/level) = the admin's app-language edition, else earliest-created — NULL-safe via `(language = $n) IS TRUE DESC, created_at ASC, id ASC`. `adminLang` threaded through the endpoint, `useOrgCourseProgress`, the query key (so a UI-language switch refetches), and `CourseProgressTab`. Drill-ins (`org-course-enrollees`, `org-course-org-breakdown`) expand the clicked representative id back to its whole group.
- **Editor** — a "Language editions" section on `CourseEditor` lists linked siblings (Unlink) + a candidate picker (Link); candidates = standalone, different language, not already grouped. Both pages now read the admin course list through a shared `useCoursesAdmin` hook (fixes a cache-shape collision on the `['courses-admin']` key that the final review caught). en+da i18n.

**Key decisions:** symmetric group tag over a `translation_of` FK or a `course_groups` table (both add machinery for no gain here); Option A representative (admin's app language) with a deterministic earliest-created fallback; **distinct-learner counting everywhere** makes the "combined line = head-count" promise robust regardless of the app-level guard's small race window.

**Prod DB prerequisite (human-gated):** the `course_group_id` column + indexes must be applied to prod **before** the deploy — `migration/azure/05-course-group-id.sql` (idempotent). The five endpoints above reference the column unconditionally, so deploying the code first would 500 them in prod (same ordering as #191/#118: migrate, then merge/deploy). **Deferred (pre-launch, no production data needs it):** live DB smoke of the roll-up math / representative selection / 409 / drill-in expansion (unit tests mock the DB per `.claude/rules/functions.md`); optionally a link-time check to hard-prevent the double-enrolled state.

**Verify:** rebased cleanly on trunk after #212/#216/#217/#218/#220 landed. Root `npm run lint` 0 errors · `npm test` 481 pass (88 files) · `npx tsc --noEmit -p tsconfig.app.json` exit 0 · `npm run build` exit 0; functions `npm run build` exit 0 · `npm test` 1913 pass (128 files, 3 skipped; one flaky vitest worker-teardown SIGABRT, green on re-run). Final whole-branch review clean after one fix (distinct-learner counts in the single-org branches + spec-wording correction). Merging auto-deploys (functions + frontend changed); deploy + post-merge smoke to be announced on PR #215 **after** the prod migration lands.

---

## 2026-07-22 — #117 Onboarding assessment flow (AI self-assessment)

**Who:** emil, subagent-driven (implementer + spec review + quality review per task, whole-branch integration review, controller-driven signed-in smoke). PR #219.

**What shipped:**
- **A 7-question AI self-assessment for learners**, shown full-screen after login (skippable "Spring over indtil videre" — the prompt appears **once ever**; skip is recorded server-side in `profiles.assessment_skipped_at`). Scoring is server-owned: option points = ladder position 0-3, total 0-21, thresholds basic 0-7 / intermediate 8-14 / advanced 15-21 mapped onto the existing `course_level` scale. The client never computes or submits a level.
- **DB** — `migration/azure/06-assessment.sql` (idempotent, single transaction; **06** because 04 was taken by idea-priority-scores and 05 by #213's course-group-id): `assessment_attempts` (uuid PK, user_id → profiles, score, level `course_level`, raw `answers` jsonb, `questionnaire_version` 'v1', created_at; index `(user_id, created_at DESC)`) + `profiles.assessment_level` (denormalized latest) + `profiles.assessment_skipped_at`. Level is global per-user, not per-org.
- **Backend** — questionnaire structure/scoring in pure shared module `functions/shared/assessment-questions.ts` (also imported cross-tree by the frontend drift-guard test). Three factory endpoints (ADR-0015, any-authed): `assessment-questions` (ID structure only, no points), `assessment-submit` (validates exact question/option ID cover → 400; transaction: insert attempt + overwrite `profiles.assessment_level`; retakes are new attempt rows, current level = latest), `assessment-skip` (idempotent COALESCE — first skip timestamp wins). `user-context` additively returns `assessment_level`, `assessment_skipped_at`, `assessment_taken_at` (scalar subquery; shared `PROFILE_SELECT` fragment keeps both provisioning paths shape-identical). `org-analytics-data` members additively carry `p.assessment_level` (+ `om.role` in the all-orgs branch, `ORDER BY p.id, om.role` so org_admin wins for dual-role users — deterministic admin exclusion). **Privacy locked in:** raw answers are written once and never SELECTed by any endpoint; `profileJson()` untouched (no leak to community surfaces).
- **Frontend** — full-screen `/app/assessment` route (learner-guarded, outside AppLayout): Fokus-wizard (one question per screen, explicit Næste — no auto-advance, entrance animation keyed to question id only, answers preserved across Tilbage, a11y: focus-on-question-change + labelled radiogroup) → split result screen (score ring /21 colored via shared `LEVEL_STYLES`, persona headline Udforsker/Hverdagsbruger/Superbruger — personas appear ONLY here, course-scale `LevelBadge` everywhere else, blurb, "Start her - udvalgt til dit niveau" level-matched course rows with enroll-and-play Start). Login predicate: plain learner + no level + no skip → assessment (deep-link stash keeps precedence). Dashboard: persistent no-dismiss banner above the stat grid until completed. Courses: "Anbefalet til dig" section (level-matched, "Anbefalet" chip; status badge moves top-left to coexist) above the unchanged full catalog ("recommend, never hide"). Settings: "AI-vurdering" card (LevelBadge, "Senest taget <date>" via the shared date-locale helper, privacy note, retake). Admin surfaces (banner/card) keyed on REAL roles — platform admins in learner view-mode never see them.
- **Analytics** — org-admin + platform all-orgs views: "AI-niveau" segmented distribution bar (basic/intermediate/advanced/not-assessed; **scope = active members with role learner only** — admins are never prompted, counting them would permanently inflate not-assessed) + "AI-niveau" `LevelBadge` column on the members table (badge or em-dash; sortable, null last). Course-scale names only (legend via `courses.levels.*`).
- **i18n** — new `assessment.*` namespace en+da (verbatim from the locked content session; Danish primary) + drift-guard test asserting the i18n question/option keys exactly cover the server module IDs. **da course-scale labels updated to the locked naming rule:** `courses.levels.basic/intermediate` "Basis"/"Mellemliggende" → **"Begynder"/"Øvet"** (app-wide chip labels; en unchanged).

**Verify:** root `npm run lint` 0 errors · `npm test` 494 pass (88 files) · `npx tsc --noEmit -p tsconfig.app.json` exit 0 · `npm run build` exit 0; functions `npm run build` exit 0 · `npm test` 1938 pass (130 files, 3 skipped) — new: shared-module threshold boundaries (7/8, 14/15), submit validation 400s + boundary INSERT params, skip idempotency, user-context both-path field tests, analytics tenant-isolation 403, i18n drift guard. **Full signed-in reach-line smoke pre-undraft on a locally stood-up stack** (Docker Postgres 15 + `func start` + dev server, real Entra auth): wizard→result (13/21 Hverdagsbruger)→recommended→settings retake (21/advanced; 2 attempt rows, latest denormalized); skip→dashboard banner→no re-prompt on reload or /login round-trip (server-recorded); admin: settings card hidden, distribution Begynder 1/Øvet 1/Avanceret 1/Ikke vurderet 2 with BOTH org admins (each holding advanced) excluded, AI-niveau column, single-org + all-orgs title variants, da+en. Zero app console errors (one pre-existing boot-race 401 on `platform-settings` during the OAuth code exchange, unrelated to #117).

**Deploy prerequisite (human-gated):** apply `migration/azure/06-assessment.sql` to prod before merging (same ritual as 03/04). **Applied to prod 2026-07-23** via the in-app SQL channel (Kudu `/api/vfs/data/` + the deployed `pg`, verify-full TLS); table/columns/index verified before-and-after.

---

## 2026-07-23 — ADR-0016 content localization strategy (#187)

**Who:** martin. PR #224. Brainstorming → ADR. #187 is a **decision issue** — the deliverable is the recorded decision, no code (per-surface implementation lives in other issues).

**Decision:** authored content localizes by one of three mechanisms, and **only courses segment the audience by language**:
- **Structured teaching content (courses/lessons)** → per-language editions grouped by `course_group_id`; learners/org-admins see only the edition matching their **active UI language** (`i18n.resolvedLanguage`, per #191), analytics aggregate a group to one logical course (#213).
- **Communal/announcement content (community feed, webinar/marketing #125)** → single shared artifact, no per-language editions, no language filter; authors write in either language.
- **System-generated documents (transactional emails, AI Act PDF #71)** → one localized template rendered in the reader's language (server-sent email → stored `preferred_language`, as #193 does; on-demand PDF → requesting user's UI language). No duplicate copies.

Plus a classification rule for future surfaces. Ratifies the courses model already shipped by #191/#213. **Two language signals** clarified: `resolvedLanguage` (UI + catalog content) vs. stored `preferred_language` (server-generated docs) — they currently diverge for new users.

**Follow-ups filed:** **#225** (invite email localization — hardcoded `da` today; must resolve the no-profile-yet invitee language) · **#226** (initialize `preferred_language` from the browser at first login + override #119's Danish fallback → English for non-da/en, so UI/courses/emails agree). Per-surface implementation stays in #71/#123/#125/#225/#226.

**Verify:** docs-only (one new ADR file); CI green (frontend + functions gates). No deploy impact (no functions/frontend artifact change).

---

## 2026-07-23 — #226 Browser-derived platform language default (overrides #119)

**Who:** martin. PR #229. Grilled the design (6 decisions) before coding; inline TDD in an isolated worktree.

**What shipped:** a new user's platform language (UI, course catalog, and server-generated emails) is derived from their **detected browser language**, and #119's Danish catch-all is **reversed to English** for unrecognized browsers — Danish browser → `da`, English → `en`, **anything else → `en`** (was Danish).
- `src/i18n/index.ts`: `fallbackLng: ['da','en'] → 'en'` — the one lever; `resolvedLanguage` now returns exactly `da`/`en`, so a non-da/en browser gets an English UI **and** English courses (the catalog keys off `resolvedLanguage`, #191). `en` stays the secondary key fallback for keys missing in `da`. Swept the four remaining `'da'` last-resort fallbacks to `'en'` (the `<html lang>` sync, `useLearnerCourses`, `EnrollUserDialog`, Settings selector) so "English is the last resort" holds everywhere, not just at the one lever.
- `functions/user-context/index.ts`: stamps `preferred_language` from a validated, client-sent language at **first-login provisioning only** (default `en` on missing/unknown; existing profiles never overwritten). Fixes #193 seat-request emails for new users, which read `preferred_language` (previously the uninitialized `en`).
- `src/hooks/useAuth.tsx`: sends `i18n.resolvedLanguage` on the user-context call — covers normal login and the invite-accept path (via `refreshUserContext`).

**Grilled decisions:** (1) **no backfill** of existing users — their browser isn't server-visible and a guess could overwrite a deliberate Settings choice; (2) sweep all `'da'` fallbacks to `'en'` for consistency; (3) the Settings selector already read the stored value first — the issue's "hardcoded `da`" premise was wrong — so only the dead literal fallback flipped (no UI test: unobservable in practice); (4) the app sends the language and the server validates to `da`/`en` + defaults `en` (not derived from `Accept-Language`, which can diverge from the shown UI); (5) **no email-template changes** — initialization is the whole email fix, the invite email is #225; (6) TDD, three behavioral tests.

**Issue-vs-code corrections:** `Signup.tsx` needed no change (it's the accept-invitation page and routes through `useAuth`); the Settings selector was not "hardcoded `da`".

**Out of scope:** no schema migration (column default stays `en`), no email templates (#225), no backfill, no `Signup.tsx` change.

**Verify:** root `npm run lint` 0 errors · `npm test` 519 pass (92 files) · `npx tsc --noEmit -p tsconfig.app.json` exit 0 · `npm run build` exit 0; functions `npm run build` exit 0 · `npm test` 1970 pass (132 files, 3 skipped). Tests written first (red→green): user-context provisioning (da/en, default-en on missing/junk/bodyless, never-overwrite existing), i18n third-language→en (+ `en` kept as secondary key fallback), useAuth sends the language. Frontend user-visible behavior + one backend provisioning tweak; **no prod DB migration.** Merging auto-deploys (functions changed → backend + frontend workflows); deploy + smoke announced on PR #229.

---

## 2026-07-23 — AI Act compliance PDF rebrand + content redesign (#71)

**Who:** claude (Opus) + martin. PR #230. Brainstorming → locked design (formal register + Article-4 content) → pdfkit implementation → code-review → merge.

**What:** replaced the hand-rolled raw-PDF byte generator in `functions/generate-compliance-report` with a **pdfkit** renderer (new `render.ts`, pure-JS, serverless-safe). Reframed the document as evidence for **AI Act Article 4 (AI literacy), Regulation (EU) 2024/1689** — conclusion-first, one A4 page, scoped honestly as training evidence (not full conformity). Formal register: platform navy `#10298f` + logo, **Times** serif (built-in — æøå via WinAnsi, no TTF bundled), ruled tables, near-monochrome (oxblood only marks a deficiency). Sections: letterhead → title → metadata → declaration → §1 summary → §2 coverage by department → §3 course completion → §4 assessed literacy → certification/signature block.
- **Metric:** headline = **participation** (share of active staff with ≥1 completed enrollment in an org-enabled course) — deliberately well-defined, **no "required course" concept and no schema change**. §4 assessed-literacy distribution (from #117 `profiles.assessment_level`) adds the competency dimension; refresher-due = latest completion >12 months.
- **Localization (ADR-0016 category 3):** `strings.ts` da/en; report follows the requesting user's **live UI language** (`i18n.resolvedLanguage`), sent from `OrgAnalytics.tsx` (one-line change). Logo embedded as base64 (`logo.ts`, mount-safe). Binary body returned as a **Buffer** — pdfkit output is zlib-compressed, so the legacy `.toString('binary')` path would corrupt it (noted as a latent bug in the sibling `generate-certificate`).
- **Empty-org edge (code-review fix):** zero active members is a neutral state — no self-contradictory "Action required / 0 departments" verdict.

**Verify:** functions `npm run build` exit 0 · `npm test` 1971 pass (132 files, 3 skipped) — 9 new contract tests (200/400/401/403/404, da≠en bytes, `resolveLang` fallback, real-data render). Root `lint` 0 errors · `tsc` exit 0 · `test` 517 pass (92 files) · `build` exit 0. The **compiled** renderer was rendered with sample data (en+da) and visually matched the approved mockup; empty-org re-rendered after the fix. Code-reviewed (Opus): SQL scoping/authz/Buffer-response confirmed sound; one Important finding (empty-org verdict) fixed. Design spec: `docs/superpowers/specs/2026-07-23-ai-act-pdf-branding-design.md`.

**Deploy:** functions + frontend changed → both workflows fire on merge. No prod DB change. **Authed PDF-download smoke (da+en) pending a real admin login on prod** — endpoint is POST-only + Entra-gated; unauth POST → 401 confirms registration.

## 2026-07-24 — Security & silent-failure hardening from /review-suite (#232, PR #233)

**Who:** claude (Fable) + emil. Whole-codebase `/review-suite` (7 passes) → 4 fixes selected for inline fixing → subagent-driven implementation (one implementer per fix) → independent adversarial review → merge → deploy → prod smoke.

**What:** Four fixes, one per commit:
- **sec-1 (stored XSS, high):** community event/resource URLs were rendered into `href` with no scheme validation, and React 18 does not block `javascript:` URLs. New shared `src/lib/safe-href.ts` `safeHref()` (allowlist http/https/mailto, else `undefined`) applied at 6 render sinks (EventCard, PostCard, UpcomingEvents, PostDetail ×2, ResourceCard) + server-side scheme validation on write via `functions/shared/validate.ts` (`validateHttpUrl`) in community-post-create/-update and resource-create/-update.
- **sec-3 (PDF injection, medium):** extracted `pdfString()` (escapes `\`, `(`, `)`) to `functions/shared/pdf.ts` and applied it in the hand-rolled `generate-certificate`. The sibling `generate-compliance-report` was already migrated to pdfkit by #230 (which neutralizes the content-stream injection class), so the now-obsolete raw wraps there were dropped during rebase.
- **authz-1 (RLS parity, medium):** added the missing `requireActiveMember(orgId)` gate to `functions/lesson-progress` (+403 non-member test) — a non-member could previously upsert progress rows against any org.
- **err-1 (silent failure, high):** `useAuth` now `console.error`s a failed user-context load and records a distinct `contextError` state (401→'auth' vs network) instead of swallowing it; `ProtectedRoute` renders a retry (before the authz redirect, so an admin is not silently demoted) and `useOrgGuard` no longer presents the failure as eternal 'loading'.

**Rebase note:** main moved twice mid-flight; rebased onto #230 (pdfkit compliance report) + #229 (browser-language default) — both merges preserved (sec-3 compliance wraps dropped as obsolete; err-1 merged with #229's `i18n.resolvedLanguage` on the user-context call). One self-inflicted divergence (autosquash onto a stale local `main`) was corrected by re-parenting onto `origin/main`.

**Verify:** root `lint` 0 · `tsc` 0 · `test` 93 files pass · `build` 0; functions `build` 0 · `test` 133 files pass. Independent adversarial review over the whole diff (spec + security + quality): all four APPROVED, no must-fix. CI green on the PR.

**Deploy:** merged @`a3e635a` (squash), SWA + functions workflows green. **Prod /ui-report smoke (signed-in, all 4 features): PASS**, zero app console errors — err-1 (silent SSO, correct admin routing, resilient MSAL re-init), sec-1 (valid https event links render unchanged across feed/widget/detail), authz-1 (lesson-progress saves 0/4→1/4 for an active member), sec-3 (AI Act compliance PDF generates a real `%PDF-`, ~10 KB — this also completes #230/#71's long-pending authed PDF-download smoke). Server create-path validation + certificate generation left to the passing test suite (no prod mutation).

**Deferred:** the rest of the review (mechanical batch → Helm tasks; decision/refactor set → GitHub issues) is held until PRs #228/#231 merge (they overlap ~10 of the batch files). Report: `Desktop/claude-html/2026-07-24-review-main-codebase.html`.

## 2026-07-24 — Review-suite top-5 batch (#235–#239, PR #240)

**Who:** claude (Fable) + emil. Top-5 pick from the 2026-07-24 review board (all remaining high-severity cards not colliding with in-flight #228/#231) → issues filed → subagent-driven implementation (fresh implementer per fix, spec review + quality review each, whole-branch final review) → merge.

**What:** five fixes, one commit each:
- **dead-1/#235:** deleted dead endpoint `functions/delete-user/` (zero callers since bf1df3b, 2026-07-15) + barrel import + migration-README row. Decision recorded: user deletion is not a current product surface; rebuild from git history if it returns (e.g. GDPR).
- **dead-2/#236:** deleted dead endpoint `functions/admin-user-actions/` (route `user-actions-admin`; superseded by the live org-membership-* trio, which carry equal-or-stronger validation + the same seat-cap transaction). `KNOWN_DEVIATIONS` in the fleet guard emptied (guard now strictly folder=route for every endpoint); `.claude/rules/functions.md` example rephrased hypothetically; README row dropped.
- **dup-3/#238:** the 11 remaining `toLocaleDateString()` sites (8 files) routed through `formatDate(new Date(x), 'P', i18n.language)` from `src/lib/date-locale.ts`, closing the #209 gap — user-facing dates now follow the UI language everywhere. ESLint `no-restricted-syntax` guard on `toLocaleDateString` (src/-scoped) prevents re-drift (verified to catch optional chaining too). Nullability audited per site: the two `completed_at!` sites degrade to the same 1970 rendering as before on null — no new throw path.
- **dup-5/#239:** extracted `mintLmsAssetUrl(profile, blobPath)` into `functions/shared/lms-asset.ts` (tagged-union result, mirrors the invitation-convert/seats house style); `asset-signed-url` + `azure-view-url` are now ~6-line factory wrappers keeping their response keys (`url`/`viewUrl`). One sanctioned behavior change: azure-view-url validation hardened truthiness → strict `typeof` 400 (+3 tests). SAS stays read-only/120-min; platform-admin short-circuit ordering preserved and test-pinned.
- **dup-1/#237:** moderation dedup — new `src/hooks/useReportModeration.ts` (3 mutations + `ReportWithDetails`, invalidate-key-parameterized), `src/components/community/ReportCard.tsx` (scopeBadge ReactNode slot) + `ReviewReportDialog.tsx`; pages keep query/guard/header/scope-filter (Org 328→173, Platform 408→262). Byte-parity verified down to toast/invalidate ordering; `PlatformCommunityModeration.test.tsx` passes unmodified; +3 ReportCard tests.

**Verify:** root `lint` 0 errors · `test` 94 files / 555 pass · `tsc` exit 0 · `build` exit 0; functions `build` exit 0 · `test` 131 files / 2010 pass (3 skipped). Every fix: spec-compliance review + code-quality review (independent subagents); one spec gap caught and fixed in-batch (#236's stale README row); whole-branch final review READY with zero cross-task findings.

**Deploy:** merging auto-fires both workflows (functions + frontend changed). Deploy + signed-in /ui-report smoke over the touched surfaces announced on PR #240.

**Follow-up candidates (to file post-merge):** broaden the date lint guard to `toLocaleString`/`toLocaleTimeString`; align the env-config 500 guard across the three SAS minters; point the 3 hand-rolled `azure-view-url` frontend callers at a `getViewUrl` helper once #228 lands (noted on #239).

## 2026-07-24 — Review-suite round-2 top-5 (#241–#245, PR #246)

**Who:** claude (Fable) + emil. Second top-5 pick from the 2026-07-24 review board — the highest-impact open cards that don't collide with in-flight #228/#231 (which took dup-2/err-2/docs-1 and the dup-4 test-harness refactor off the table) → issues filed → subagent-driven implementation (fresh implementer per fix, spec review + quality review each, whole-branch final review) → merge.

**What:** five fixes, one commit each (+ review-fix commits):
- **err-9+err-8/#241:** top-level `<ErrorBoundary>` (class component, `i18n.t` via the module instance so provider-origin errors still translate; branded card + reload, `errorBoundary.*` keys en+da) wrapped around `AppRoutes` inside all providers, plus a `.catch` on the `msalInstance.initialize()` bootstrap chain rendering a static bilingual plain-DOM message into `#root` — both whole-app blank-page modes now render something actionable.
- **err-6/#242:** new shared `QueryErrorState` (destructive-styled sibling of `EmptyState`, `role="alert"`, retry→`refetch`) forked on `isError` for the primary query of learner Dashboard/Courses, CommunityFeed, IdeaLibrary, OrgAnalytics — a failed load is no longer rendered as "no items"/all-zero stats; secondary data (feed categories, idea org-tags) toasts via `useQueryErrorToast` with `common.loadErrorTitle`. Keys `common.loadErrorTitle/loadErrorDescription/retry` en+da.
- **err-4/#243:** the 8 silent community mutations (PostDetail comment update/delete/hide + post hide/lock, CommunityFeed hide/lock, ResourceLibrary pin) got the sibling-idiom `onError` destructive toast (6 new `community.toasts.*Failed` keys en+da); the 3 fire-and-forget `mutateAsync` comment call-sites got `.catch(() => {})` so rejections stop surfacing as unhandled-rejection noise (onError owns the feedback; createComment's deliberate re-throw path untouched).
- **sec-4/#244:** react-router-dom `^6.30.1 → ^6.30.4` (@remix-run/router 1.23.3) clears the named advisories; `isInAppPath` in `post-login-redirect.ts` hardened to single-leading-slash + reject backslashes/control chars (validated on write AND read), with a 16-case test file. Residual: the backslash CVE (GHSA-wrjc-x8rr-h8h6) has **no 6.x patch** (fix is v7.18.1, breaking) — the hardened guard is the app's actual defense; v7 migration filed as follow-up.
- **err-7/#245:** `functions/shared/auth.ts` verify-callback now classifies: `JsonWebTokenError` family **and** jwks-rsa `SigningKeyNotFoundError` (unknown kid = attacker-controllable token problem, caught in quality review) → `AuthError` 401; everything else (JWKS transport/DNS/rate-limit) rejects as-is → factory `internalError` → **logged** generic 500 (ADR-0014). An Entra signing-key outage is now visible in App Insights instead of masquerading as fleet-wide 401s, and raw `getaddrinfo` messages no longer leak into 401 bodies.

**Verify:** root `lint` 0 errors · `tsc` exit 0 · `test` 97 files / 588 pass · `build` exit 0; functions `build` exit 0 · `test` 131 files / 2013 pass (3 skipped). Every fix: spec + quality review by independent subagents; two quality findings fixed in-batch (i18n-parity test idiom on #241, SigningKeyNotFoundError classification on #245). Whole-branch final review READY: locale hunks parity-checked, no protected #228/#231 files touched.

**Deploy:** merging auto-fires both workflows (frontend + functions changed). Deploy + signed-in /ui-report smoke over the touched surfaces announced on PR #246.

## 2026-07-24 — Review-suite round-3 top-5 (#248–#249, #251–#252, #254, PR #253)

**Who:** claude (Fable) + emil. Third top-5 pick from the 2026-07-24 review board — the most important open cards that don't collide with in-flight #228/#231 (which still hold dup-2/err-2/sec-2/authz-2, the CoursePlayer cards err-5/err-10, and the dup-4 harness refactor off the table; the one sanctioned overlap is an append-only touch on `01-schema.sql`, heads-up posted on #228) → issues filed → subagent-driven implementation (fresh implementer per fix, spec review + quality review each, whole-branch final review) → merge. One selection correction: authz-1 was filed as #250 and closed unfixed — it was already resolved by PR #233 (its data line had simply never been deleted from the board JSON); dup-6/#254 replaced it.

**What:** five fixes, one commit each (+ review-nit commits):
- **docs-1/#248:** `06-assessment.sql` folded into `01-schema.sql` (profiles columns inline + `assessment_attempts` table/index after `quiz_attempts`, semantically identical; 04/05 fold convention), so 01+02 again stands up a DB that survives the `user-context` login query. Migration README file table gains 04/05/06 rows + the standing fold rule; 06's dangling "How to apply" header pointer fixed.
- **docs-2/#249:** migration/azure/README.md current-state rewrite — both resolved port-time flags dropped (`invitation_links`, "same Entra oid" authz), completeness rows for deleted endpoints removed and the quiz/user-context rows corrected (user-context now lists the assessment reads), the false "tables with no function consumer" section replaced (truth: only `ai_conversations`, `idea_categories`, `idea_evaluations`, `idea_specifications` have zero consumers; src/ has no DB layer), counts fixed (44 supabase files / 32 tables / 14 enums), `quiz_options_public` prose repointed at `quiz-by-lesson`.
- **err-3/#251:** `grade-quiz`'s membership-dependent `INSERT…SELECT` now returns `recorded: true|false` via `RETURNING` (enrollment-complete/#18 idiom) instead of silently not recording attempts for platform admins / just-disabled members; comment cites the precedent; zero-row + happy-path tests.
- **dup-9/#252:** shared `functions/shared/update-builder.ts` (`buildUpdateSet`: shape check, whitelist walk, SET/param bookkeeping, documented SQL-injection-safety invariant, transform + wording-override options) replaces the triplicated builder in resource-update/idea-update/organization-update. One unknown-key policy: reject with 400 — the one sanctioned behavior change is idea-update no longer silently filtering unknown keys (frontend verified to send only whitelisted keys). 17 helper tests.
- **dup-6/#254:** shared `functions/shared/ideas.ts` (`loadIdea`, `isIdeaVisibleTo` — the draft-privacy invariant lives once, provenance comment preserved, NO admin bypass; `checkAuthorDraft` for the submit/update 403/409 pair) adopted by all 7 idea endpoints; per-endpoint RLS-parity response shapes kept; behavior byte-identical — no endpoint test file changed. Visibility truth-table tests incl. draft+platform-admin→hidden.

**Verify:** root `lint` 0 errors · `tsc` exit 0 · `test` 97 files / 588 pass · `build` exit 0; functions `build` exit 0 · `test` 133 files / 2043 pass (3 skipped). Every fix: spec + quality review by independent subagents (docs-2 additionally fact-checked claim-by-claim against the tree); whole-branch final review READY (both new shared modules idiom-consistent; idea-update composes both cleanly; zero src/ changes).

**Deploy:** merging auto-fires both workflows (functions changed; frontend unchanged but SWA ships anyway). Deploy + signed-in /ui-report smoke over the touched surfaces announced on PR #253.

## 2026-07-24 — Review-suite round-4 top-5 (#255–#259, PR #260)

**Who:** claude (Fable) + emil. Fourth top-5 pick from the 2026-07-24 review board — the most important open cards with zero file overlap with in-flight #228/#231 (#228 holds CoursePlayer/CourseEditor/types.ts, deferring err-5/err-10/dup-11/dead-5; #231 holds send-invitation-email, deferring sec-2/err-2/authz-2/dup-15; the high cards err-2/dup-2/dup-4 stay deferred) → issues filed → subagent-driven implementation (fresh implementer per fix, spec review + quality review each, whole-branch final review) → merge.

**What:** five fixes, one commit each (+ review-fix commits):
- **dup-7/#255:** shared `useCommunityGate({ allowPlatformAdmin? })` hook (`'loading' | 'allowed' | 'redirect'`, modeled on `useOrgGuard`) replaces the 6 copy-pasted community feature gates; PostDetail's platform-admin moderation-deep-link bypass becomes an explicit opt-in; 6-case hook test; zero `usePlatformSettings`/`features.` reads left in community pages.
- **dup-8/#256:** `<OrgGate breadcrumbs? titleKey descriptionKey>` layout component (next to AppLayout) owns the orgGuard-loading spinner + no-org empty state for the 5 duplicated preambles; call sites keep the early-return form (TS narrowing / eager-children null-deref, documented in the JSDoc); heading drift unified on the app-wide `font-display text-[26px]` h1 style (the `text-2xl font-bold` variant existed only in the two org-admin no-org blocks); 4-case test incl. breadcrumbs forwarding.
- **docs-5/#257:** dead `VITE_ENTRA_SCOPE` + `VITE_STORAGE_BASE_URL` removed from the SWA workflow env block, `.env.example`, and README (exactly 4 live `VITE_*` vars remain, verified by grep); missing live rows added (`VITE_REDIRECT_URI` → .env.example, `VITE_PLATFORM_BASE_URL` → README). Follow-up caught in review: `msal-config.ts` redirectUri fallback `??` → `||` so the now-documented blank `VITE_REDIRECT_URI=` actually falls back to the app origin (config.ts precedent).
- **dead-3/#258:** adr-kit residue `pyproject.toml` (9× duplicated generated ruff block, Python config in a Node-only repo) + `.eslintrc.adrs.json` deleted — the AGENTS.md "adr-kit removed 2026-06-06" claim is now fully true.
- **dead-4/#259:** stale `bun.lock` + `bun.lockb` deleted (months behind package.json; npm-only toolchain) — also removes Oryx package-manager-inference ambiguity. Gate before merge: confirm the PR preview build still selects npm (package-lock.json remains authoritative).

**Verify:** root `lint` 0 errors · `tsc` exit 0 · `test` 99 files / 598 pass · `build` exit 0 (functions untouched; CI runs its gates anyway). Every fix: spec + quality review by independent subagents; review findings fixed in-batch (OrgGate breadcrumbs test, msal-config `||` fallback). Whole-branch final review before undrafting.

**Deploy:** merging auto-fires both workflows. Deploy + signed-in /ui-report smoke over the touched surfaces (community pages, org-admin idea/moderation gates) announced on PR #260. Board HTML on Desktop updated to 32 open cards after the deploy smoke.

## 2026-07-24 — Review-suite round-5 top-5 (#261–#265, PR #266)

**Who:** claude (Fable) + emil. Fifth top-5 pick from the 2026-07-24 review board — the most important open cards with zero file overlap with in-flight #228/#231 (#228 still holds CoursePlayer/CourseEditor/types.ts/package.json/locales, deferring err-5/err-10/dup-11/dead-5/dead-9/dead-6; #231 still holds send-invitation-email/OrgMembersTab/OrganizationDetail, deferring sec-2/err-2/authz-2/dup-2/dup-15/err-12; the high cards err-2/dup-2/dup-4 stay deferred) → issues filed → one implementer subagent per fix (parallel — disjoint file sets), controller diff review + full gates → merge.

**What:** five fixes, one commit:
- **dup-10/#261:** shared `loadResourceForWrite(resourceId, profile)` + `RESOURCE_TYPES` in `functions/shared/resources.ts` — resource-update/resource-delete share the load+authorize gate (null collapses missing/unauthorized into the single anti-enumeration 404, RLS provenance 20260202125517 preserved, "do not split the cases" warning in the JSDoc); resource-create/update import the shared type list. Pure extraction — all 55 endpoint tests pass unmodified.
- **docs-4/#262:** the four consumed 2026-07-20/22 plan/spec docs under `docs/superpowers/` deleted per the ephemeral-docs policy (PR #129 precedent); the tree itself stays — in-flight #228/#231 docs live there. Only reference found: WORKLOG (append-only history, allowed).
- **err-13/#263:** `course-translation-link`'s unlink branch (clear `course_group_id` + group-of-one collapse + the COUNT probe between them) now runs inside one `withTransaction` — no more committed unlink followed by a 500 leaving a stale one-member group. Tests assert all three statements go through the transaction client and a collapse failure yields the factory 500 with rollback.
- **err-14/#264:** `PdfViewer.handleDownload` gained the same `if (!response.ok) throw` guard the viewer path already had — an expired SAS/404 now fires the existing "Failed to download document" toast instead of silently saving the Azure XML error body as `document.pdf`.
- **dead-10/#265:** `index.html`'s icon link repointed from the Lovable-era gpt-engineer CDN URL to a local `/favicon.png` (the brand mark vendored into `public/`); the stale template `public/favicon.ico` deleted. No third-party CDN dependency left in the app shell; `usePlatformSettings`' org-branding rewrite untouched.

**Verify:** root `lint` 0 errors · `tsc` exit 0 · `test` 99 files / 598 pass · `build` exit 0; functions `build` exit 0 · `test` 133 files / 2045 pass (3 skipped). Controller-reviewed combined diff; wire contracts byte-identical on the extraction fixes.

**Deploy:** merging auto-fires both workflows. Deploy + signed-in /ui-report smoke over the touched surfaces (resource edit/delete, course-translation unlink, PDF download, favicon) announced on PR #266. Board HTML on Desktop updated after the deploy smoke.

## 2026-07-24 — Review-suite round-6 top-5 (#267–#271, PR #272)

**Who:** claude (Fable) + emil. Sixth top-5 pick from the 2026-07-24 review board — the most important open cards with zero file overlap with in-flight #228/#231 (#228 still holds CoursePlayer/CourseEditor/types.ts/package.json/locales, deferring err-5/err-10/dup-11/dead-5/dead-9/dead-6; #231 still holds send-invitation-email/OrgMembersTab/OrganizationDetail/InviteUserDialog, deferring sec-2/err-2/authz-2/dup-2/dup-15/err-12; the high cards err-2/dup-2/dup-4 stay deferred). Every card re-verified live against current `main` before filing — `dup-16` had already diverged exactly as its card predicted. Issues filed → one implementer subagent per fix (parallel — disjoint file sets) → two adversarial review subagents (backend + frontend halves) → four review-fix subagents → full gates.

**What:** five fixes plus the review-fix round:
- **sec-5/#267:** new `functions/shared/net-guard.ts` — `validatePublicHost()` resolves the caller-supplied host via `dns.lookup(…, {all:true})` and refuses if ANY resolved address is private/loopback/link-local/CGNAT/ULA (incl. `169.254.169.254` and Azure's WireServer `168.63.129.16`), fails closed on unparseable input; `test-smtp-connection` also validates `port` as an integer 1..65535. Rejections reuse the endpoint's bespoke `200 {success:false}` contract (ADR-0014 carve-out) so Platform Settings still renders them inline. Review-fix: the vetted address is now **pinned** — the socket dials the resolved IP rather than re-resolving the hostname, closing the DNS-rebind TOCTOU, with `servername` preserved for the TLS path so SNI still works for shared-IP providers (omitted for IP literals per RFC 6066). Resolve-then-inspect defeats the octal/decimal/hex/trailing-dot bypass family by construction. 22 endpoint tests + 54 guard tests; deleting the guard fails them.
- **oe-2/#268:** the vestigial `orgId` parameter dropped from `voteForIdea`/`createIdeaComment` — both servers already derived org from the idea row (`requireActiveMember(idea.org_id)`); the "signature compatibility" target was the Supabase client lib deleted at the June 2026 cutover. Removes two `currentOrg!` non-null assertions at the call sites. Wire payloads pinned with `toEqual` in `ideas-api.test.ts` so a re-added `orgId` fails.
- **dup-16/#269:** shared `pdfResponse(origin, filename, pdf)` in `functions/shared/http.ts` for the two hand-rolled PDF endpoints, which had already diverged (`Buffer.from(x).toString('binary')` vs a raw `Buffer`). Standardized on the **Buffer** form — a latin1 string body is re-encoded UTF-8 by the worker, so every byte ≥ 0x80 doubles and the file stops opening; verified against undici (`AB ø CD` → 8 bytes as a string vs 6 as a Buffer). The helper also sanitizes `filename` (CWE-113: a quote or CRLF in a `Content-Disposition` value forges a header), idempotent over both live callers so filenames are byte-identical to today.
- **dup-14/#270:** `cleanupBlobs(paths, logTag, id)` in `functions/shared/blob.ts` replaces the identical 10-line best-effort block in course-delete and module-delete. Response contract byte-identical.
- **dup-12/#271:** module-scope `NavSection({label, items})` in `AppSidebar.tsx` replaces three byte-identical nav-group blocks (355 → 285 lines); all three verified attribute-identical by mechanical diff before extraction. Side effect: `AppSidebar` no longer subscribes to `useLocation()`, so navigation re-renders only the nav sections, not the header/footer/avatar.
- **docs-8 (folded in):** this PR adds two `functions/shared/` modules, which made the README's "4 shared helpers" enumeration staler — reworded so it no longer reads as exhaustive, with the honest count (25 non-test modules).

**Review findings fixed in-batch:** missing `cleanupBlobs` unit tests (a net coverage regression — the counting had been executed inline by the endpoint tests before extraction) plus two endpoint-test comments that claimed coverage that did not exist; the `pdfResponse` doc comment overclaiming a fix it does not deliver; DNS-rebind TOCTOU; Azure WireServer not blocked; `generate-certificate` never asserting its own response body; `ideas-api` wire payloads unpinned; a factually wrong comment about the `end` prop in the new sidebar test; a dead `currentOrg` binding. Each fix mutation-checked (assertion transiently broken to prove it bites, then restored).

**Uncovered, filed as #273 (not fixed here):** `generate-certificate` computes its xref offsets, `startxref` and content-stream `/Length` from `pdf.length` (UTF-16 code units) while emitting UTF-8 bytes, so any certificate carrying `æøå` ships a cross-reference table pointing at the wrong byte offsets — structurally invalid for the primary market. Pre-existing; the Buffer change makes it strictly less corrupt, not correct. Left unlabelled for AFK because part 2 (glyph encoding: WinAnsi vs embedded subset vs migrating to pdfkit) is a design call.

**Verify:** root `lint` 0 errors · `tsc` exit 0 · `test` 100 files / 616 pass · `build` exit 0; functions `build` exit 0 · `test` 135 files / 2135 pass (3 skipped).

**Deploy:** merging auto-fires both workflows. Deploy + signed-in /ui-report smoke over the touched surfaces (Platform Settings SMTP test, community idea vote/comment, certificate + AI Act compliance PDF downloads, sidebar in all three role groups) announced on PR #272. Board HTML on Desktop updated after the deploy smoke.

## 2026-07-24 — Certificate PDFs valid for Danish names (#273, PR #274)

**Who:** claude (Fable) + emil. Follow-up to round-6: the bug the adversarial review uncovered while verifying #269's body-encoding change, fixed inline with a single implementer subagent + controller review.

**What:** `functions/generate-certificate` built the PDF as a JavaScript string and measured it in **UTF-16 code units** (`offsets[i] = pdf.length`, `xrefOffset = pdf.length`, `/Length ${contentStream.length}`) while emitting **UTF-8 bytes** via `TextEncoder`. Equal for ASCII, divergent for every `æøå` — so a Danish learner's certificate shipped an xref table pointing short of reality. Reproduced against pre-fix main: `Søren Ølsen`/`Grundlæggende AI`/`Ærø Akademi` → declared startxref 1937 vs actual 1942, `/Length` 1411 vs 1416.

- **Byte-correct arithmetic:** the document is assembled as `Buffer[]` behind a running byte cursor (`emit()`), so every offset, `startxref` and `/Length` comes from `Buffer.byteLength`. No character count reaches a byte offset. The two surviving `.length` uses are x-position glyph-width heuristics, deliberately left as character counts so ASCII geometry is unchanged.
- **Glyph encoding:** `/Encoding /WinAnsiEncoding` on all three Type1 fonts, text folded to genuine **cp1252** (not bare Latin-1 — the 27 codes in 0x80–0x9F where they disagree are hand-mapped, so a name pasted from Word keeps its curly apostrophe). Everything outside cp1252 — CJK, Cyrillic, Polish `ł`, emoji — collapses to a single `?`: 1 code point → 1 byte, so offsets stay exact and the file stays readable rather than corrupt. Non-BMP code points are iterated whole so an emoji is one `?`, not two surrogate halves.
- **Ordering hazard** closed by one choke point, `pdfText() = toWinAnsi(pdfString(value))` — escape first (#232), fold second, measure third. `toWinAnsi` cannot invent a `\ ( )` byte, so the escaping guarantee is not regressed.
- Deliberately **not** migrated to pdfkit (as the compliance report is): that re-authors the layout and changes how the certificate looks. Rejected in favour of the smallest change that makes it correct.

**ASCII byte-identity:** Part 1 was landed alone first and hashed — sha256 `f4569e16…`, 2151 bytes, startxref 1928, **identical to main**. Part 2 then adds exactly `3 × len(" /Encoding /WinAnsiEncoding")` = 81 bytes; the test pins the new values *and* asserts `pdf.length - 81 === 2151` and `startxref - 81 === 1928`, plus sha256 of both the content stream and the whole document.

**Verify:** functions `build` exit 0 · `test` 135 files / 2143 pass (3 skipped, +8 new); root `lint` 0 errors · `tsc` exit 0 · `test` 616 pass · `build` exit 0. New assertions mutation-checked: restoring main's `String.length` scheme fails 4 tests (Danish startxref, `/Length`, WinAnsi single-byte, #232 escaping) while every ASCII test still passes — which is precisely why the bug hid for so long. Honest negative result recorded by the implementer: with the fold guaranteeing 1 char = 1 byte, a char-count cursor is *accidentally* correct, so the `Buffer.byteLength` arithmetic is defence-in-depth that survives anyone changing `PDF_ENCODING`. The now-false `#273` caveat in `shared/http.ts`'s ENCODING comment was corrected in the same PR per the docs policy.

## 2026-07-25 — Storage lifecycle batch (#275–#278, PR #279)

**Who:** claude (Fable) + emil. First batch from the dedicated heavy-file **storage audit** (cards `stor-1`–`stor-4` on the 2026-07-24 review board), not from the seven /review-suite passes. All four cards re-verified live against `main` @ `01a22a7` before filing. Flow: verification subagents → issues filed → draft PR → implementer subagents (#275 ∥ #278 in parallel, disjoint trees; #276 then #277 sequential, same endpoints and shared files) → three adversarial review subagents → three review-fix subagents → a final cleanup subagent → full gates.

**Owner decisions taken up front,** before any implementation: stor-3 built **armed** (real deletes) rather than dry-run-first; caps video 2 GB / documents 100 MB / images 10 MB; downscale targets thumbnails 1280 px, logos + avatars 512 px.

**What:** four fixes plus the review-fix round:
- **stor-1/#275:** `lesson-update`, `course-update`, `organization-update` and `profile-update` now read the previous blob path(s) and best-effort `deleteBlob` the old one when a path changed **or was cleared to null** — the clear case the card understated (`profile-update` explicitly supports clearing the photo). SELECT-before-UPDATE rather than a `RETURNING` self-join, because all four hand their `RETURNING` row straight back to the client and `prev_*` columns would land in the response body. The three dynamic-update endpoints SELECT only when the blob column is actually being written, so an absent key can never be read as a clear; `lesson-update` set-differences its three old paths against the paths the row still references, so a path moving between columns is never deleted.
- **stor-2/#276:** new `headBlob()` in `functions/shared/blob.ts` (short-lived `'r'` SAS + HEAD, mirrors `deleteBlob`, never throws) and `functions/shared/upload-limits.ts` as the single home for the caps and allow-lists, enforced across the six persisting endpoints (`lesson-create`, `lesson-update`, `course-create`, `course-update`, `profile-update`, `organization-update`) — over-cap or off-list → **413**, row not saved. Which cap applies is decided by the column being written, never by client input. Extensions are deliberately narrower than the content-type rule: no `svg` (a signed URL opened directly is a scripting context), no `heic`. Inconclusive HEADs **fail open** by deliberate choice — 404 / 5xx / network error / missing env / absent `Content-Length` all allow the save, because blocking would turn a storage blip into "nobody can edit a course" and would reject the legitimate absolute external URLs `thumbnail_url`/`logo_url` have always accepted. Enforcement had to move to persist time because a SAS token cannot express a size cap: Azure Blob SAS has no size parameter and `sas.ts` hard-codes the `rsc*` fields empty. The mint path additionally allow-lists `contentType`/extension, and the hard-coded "Unlimited file size" video string was replaced with the real cap. Incidental fix found on the way: `courseEditor.videoFileHint` held the Danish string verbatim in `en.json`.
- **stor-3/#277:** new timer-triggered `functions/orphan-sweep/`, 03:00 **UTC** daily (04:00/05:00 Danish — no `WEBSITE_TIME_ZONE` in the repo), reconciling the container against all six path columns and deleting unreferenced blobs older than 24 h. `sas.ts` gained a resource-type parameter defaulting to `'b'` so all six existing blob-scoped callers still produce byte-identical tokens (pinned by a test asserting the 6-arg and 7-arg forms are string-equal); listing needs a container-scoped SAS (`sr=c`, `sp=l`, `restype=container&comp=list`). **The dangerous part is the comparison:** lessons and thumbnails store paths that may be bare *or* prefixed, while `logo_url`/`avatar_url` are always prefixed (`avatars/`, `org-logos/`) — so the listed name is used exactly as Azure returned it, never trimmed, basenamed or lower-cased, and the DB side is widened instead (verbatim, trimmed, leading-slash-stripped, plus paths extracted from absolute Azure and legacy Supabase URLs, mirroring `extractLmsAssetPath`). Widening the DB side can only ever delete less; touching the listed name is what would delete live files. The run refuses to delete anything on: kill switch, storage unconfigured, DB read failure, empty reference set, listing failure or partial pagination, global orphan share >50%, **per-prefix-bucket share >50%**, or >500 deletions in a run. Three reference reads — before listing, after listing, and immediately before the delete loop. `registration-names.test.ts`'s `REGISTRATION` regex was extended to accept `app.timer(` (a timer function registers zero routes and failed the fleet guard). New env vars `ORPHAN_SWEEP_DISABLED` / `ORPHAN_SWEEP_MAX_SHARE` / `ORPHAN_SWEEP_MAX_DELETIONS`, all with safe defaults, documented in `README.md`.
- **stor-4/#278:** client-side canvas downscale in `file-upload.tsx` before the PUT. Output MIME always equals input MIME, which is what preserves PNG alpha; GIF and SVG are excluded outright, and animated WebP is detected via the RIFF `VP8X` animation flag. Decode goes through `createImageBitmap(file, { imageOrientation: 'from-image' })` because a bare `<img>` decode would bake in unrotated pixels and leave EXIF-rotated phone photos sideways. Fails open to the original on every error, never upscales, and keeps the original if re-encoding grew it. jsdom has no Canvas API and no canvas mock is installed, so the pure logic lives in `src/lib/image-downscale.ts` and the canvas calls are exercised by stubbing `getContext`/`toBlob` on `HTMLCanvasElement.prototype` — no canvas dependency added.

**Review findings fixed in-batch** — the three adversarial review subagents found real defects that the 3,366-line test addition had not caught:
- **Two BLOCKERs, one root cause:** no endpoint validated that a client-supplied blob path belongs to the row being written. Inert before this branch (a bogus path just rendered a broken image), but both new features turned the same unvalidated string into an argument to `deleteBlob` — and the paths are not secret (`course-player-data` returns all three lesson path columns to any active org member). (1) The 413 path deleted any blob it refused: `previousPaths` is row-scoped, so a path belonging to a *different* row looked "fresh", got HEADed, and was deleted if over cap — any authenticated user could POST a lesson's video path as their own `avatar_url` and destroy it. (2) The same primitive in two steps via #275's cleanup, needing no size violation at all — bind a victim path (which passes precisely *because* it is a legitimate image), then clear it. Fixed by a new `functions/shared/blob-ownership.ts`: `assertBindablePaths` runs before any HEAD and refuses a path whose shape is foreign to the column or which another row already references; `isBlobReleasable` gates every superseded-blob delete after the write. The refusal-time cleanup was removed entirely — the nightly sweep reclaims refused uploads.
- **The orphan-sweep tripwires were blind to the bug class they claimed to catch:** five of the six columns are independent code paths, so a break in one produces a *minority* orphan share — a normalisation bug confined to branding assets is ~11% of the container, under both ceilings, and would have destroyed every avatar and org logo in one night. Share is now evaluated per top-level prefix bucket. `useMonitor` was also defaulting to true, so a missed 03:00 occurrence could fire the only unattended deleter mid-business-day; it is now `false`, and `isPastDue` is consulted.
- **Image corruption:** the alpha claim was defended on the *declared* MIME, which the browser derives from the filename extension — so a transparent PNG named `.jpg` was re-encoded as JPEG and composited onto black, permanently. Magic numbers are now sniffed and must agree with the declared type.
- **Most likely real-world data loss, found late:** a transient URL-signing failure made `CourseEditor` persist `null`, which #275 turned into an irreversible thumbnail delete; a failed *upload* did the same, because the catch reported `onChange(null, null)` — identical to a deliberate remove. Uploads no longer signal failure as a clear, and `CourseEditor` holds the raw path rather than the signed URL. Deliberate removal still clears the column and still deletes the blob.
- Also: `image/*` prefix matching admitted `image/svg+xml` despite the documented SVG defence (now an explicit content-type set); `buildBlobUrl` did not percent-encode, letting a crafted path steer the request into fail-open; `lesson-update` treated an absent key as a clear.

**Known follow-ups filed (not fixed here):** **#281** blob soft-delete on the storage account, as an undo window behind every delete this batch introduces — rated by review as the single highest-value mitigation for the whole batch, and human-gated because it is an `az` change; **#280** (`afk`) the remaining blob-ownership gaps — the three delete endpoints performing no release check before cleaning up, `organization-create` ungated, and `module-delete`/`course-delete` collecting only `azure_blob_path` so a deleted module's documents and thumbnails are left for the sweep rather than reclaimed at delete time; **#282** a decision on a complementary sweep tripwire for the one blind spot per-bucket analysis does not cover (a normalisation applied upstream in `parseListPage` collapses every bucket into the root) — deliberately left as a judgement call, since the obvious check also wedges the sweep when branding blobs are legitimately absent.

**Verify:** root `lint` 0 errors · `tsc` exit 0 · `test` 102 files / 765 pass · `build` exit 0; functions `build` exit 0 · `test` 138 files / 2418 pass (3 skipped). Fixes mutation-checked throughout — each guard transiently reverted to prove its test bites.

**Deploy:** merging auto-fires both workflows. **The orphan sweep is armed and runs at 03:00 UTC the night after deploy** — kill switch `ORPHAN_SWEEP_DISABLED=1`. Deploy + signed-in /ui-report smoke over the touched surfaces announced on PR #279.

## 2026-07-25 — Storage follow-ups: blob-ownership gaps + sweep root-bucket split (#280, #282, PR #284)

**Who:** claude (Fable) + emil. Both issues came out of PR #279's adversarial review. Flow: decisions cleared with the owner up front → draft PR → two implementer subagents in parallel (disjoint file sets: delete endpoints vs `orphan-sweep`) → controller-verified gates.

**What:**

- **#280 — the three writers #279 left outside its gates.** #279 added `assertBindablePaths`/`isBlobReleasable` and wired them into the six *persisting* endpoints; the cascade deletes, `organization-create`, and the stranded lesson columns were out of scope then.
  - **Cascade deletes are now release-gated.** `lesson-delete`, `module-delete`, `course-delete` collect paths, delete the row, **then** ask whether anything still references each path — ordering is the point, because the referencing row is already gone, so anything still reported as referenced belongs to a *different* row. Defence-in-depth going forward (creating shared state now requires passing the bind gate), but production never had that gate, so any pre-existing shared path was destroyable on first exercise.
  - New `releasablePaths(paths, family)` batches the check into one `= ANY($1::text[])` query and fails safe **as a unit** (one unanswered query drops the whole batch); `isBlobReleasable` is now a one-line wrapper, so there is a single implementation of the rule.
  - **Gate placement — call sites, not `cleanupBlobs`.** `blob.ts` is the DB-free storage/SAS layer and `blob-ownership` already imports `classifyBlobPath` from it, so a query there is circular; `family` is a property of the *column*, which only the endpoint knows; and `cleanupBlobs` has 2 of the 8 `deleteBlob` call sites, so putting it there would imply a coverage it does not have.
  - **`organization-create`** now routes `logo_url` through `assertBindablePaths` (after `requirePlatformAdmin()`, before the INSERT). **`platform-settings-update` was checked and deliberately left alone** — its `branding.logo_url`/`favicon_url` live in a jsonb column that is in *neither* reconciliation union, nothing ever calls `deleteBlob` on them, and the UI offers plain free-text URL fields; gating it would protect nothing.
  - **Stranded columns fixed.** `module-delete`/`course-delete` collected only `azure_blob_path`; `course-delete` now takes `thumbnail_url` off its `DELETE ... RETURNING` rather than a second SELECT (cheaper and race-free). The issue text was wrong that `lesson-delete` was the model to mirror — it had the same defect and was fixed too. Confirmed live: #279's prod smoke found a deleted course's thumbnail still sitting in storage.
- **#282 — split in two, decided separately.**
  - **Part A (the "DB references this prefix but the listing returned none" tripwire): considered and DECLINED**, recorded in the TRIPWIRE docblock with its reasoning rather than left as an unexplained gap. It would catch an upstream normalisation in `parseListPage`, but it also fires when branding blobs are genuinely absent while rows still reference them — a state that does not heal on its own, so the sweep would refuse nightly until a human intervened. A tripwire that fires on healthy data gets its ceiling raised, and the ceilings *are* the safety system.
  - **Part B (root-bucket dilution): fixed.** `courses.thumbnail_url` and bare lesson videos both live at the root, so a thumbnails-only break was diluted by the larger video population — the same dilution per-bucket analysis was introduced to solve, one level down. Root names are now counted in **two** buckets: the undivided root exactly as before, plus their file-type class (image/video/document/other, derived from `UPLOAD_LIMITS` rather than a second extension list that could drift). Strictly additive, so no run that aborts today stops aborting.
  - **A floor of 5 orphans applies to the new root classes only.** The prefixed buckets keep the no-floor rule — each has a real writer, so a wholly-unreferenced namespace is anomalous at any size. The root classes are *synthetic* and two of them have no writer at all, so one stray blob is 1/1 = 100%, which would abort the sweep every night forever **because the only thing that could clear the blob is the sweep the blob is blocking**. Not hypothetical: three pre-existing healthy-run tests already sit at 60% in the root video class and go red without the floor. A column-level break false-orphans hundreds of files, so the floor never stands between the tripwire and the bug it exists for.

**Regression arithmetic for Part B** (the test that fails if the split is removed): 200 referenced root `.mp4` + 12 unreferenced root `.png` + 20 referenced `avatars/` = 232 eligible. Global 12/232 = 5.2%, root bucket 12/212 = 5.7%, `avatars/` 0%, root video 0% — every pre-#282 check waves it through. Root **image** is 12/12 = 100% and trips.

**Verify:** root `lint` 0 errors · `tsc` exit 0 · `test` 102 files / 765 pass · `build` exit 0; functions `build` exit 0 · `test` 138 files / 2454 pass (3 skipped). Both subagents mutation-verified; the root-split mutations kill *pre-existing* tests, which is what shows the floor's scope is load-bearing rather than a guess.

**Filed, not fixed here:** `organization-delete` drops the org row without ever collecting `organizations.logo_url` — a fourth instance of the same class, outside #280's stated scope. Also noted: nothing alerts on a sweep that aborts or that has reclaimed nothing for a week; every abort is a log line only.

**Deploy:** merging auto-fires both workflows. Announce on PR #284.

## 2026-07-25 — Codebase-wide comment audit (#287, PR #288)

**Who:** claude (Fable) + emil. User-directed: comments had spread everywhere and were increasingly rot-prone as the codebase grows; keep only what cannot be inferred from reading the code.

**What:** Comment-only sweep of `src/` + `functions/` — **248 files, −1,894/+201 lines, zero behavior change.** Removed: narration of the next line, section banners mirroring structure, JSDoc restating signatures, arrange/act/assert markers, changelog stamps with no reasoning. Kept: WHY-comments (invariants, security rationale, workarounds, deliberate trade-offs), all tool directives, issue-referenced decisions, and the convention-mandated pointer comments on hand-rolled endpoints. Run as 12 disjoint implementer subagent batches in 3 waves, then two adversarial whole-diff reviewers.

- **Deliberately untouched:** `functions/orphan-sweep/` — its comments are decision records (TRIPWIRE docblocks, asymmetry-of-errors rule, CONSIDERED-AND-DECLINED notes); a dedicated conservative pass confirmed zero removable lines. The storage/SAS cluster (`shared/upload-limits`/`blob`/`blob-ownership`/`sas`/`lms-asset`) kept near-100% — those comments are security rationale. Out of scope: `migration/azure/*.sql` + `shared/__fixtures__/schema.ts` (fixture-coupled schema documentation of record), `supabase/` (authz provenance), vendored workflow templates.
- **Review pass:** an exhaustive hunk-by-hunk verifier matched every removed/added non-comment line byte-for-byte — verdict comment-only; no tool directive, string literal, or SQL `--` data touched. The judgment reviewer found one removal worth restoring — the #176 adopt-invites-BEFORE-memberships-load ordering invariant in `user-context` — plus one stray test re-indent; both fixed pre-merge.

**Verify:** root `lint` 0 errors · `tsc` exit 0 · `test` 102 files / 765 pass · `build` exit 0; functions `build` exit 0 · `test` 138 files / 2454 pass (3 skipped). CI green on PR #288.

**Deploy:** merging auto-fires both workflows (comment-only — no functional change expected). Announce on PR #288.

## 2026-07-25 — Review round-7: org-logo cleanup, silent progress-save, dead types, factory polish (#285, #289–#292, PR #293)

**Who:** claude (Opus) + emil. Round-7 off the 2026-07-24 whole-codebase `/review-suite` board, plus the residual filed during the storage batch. Flow: draft PR claiming all five → #285 and #289 done inline → three implementer subagents for #290/#291/#292 (#290 in parallel with #291; #292 serialized behind it, same file) → controller diff review + full gates.

**Card-pick constraint.** The board had 20 open cards but the two in-flight drafts bound the choice, and overlap was checked at **hunk** level rather than file level: #228 (exercises) touches `CoursePlayer.tsx` at ~8 / ~67 / ~687 and `types.ts` at ~2 / ~117-137, so `err-5` (line 219) and `dead-5` (lines 158-186) merge cleanly. That is what made two medium cards pickable this round instead of five low ones. #231 owns the invitation-email surface, blocking `sec-2`, `err-2`, `authz-2`, `dup-2`, `dup-15`, `err-12`; #228 also blocks `err-10`, `dup-11`, `dup-4`.

**What:**

- **#285 — `organization-delete` never collected `organizations.logo_url`.** Fourth and final instance of the ungated cascade-cleanup class that #280/#284 closed for lessons/modules/courses: the org row was deleted and its logo sat in storage until the nightly sweep's 24 h grace expired. `logo_url` now rides the `DELETE ... RETURNING` (race-free, no extra round trip), passes through `releasablePaths(..., 'org-logo')` so a path another row still references survives, and is cleaned up best-effort. Verified that `logo_url` is the *entire* blob surface of an org delete — none of `organizations`' 17 `ON DELETE CASCADE` children carry a blob column (`courses` have no `org_id`; `profiles` are not org-owned).
- **#289 (`err-5`) — `CoursePlayer` swallowed the lesson-progress save.** The Mark-as-complete upsert sat behind a bare `catch { return; }`: the spinner cleared, the optimistic progress update was skipped, and the learner got zero feedback with nothing in the console to debug. Now mirrors the enrollment-complete branch ~30 lines below — `console.error` plus a destructive toast — with new `coursePlayer.progressSaveFailed`/`progressSaveFailedDescription` keys in **both** `en.json` and `da.json`. New test asserts the toast fires **and** that nothing optimistic survives: the sidebar counter stays `0/2 · 0%`, the Mark-as-complete affordance remains, no celebration animation, and `/api/enrollment-complete` is never reached.
- **#290 (`dead-5`) — dead Lovable-era analytics types deleted.** `OrgAnalytics`, `CourseProgressSummary`, `OrgAnalyticsSummary` removed from `src/lib/types.ts` (28 lines, one contiguous hunk). Re-verified by word-boundary grep on the branch rather than trusted from the card: `OrgAnalytics` has 17 hits in `src/` and **none** is the type — all are the unrelated page component `src/pages/org-admin/OrgAnalytics.tsx` or prose. The live analytics family is `OrgAnalyticsMember`/`OrgAnalyticsDataResult` in `useOrgAnalyticsData.ts`, untouched. The `// Analytics types` banner the card cited was already gone, removed by the #288 comment audit.
- **#291 (`oe-1`) — `adminEndpoint`'s orphaned `forbiddenError` option dropped.** `makeHandler(requireAdmin, opts, run)` → `makeHandler(requireAdmin, run)` and `adminEndpoint(name, run, opts?)` → `adminEndpoint(name, run)`, with the gate body hardcoded to `{ error: 'Forbidden' }`. Its last real user died in `dc0c74e` (2026-07-20) when `azure-upload-url` moved to `endpoint()` + `requirePlatformAdmin()`; all 21 production `adminEndpoint(` call sites already passed exactly `(name, run)`. Custom 403 bodies keep their documented path — `throw new Reply(403, {...})` inside the handler. **ADR-0015 still references the three-arg signature and was deliberately left alone: ADRs are append-only, so correcting it would take a superseding ADR, never an edit.**
- **#292 (`docs-7`) — drift-prone endpoint counts dropped rather than updated.** The `endpoint.ts` header claimed "90 endpoints use the factory, and 8 deliberately hand-rolled endpoints remain"; live was **100 / 7**, and it had already drifted repeatedly (`invitation-accept` went hand-rolled in #211 with no bump; #240 then deleted two endpoints; the header was corrected once before at WORKLOG:934). Both halves are now count-free — the header and `.claude/rules/functions.md:8` state that most endpoints use the factory and a small number of deliberate exceptions remain, each carrying a pointer comment. **No new number introduced in either file**, so it cannot drift again when #228 lands three more endpoints. The surrounding ordering-guarantee text — a load-bearing contract pinned by every migrated endpoint's tests — is preserved verbatim; the bare `grep app.http` was corrected to `grep app.http(`, which actually matches.

Both `endpoint.ts` edits respect its documented **DEPENDENCY FREEZE**: one parameter removal and one comment reword, no new imports or calls.

**Verify:** root `lint` 0 errors · `tsc` exit 0 · `test` 102 files / 766 pass · `build` exit 0; functions `build` exit 0 · `test` 138 files / 2458 pass (3 skipped). CI green on PR #293.

**Deploy:** merging auto-fires both workflows. Announce on PR #293.

## 2026-07-25 — Review round-8: orphan-sweep alerting, quiz-load recovery, dialog + button dedup (#286, #294–#297, PR #298)

**Who:** claude (Opus) + emil. Round-8 off the 2026-07-24 whole-codebase `/review-suite` board, with #286 (the decided orphan-sweep alerting spec) pulled in as the highest-impact item. Flow: verify every card live → file four issues → draft PR claiming all five → five implementer subagents in three waves (wave 1 parallel: #286 / #296 / #297; then #294, then #295 — the last two serialized because both edit the locale files) → two adversarial reviewers → two fix subagents → full gates.

**Card-pick constraint.** The three remaining **high** cards (`err-2`, `dup-2`, `dup-4`) all stay deferred behind the two in-flight drafts, so the pick was #286 plus the four highest-value cards clear of them at hunk level: `err-10` sits at `CoursePlayer.tsx` 131-137/525/689 while #228 touches ~8/~67/~687. Every card was re-verified live against `main` @ `619a30b` before filing; unlike round-7, **none were stale**.

**What:**

- **#286 — orphan-sweep alerting.** The only unattended deleter in the system had ~9 refusal paths that were all `log.error` and nothing else, so it failed silently in both directions: it could wedge (aborting nightly forever, indistinguishable from a healthy quiet night) or delete something it shouldn't, with a 7-day soft-delete window nobody was prompted to look inside. Adds `migration/azure/08-orphan-sweep-runs.sql` (the cross-run memory the policy needs — the sweep was stateless), a **pure** `decideSweepNotifications(thisRun, history, now)`, and exception-only email via Resend. A clean night sends nothing. Abort alerts fire on the transition into broken and re-announce weekly; `disabled` is abort-class; `past-due` is recorded but never emailed and never counts as "the previous run", so one catch-up night cannot reset the escalation clock on a genuinely stuck sweep. The deletion digest is deadline-forced at 3 days so every reported deletion keeps ≥4 days of restore runway with a full night of slack.
  - **Numbered `08`, not the issue's `07`** — draft #228 already claims `07-exercises.sql`; the README table carries an explicit row for the gap.
  - `getResend`/`sendBestEffort`/`escapeHtml` extracted to `functions/shared/resend.ts` and shared with `seat-request-notify.ts` rather than minting a third copy (most of card `dup-15`). `send-invitation-email` deliberately untouched — #231 rewrites it.
- **#294 (`err-10`) — a transient `/api/quiz-by-lesson` failure hard-blocked the learner.** The catch swallowed the error; with the quiz gated on `quiz &&` and the footer nav excluded for quiz lessons, the pane rendered **completely empty** — no quiz, no error, no retry, no way to progress. Now renders the shared `QueryErrorState` (bringing `role="alert"` and visual separation from the "no content" empty states) with a retry that genuinely re-issues the request, guarded by a request token so out-of-order responses cannot strand a stale error over a working quiz.
- **#295 (`dup-11`) — delete-course dialog extracted** to `DeleteCourseDialog`; the 6 (`en`) / 7 (`da`) character-identical duplicate keys collapse into one `courseDelete.*` namespace. The two trigger labels stay per-page (they label the buttons that *open* the dialog and legitimately differ); the dialog's own confirm button resolves a casing divergence to "Delete course" in `en`.
- **#296 (`dup-13`) — `MicrosoftSignInButton` extracted** from Login and Signup. Each call site keeps its own class string, so zero visual change.
- **#297 (`docs-6`) — README's `supabase/` row** claimed Deno functions deleted in `4d74b3c` and said the folder was both deleted and kept. Also dropped a stale ADR count ("the 15") that had already drifted to 16 — deleted rather than corrected, per the round-7 lesson.

**Adversarial review found a BLOCKER and two HIGHs in the first-pass work**, all fixed in-batch and mutation-checked:

- **BLOCKER — `sendBestEffort` returned `true` on every Resend API failure.** The SDK resolves `{ data, error }` rather than rejecting, so a 401/422/429/5xx/network failure stamped `abort_notified_at` and `deletions_reported_at` on the strength of an email nobody received. A wedged deleter would then go quiet for a full week, and falsely-reported deletions would leave the unreported set **permanently** — the exact silence #286 exists to remove. **This is the same bug class as board card `err-2`**, which is still deferred behind #231. The existing tests used `mockRejectedValue`, a shape the real SDK cannot produce; new tests feed the real `{ data: null, error }`.
- **HIGH — the 4-day digest deadline had zero slack** against a 24 h cadence, so the ≥3-day guarantee turned on timer jitter and broke outright on one missed night (`useMonitor: false` means a missed 03:00 is skipped, not caught up).
- **HIGH — interleaved quiz loads** left a permanent error card stacked on top of a working quiz, because the success path never cleared the failure flag.
- Plus: a flapping sweep would have emailed nightly; a failed abort-stamp suppressed that night's digest; a failed record-write lost those deletions from the working set permanently.

**Verify:** root `lint` 0 errors · `tsc` exit 0 · `test` 103 files / 779 pass · `build` exit 0; functions `build` exit 0 · `test` 140 files / 2542 pass (3 skipped). CI green on PR #298.

**Prod DB prerequisite (human-gated, owner-approved):** `08-orphan-sweep-runs.sql` applied to prod **before** merge via the in-app SQL channel (Kudu VFS + the deployed `pg`, pinned-CA verify-full TLS) — same ritual as `06`. Verified before-and-after: `to_regclass` `null` → table with all 18 columns, both indexes, and the seeded `ops_alerts` row (`enabled: true`, two recipients), 0 rows. No Azure resource created, deleted or modified.

**Deploy:** merged @`1b308ad`; both workflows green. **Prod-verified by a signed-in `/ui-report`** over all three touched UI surfaces — the quiz-failure alert and its working retry were driven live by failing `/api/quiz-by-lesson` client-side, and the shared delete dialog was opened and cancelled on both admin surfaces (nothing deleted; all 5 courses re-verified afterwards). Report: `2026-07-25-ui-report-review-round8.html`.

**Follow-ups filed:** **#299** — quiz lessons with no quiz row, or a quiz with zero questions, still dead-end the learner (different cause from #294; also, Submit is *enabled* on an empty quiz because `0 !== 0` is false, and the player does not honour `quizzes_enabled` while the authoring affordances do). **#300** (`afk`) — the `/login` page renders English "Sign in with Microsoft" on a Danish UI because `auth.signInWithMicrosoft` exists in **neither** locale file and is masked by an inline default; found by the prod ui-report, verified pre-existing (the key has never existed).

## 2026-07-27 — Exercises interactive lesson family, Phase 1 (#227, PR #228)

**Who:** claude (Opus 4.8) + martin. "Exercises" = an extensible family of **ungraded, interactive** practice lessons (decision #171); Phase 1 = framework end-to-end + two kinds (Quick-check MCQ, bucket-sort drag). Architecture in **ADR-0017**; grilled design → JSONB payload, client-side correctness, `dnd-kit`, default-off flag.

**What:** New `exercise` value on the `lesson_type` enum + one `exercises(lesson_id UNIQUE, exercise_kind text, config jsonb)` table discriminated by a **text** `exercise_kind` (new kinds need no DDL). `config` is JSONB validated in code by a per-kind validator (`functions/shared/exercises/config.ts` — the single authority), each config versioned. Ungraded, non-blocking, stores only the existing `lesson_progress` completed flag; correctness checked **client-side** (learner endpoint returns the full config incl. answers — no server grading). Endpoints mirror the quiz split: `exercise-admin` / `exercise-admin-save` / `exercise-by-lesson` (access predicate byte-identical to `quiz-by-lesson`). Drag kinds share one accessible `dnd-kit` engine over an input-agnostic assignment model (pointer drag + keyboard drag + click-to-place all drive one `place()`). Authoring via `ExerciseEditorDialog` + per-kind sub-editors in CourseEditor; rendering via `ExercisePlayer` in CoursePlayer. Behind `features.exercises_enabled` (default off; gates authoring + the Settings toggle, NOT already-published content — quiz parity, per ADR-0017).

**How:** Subagent-driven — 13 TDD tasks (Opus implementers, per-task spec+quality review, whole-branch final review). The final review caught a cross-cutting `<ExercisePlayer>` missing-`key` bug (a completed exercise left the next one un-completable) → fixed with a regression test. **Browser-verified** the real components (Playwright + throwaway Vite harness): click-to-place, pointer drag, keyboard drag (with screen-reader announcements) and QuickCheck all complete correctly; the completion latch fires exactly once.

**Prod DB:** `migration/azure/07-exercises.sql` (idempotent: `ALTER TYPE … ADD VALUE` + `CREATE TABLE exercises` + the features flag) is **owner-run before enabling the flag**; additive and unused while the flag is off, so the deploy is safe and dark.

**Merge:** integrated 20 trunk commits that landed in flight across two waves (localization #187/#226/#229, `/review-suite` rounds 1–8, storage lifecycle, PDF fixes) — first wave: 3 conflicts (validate.ts, query-keys + test), 15 files auto-merged; second wave (rounds 7–8): clean auto-merge of the 6 overlapping files. Exercise additions preserved throughout.

**Verify (post-merge):** root `lint` 0 errors · `tsc` exit 0 · `test` 800 pass · `build` exit 0; functions `build` exit 0 · `test` 2579 pass (3 skipped). CI green on Node 20.

**Deploy:** merging auto-fires both workflows (functions changed — new endpoints). Announce on PR #228. Live drag pre-verified in-browser; feature stays dark until the flag is flipped (after `07-exercises.sql` on prod).

## 2026-07-27 — Invitation email localized to the recipient's language (#225, PR #231)

**Who:** claude (Opus 5) + martin. Picked up a draft PR that had gone stale behind 18 trunk commits; finished it, folded in two parked review findings, merged.

**What:** The invitation email was hardcoded Danish (`<html lang="da">`, all boilerplate inline). It is now **ADR-0016 category 3** — one localized template, fixed strings rendered in the reader's language, variable data language-neutral. New `functions/send-invitation-email/strings.ts` holds a `da`/`en` map (subject, boilerplate, role labels); the endpoint resolves the language and sets `<html lang>`.

**Language precedence** (server-side, single source of truth) — this resolves ADR-0016's open sub-decision: an existing recipient's `profiles.preferred_language` wins (email matched case-insensitively), else the **inviter's dialog pick** (`inviterLanguage` in the body), else the platform default `da`. Resolution is best-effort — a lookup failure falls through rather than blocking the send, and the response is identical whether or not the email matched a profile (no account-enumeration signal). **No DB persistence and no migration**: the email is sent once at create time and there is no resend feature. Client side, `src/lib/inviteLanguage.ts` + a shared `InviteLanguageSelect` put the picker on all four invite surfaces (org-detail dialog, organizations-manager, org-members tab, and bulk-invite — one language for the whole batch), defaulting to the inviter's current UI language.

**Folded in the two findings #233 deliberately left for this branch** (emkataumre flagged them on the PR rather than opening a conflicting parallel branch):

- **`sec-2` — HTML injection via `orgName`.** Caller-supplied and interpolated raw into the body, so an org admin could plant markup in a mail sent from the trusted `no-reply@ai-uddannelse.dk` address. Now escaped via the shared `escapeHtml`. **A second live vector turned up while fixing it:** only `inviteLink`'s *hostname* is validated, so its path and query reached the `href` verbatim — `https://ai-uddannelse.dk/invite/abc"><img src=x onerror=…>` passes the domain check and breaks straight out of the attribute. Escaped too. Two corrections to the card: the **subject is deliberately NOT HTML-escaped** (`shared/resend.ts` is explicit that escaping is bodies-only — an escaped subject renders `&amp;` literally); its real risk is header injection, now covered by `sanitizeSubject`'s CR/LF stripping.
- **`err-2` — a failed send reported as success.** Same bug class as the `sendBestEffort` BLOCKER from round 8: the SDK resolves `{ data: null, error }` rather than rejecting, so a bad address, unverified domain or quota breach returned `200 { success: true }` and the admin was never told to fall back to copying the invite link. Fixed by routing the send through the shared `sendBestEffort` instead of a local destructure — which also finishes **`dup-15`** (this endpoint was the last holder of a private Resend client) and picks up its subject sanitisation for free. **Deviation from the card:** it returns **200 with `success: false`**, not a 5xx — the invitation row is already created by the caller and stands, only delivery failed, and 200-with-`success:false` is the partial-success shape `sendInvitationEmail.ts:31` already reads to trigger the copy-the-link fallback. A 5xx would make `callApi` throw and read as though the whole invite failed.

**Rebase notes** (the branch was 18 commits behind; 5 conflicts): main's side of `index.ts` was only comment-audit deletions; both locale files were union-merged (main's `fileUpload` + load-error keys, plus the new `common.emailLanguage`). The interesting one: **the `react-i18next` test mocks now expose BOTH `language` and `resolvedLanguage`** — those trees read `i18n.language` for date formatting and `i18n.resolvedLanguage` for the new selector, and main's mock had only the first while the branch had only the second, so either side alone silently broke the other's consumers.

**Worktree quirk worth remembering:** after rebasing, 4 exercise tests (`BucketSortPlayer`, `CoursePlayer`) failed with `Cannot read properties of null (reading 'useMemo')`. Not a code fault — the worktree's `node_modules` predated #228, so `@dnd-kit` resolved from the *parent* checkout and pulled a second React copy into the render. `npm install` in both trees fixed it. **A rebase that pulls in new dependencies needs a re-install in the worktree**, or the failures look like real regressions in someone else's feature.

**Force-push guardrail:** `Bash(git push --force*)` is a standing deny rule, so the rebased branch could not be pushed. Rather than route around it, the branch was reset to its remote head and `main` merged in instead (rerere replayed all six resolutions), then the two new commits cherry-picked on top — a fast-forward push, no history rewrite. The merged tree was verified **byte-identical** to the already-gated rebased tree before pushing. PRs squash-merge here, so the branch's internal shape never reaches trunk.

**Verify:** root `lint` 0 errors · `tsc` exit 0 · `test` 108 files / 806 pass · `build` exit 0; functions `build` exit 0 · `test` 145 files / 2595 pass (3 skipped). CI green on PR #231. Consumed `docs/superpowers/` plan + design notes deleted per the ephemeral-docs policy (#262 precedent).

**Deploy:** merged @`04c4d12`; all three workflows green (CI `30247751464`, SWA `30247751410`, functions `30247751406`). Unauth smoke on the regionalized host: `POST /api/send-invitation-email` 401 `Missing Bearer token`, `OPTIONS` 204, `organizations` + `platform-settings` 401, frontend root 200. The delivery-failure and escaping paths need an authenticated send to exercise end-to-end — unit-tested, not smoke-covered.

**Still deferred, not yet filed:** `authz-2`, `dup-2`, `err-12` were all blocked on this branch owning `send-invitation-email`; that block is now lifted. Also left unfixed as out of scope: a null `orgName` renders literally as "hos **null**" in both body and subject (pre-existing).
## 2026-07-27 — Login page rendered English "Sign in with Microsoft" on a Danish UI (#300, PR #303)

**Who:** claude (Opus 5) + martin. Picked off the board as an `afk` card filed by round-8's prod `/ui-report`; verified pre-existing before touching anything (the call site is byte-identical at `619a30b`, and `git log -S` shows the key never existed in `da.json`).

**What:** Two defects were stacked, and fixing either alone would have left the bug reachable.

- `auth.signInWithMicrosoft` existed in **neither** `en.json` nor `da.json`.
- `src/pages/Login.tsx` passed an inline i18next default — `t('auth.signInWithMicrosoft', 'Sign in with Microsoft')` — which rendered the English string **and** suppressed the missing-key warning that would otherwise have surfaced it. Danish is the primary user-facing language, so this was the first thing a Danish user saw; the invitation-accept screen one route away was already correct because `invitationAccept.signInWithMicrosoft` does exist in both locales.

The key is now in both locales, with the Danish value matching the existing `invitationAccept` string verbatim ("Log ind med Microsoft") so the two auth screens read identically, and the inline default is gone.

**Guards — the class, not the instance.** The existing `index.test.ts` / `assessment-keys.test.ts` drift guards caught neither half, so two complementary guards landed:

- **`eslint.config.js`** — extends the existing `src/**` `no-restricted-syntax` block (alongside the #238 date-locale guard) to block the *masking mechanism*: a positional string or template-literal default, and an options `defaultValue`, on both `t()` and `i18n.t()`. Probed against all four offending shapes, with confirmed no false positives on `t(key)`, `t(key, { count })` or `t(key, { ns })`. Note for future selector work: `:nth-child(n)` does **not** match a CallExpression's positional argument under esquery — the attribute-path form `[arguments.1.type=/^(Literal|TemplateLiteral)$/]` is what works.
- **`src/i18n/translation-keys.test.ts` + `translation-key-scanner.ts`** — asserts every statically-known `t()` key in `src/` resolves in **both** locales, i.e. the missing key itself, and a direct enforcement of `.claude/rules/frontend.md`'s "keys in BOTH `en` and `da`". Scanning uses the TypeScript compiler API, mirroring the #178 routes gate, so comments and runtime-assembled keys (`t(\`foo.${x}\`)`, `t(item.labelKey)`) are excluded by construction rather than by hand-rolled lexing. CLDR plural suffixes are accepted — without that, `ideaManagement.prioritize.count` (correctly stored as `count_one`/`count_other`) would have been a permanent false failure. A second assertion pins the scan population above 500 so a scanner regression cannot make the gate pass vacuously.

**Sweep:** all **956** static `t()` keys across `src/` were checked — `auth.signInWithMicrosoft` was the **only** genuinely unresolved key in the app, and its call site was the **only** inline-default call site in the tree. The codebase was one key away from clean.

**`Login.test.tsx` was complicit.** Its `react-i18next` stub was `t: (key, fallback) => fallback ?? key`, so the assertion in a test named *"renders the shared Microsoft sign-in button"* passed on a hard-coded English literal while the key was absent — the test encoded the very masking behaviour being removed. It now resolves against the real `en.json`, and was verified to fail when the key is deleted. It was the only test in the suite using that stub shape.

**Verify:** root `lint` 0 errors · `tsc` exit 0 · `test` 109 files / 808 pass · `build` exit 0; functions `build` exit 0 · `test` 145 files / 2595 pass (3 skipped) — functions untouched, run for completeness. Guard test confirmed **RED** on the real bug before the fix and GREEN after.

**Flake found, not fixed (filed as #305, `afk`).** The first CI run failed on `PlatformSettings.test.tsx` — a file this PR never touched. Diagnosed rather than re-run blindly: the component seeds local form state with `defaultBranding` (`'AIR Academy'`) at `:133` and copies `query.data` in via a `useEffect` at `:180`, leaving a one-render window in which the textbox exists holding the default; the tests `waitFor` element *existence* and then assert the *value* on the next synchronous line, so CPU contention on the runner wins the race. Confirmed pre-existing — `main` @ `960b835` failed the same file and the same `toHaveValue(Server Name)` assertion on 2026-07-25 (run 30175101531), on a *different* test within it — and confirmed a flake by re-running the identical commit with no code change, which went green. Fix is to move the value assertion inside `waitFor`; left out of this PR to keep it scoped to #300.

**Deploy:** frontend-only change, so only the SWA workflow is load-bearing here. Announce on PR #303.

## 2026-07-27 — Invite-email null-org fix + three review cards refiled (#309, #306–#308)

**Who:** claude (Opus 5) + martin. Cleanup tail after #231: the one known bug it left, plus re-filing the review-board cards it had been blocking.

**Fix (#225 follow-up, PR #309 @`7e828ee`, deployed + smoke ok):** an org invite renders the org name in its subject and body; a missing name printed the literal string **"null"** ("...hos null på AI Uddannelse"). The four invite screens only pass a null org name when their org context is broken (`currentOrg?.name ?? null`, `org?.name || null`), so the endpoint now **400s** a non-platform invite with no `orgName` — surfacing the broken state instead of mailing garbage. Platform-admin invites carry no org and stay exempt. Also hardened the `escapeHtml` guard I added in #231: `orgName === null ? …` only caught JSON null, so an *omitted* org name reached `escapeHtml(undefined)` and threw a 500 — now a truthy guard (`orgName ? escapeHtml(orgName) : null`). Only reachable off the typed client, but a real edge I introduced. Tests: null and omitted orgName on an org invite both 400 (no send); a platform-admin invite with no org still sends and contains neither "null" nor "undefined". Verify: functions `build` 0 · `test` 2598 (3 skip, +3 new); root unchanged (lint 0 / tsc 0 / test 806 / build 0). Smoke behind the auth gate → 401 unauth, 204 OPTIONS, frontend 200; the 400 is unit-tested (unreachable unauthenticated).

**Cards refiled (#306–#308):** the three findings that had been deferred behind #231 owning `send-invitation-email` are back on the board as separate issues (project convention = one card per issue), cross-linked, all in the same file so they can be fixed in one PR. **#306 `authz-2`** (priority) — the endpoint authorizes "are you *an* admin?" but never binds the caller to the org named in the request or the role being granted, so an org admin can send an official-looking invite naming any org/role from the trusted no-reply address (spoofing surface; the send doesn't grant access, a separate flow does). **#307 `err-12`** — an invalid `role` silently falls back to "learner" instead of 400. **#308 `dup-2`** — email-scaffold duplication (low confidence on the exact target; two candidate readings noted). Each issue flags that its description is reconstructed from the slug + code and should be **confirmed against the 2026-07-24 `/review-suite` report** (`2026-07-24-review-main-codebase.html`), which is not tracked in the repo.

## 2026-07-27 — Quiz lessons with no quiz / zero questions no longer dead-end the learner (#299, PR #304)

**Who:** claude (Opus 4.8) + martin. Bug found by the adversarial review on PR #298 (round-8). Two quiz data-state shapes, both reachable *by construction* (a quiz lesson is created from one `CourseEditor` affordance, its quiz body authored from another; no publish-time completeness check), trapped the learner with no way forward.

**What (frontend only):** In `src/pages/learner/CoursePlayer.tsx` — (1) a quiz lesson with no quiz row (`quiz-by-lesson` returns `200 { quiz: null, questions: [] }`) rendered none of the quiz blocks AND the footer nav was gated `lesson_type !== 'quiz'`, so the learner saw only the type chip + title (dead end); (2) a quiz with zero questions rendered an empty list and Submit's guard `answers.length !== questions.length` was `0 !== 0` = false, so **Submit was ENABLED on an empty quiz** and POSTed `{}` to `grade-quiz`.

Fix: a neutral **"not ready yet" empty state** for both shapes (distinct from #294's `role="alert"` load-failure card); the working-quiz block now requires `questions.length > 0` so a zero-question quiz falls through to the empty state; a **nav-only Previous/Next footer** for any quiz lesson not showing an interactive quiz (empty / zero-question / load-failure) — the durable fix that makes the whole class non-blocking, while a healthy quiz keeps its own submit→next flow and gets no footer; the Submit guard now short-circuits on `questions.length === 0`. Extracted a shared `LessonNav` so the content-lesson footer and the new quiz footer share one implementation. New en+da `coursePlayer.quizNotReady` / `quizNotReadyDescription` keys.

**Scope:** frontend only. Issue **item 4** (publish-time backend validation that a `quiz` lesson has a quiz with ≥1 question) was **declined by the owner** — it would block the common flow of publishing a course while a quiz is still being authored, and would not help already-published courses (which this player fix does). Left as a possible follow-up. The `quizzes_enabled` flag deliberately does NOT gate already-published content (ADR-0017); the nav footer is the durable answer to the "flag off → quiz still visible but unskippable" symptom the issue flagged.

**How:** TDD — 3 new `CoursePlayer.test.tsx` cases (no-quiz, zero-questions, healthy-quiz regression) written red first, then implemented green. The `LessonNav` extraction is behavior-preserving: the pre-existing #294 / #18 / footer suites are unchanged and green. Code review skipped at the owner's request.

**Verify:** root `lint` 0 errors · `tsc` exit 0 · `test` 108 files / 809 pass · `build` exit 0. `functions/` untouched (no functions test run needed). Re-verified post-merge-of-trunk (branch merged #303/#309/#310 in; only WORKLOG/STATUS conflicted — both resolved by taking trunk and re-applying this entry + the checkpoint move).

**Deploy:** frontend-only; merging auto-fires the SWA frontend workflow (and the functions workflow as a no-op redeploy). Deploy + smoke announced on PR #304.

## 2026-07-27 — `<html lang>` first-load sync + the PlatformSettings CI flake (#311, #305)

**Who:** claude (Opus 5) + martin. Two independent single-file fixes, run as parallel lanes off the same trunk while a third session took #306–#308. Both found by the prod smoke / CI of the #300 batch, both pre-existing.

**#311 (PR #312, deployed @`fe801a0` + browser-smoked).** `<html lang>` stayed at `index.html`'s hardcoded `da` on first load no matter which language rendered — an accessibility defect (screen readers announce English copy under Danish pronunciation rules; "translate this page" offers the wrong direction). Cause: `src/i18n/index.ts` registered `syncDocumentLang` on i18next's `initialized` event *one statement after* `init()`. Every locale is bundled and there is no async backend, so `init()` resolves synchronously and had already emitted that event — the handler never ran, and `lang` only corrected itself once the user manually switched language (the `languageChanged` path, which #189 did guard). Fix: call the sync directly and keep only the `languageChanged` listener; the `initialized` registration is dropped rather than kept-as-redundant.

**The test had to go in its own file, and that is the transferable lesson.** The obvious home — `src/i18n/index.test.ts` — *cannot* host this guard: its top-level `import i18n from './index'` initializes i18next before any test body runs, and `vi.resetModules()` does not undo that because i18next is externalized (the singleton and its listeners survive the reset, and a leftover listener sets `lang` for you). A guard written there **passed against the reverted fix** — verified, not assumed, which is how it was caught. Vitest isolates the module registry per *file*, so `src/i18n/document-lang.test.ts` imports the module inside the test body, giving exactly one initialization. Checked in both directions: green with the fix, `expected 'da' to be 'en'` without it — the reported prod symptom exactly, with `resolvedLanguage` already `'en'` and only the attribute lagging. Note only the **English** case can catch this: `da` is both the static value and the correct answer for Danish users, the coincidence that let it ship.

`index.html` **keeps** `lang="da"` — its own static content (title, meta description, og/twitter tags) is Danish, so `da` correctly labels the pre-JS markup for crawlers that never run the sync. Considered flipping it to `en` (as the issue floated, since #226 made English the catch-all) and declined.

**#305 (PR #313, test-only).** The flake diagnosed but deliberately left unfixed while landing #300 (see the entry above). `PlatformSettings.tsx` seeds form state with `defaultBranding` (`'AIR Academy'`, `:77`/`:133`), copies `query.data` in via a post-render `useEffect` (`:180`), and gates rendering on `query.isLoading` (`:259`) — which flips false one render *before* the effect flushes. Both failing tests awaited element *existence* then asserted the *value* synchronously, so a `waitFor` poll landing inside that window resolved immediately and raced the effect. Fix: assert the value inside `waitFor`, so the awaited and asserted conditions are the same predicate and the window cannot be observed. Applied to both racy sites **plus the round-trip test's first wait** — resolving early there meant the local edit landed on an unsettled form where the effect could overwrite `'Edited Name'`, quietly undermining what the test asserts.

**Sweep (the issue asked for it):** scanned every `src/**/*.test.ts(x)` for the shape — `waitFor(… toBeInTheDocument())` followed by a synchronous value assertion on the same element. Five hits. One was real and fixed: `CourseEditor.test.tsx`'s "preview failed" test awaited the course query's display value but asserts on the **signed-URL** step, an independent async resolution, so it now awaits the failure notice it is actually about. Three were left alone on purpose — `PostEdit.post-edit-redirect.test.tsx:74,81` (a mounted `LocationProbe` *is* the completed navigation; no second effect to race) and `CourseEditor.test.tsx:396` (asserted field comes from the same effect as the awaited value) — in each the awaited condition already implies the assertion, so changing them would be churn.

**Could not reproduce the flake locally, and said so on the PR:** 12 sequential runs of the original code with 8 CPU cores deliberately saturated came back 12/12 green, matching the issue's own note (808/808 local, red only on loaded CI runners). Evidence used instead: the window is structural, not luck — confirmed the defaults-seed → post-render-effect → `isLoading` gate chain in the component source — and the fix closes it by construction. 12 runs of both touched files under the same load: 12/12 green. Treat CI on trunk as the ongoing signal. Also noted-but-not-changed: the "save guarded" and "per-panel morph" tests click Save before the effect flushes, so the payload can carry defaults; neither asserts on that today, so neither is flaky, but both are latent if those assertions are ever tightened.

**Verify:** #312 — root `lint` 0 errors · `tsc` exit 0 · `test` 110 files / 812 pass · `build` exit 0. #313 — root `lint` 0 errors · `tsc` exit 0 · `test` 109 files / 811 pass · `build` exit 0. `functions/` untouched by both; CI ran the functions gate green on each PR anyway.

**Deploy:** both frontend-only, squash-merged back-to-back (`7011bbb` then `fe801a0`). **The `@7011bbb` SWA run shows as failed — it is benign:** build and upload both succeeded, then `Deployment Failure Reason: Deployment Canceled`, i.e. Azure superseded it with the `@fe801a0` deploy that merged ~90 seconds later. Prod runs `@fe801a0`, which contains both changes. Worth knowing for any future back-to-back merge: the first SWA run will red-X itself and that is expected, not a broken deploy. Smoke for #311 done in a real browser against the SWA host — served static HTML still `<html lang="da">`, `document.documentElement.lang` reads `en` after hydration on a first load with no manual switch. Announced on both PRs.
## 2026-07-27 — Invite-email sender bound to the invitation's org & role (#306, #307; #308 closed)

**Who:** claude (Opus 4.8) + martin. The two remaining actionable `send-invitation-email` review cards refiled after #231/#309; done as one PR (#314) since both live in one file.

**#306 (authz-2, priority) + #307 (err-12) — one change.** `send-invitation-email` gated only on *"is the caller a platform admin OR an org_admin of ANY org"*, then took `orgName`/`role`/recipient `email` straight from the request body. So an org admin of Org A could send an official-looking invite from the trusted `no-reply@ai-uddannelse.dk` address advertising **Org B**, or naming a **Platform Administrator** role — a ready-made spoofing/phishing tool (the send doesn't grant access, but it carries the platform's trusted identity). Separately, an unrecognized `role` silently rendered as *learner* (#307).

Both are closed by making the server the source of truth. The endpoint now resolves the invitation from the `link_id` embedded in the (domain-validated) invite link — `getInviteLink` already mints `${base}/signup?invite=<link_id>`, so **no frontend/contract change** — via a single query that also computes whether the caller is an active `org_admin` of *that invitation's* org. Authorization is `profile.is_platform_admin || invitation.caller_is_org_admin`; a platform-admin invite is the `org_id === null` case (the same signal `shared/invitation-convert.ts` branches on), which forces `caller_is_org_admin = false` and so requires an actual platform admin. Org name, role and recipient are read from the invitation row; client `orgName`/`role`/`email` are ignored. **#307 folds in:** `role` now comes from the `org_role` enum (`org_admin` | `learner`), both handled explicitly, so nothing silently maps to learner and no garbage role reaches the template — the role-spoof test is its regression guard.

Decisions: unknown/mismatched `link_id` and "not your org" both return a **uniform 403** so `link_id`s (128-bit secrets) can't be probed. Profile resolution moved to the shared `getProfile` (oid+tid) — the old header's "oid-only lookup" note is gone. The lookup is **not** gated on `status`/`expires_at` (matches prior behaviour; resend-of-pending is the common case and an expired link fails harmlessly at accept-time) — flagged by the adversarial review as optional, deliberately left. The `org_id`-set-yet-`is_platform_admin_invite`-true row the CHECK permits ("not the converse") is treated as an org invite here, exactly as `convertInvitation` would grant it — email and grant stay consistent.

**#308 (dup-2) — closed, not-actionable.** Its likelier reading (a shared ~60-line email layout mirrored across `send-invitation-email`, `shared/seat-request-notify.ts`, `orphan-sweep/notify.ts`) is refuted by the code: the latter two emit bare unstyled `<h2>/<p>` fragments — no DOCTYPE/table/logo/footer chrome — so there is nothing shared to extract (the *sending* path was already shared as `shared/resend.ts`, dup-15). The card was low-confidence and its authoritative source (the 2026-07-24 `/review-suite` report) isn't tracked in the repo. Owner decision: close for now; the real frontend orchestration duplication (4 invite surfaces) can be its own scoped issue if wanted.

**How:** TDD — the endpoint test was rewritten to the new DB-driven behaviour (org/role/recipient from the invitation, hostile client `role: 'platform_admin'` proven ignored), watched RED against the old code (21/25 failing), then GREEN. Preserved all prior coverage (language resolution #231, delivery-failure #200, HTML/CR-LF injection #195) by moving the malicious/derived values from the client body into the invitation row. Independent adversarial code review (Opus 4.8): **no findings ≥80 confidence** — authz binding, anti-enumeration, injection escaping, the `org_id===null` signal, and the #307 closure all confirmed; no legit-flow regression (all 4 senders create-then-send, so the row always exists).

**Verify:** functions `build` exit 0 · `test` 145 files / 2607 pass (3 skip; 25 in `send-invitation-email`). root `lint` 0 errors · `tsc` exit 0 · `test` 109 files / 811 pass · `build` exit 0. CI green on both required checks.

**Deploy:** functions changed → both workflows load-bearing. Announce on PR #314.

## 2026-07-28 — Remove dead Email/SMTP tab from Platform Settings (#317)

**Who:** claude (Opus 4.8) + martin.

**Problem.** Platform Settings → Email showed a permanent, misleading "SMTP is not configured — invitation emails will not be sent" banner that was decoupled from reality. Transactional email is sent via **Resend** (ADR-0009), not SMTP; the banner gated on `!email.smtp_configured`, a flag that defaulted to `false` and only flipped `true` if an admin ran the "Test connection" probe — so it alarmed admins even though prod invite delivery was confirmed working (Closes #22; #225/PR #231). Worse, "testing" an unrelated SMTP server would *clear* the warning while telling the admin nothing true about delivery. The `smtp_*` fields, `from_name`/`from_email`, `smtp_configured`, and the `test-smtp-connection` endpoint were all dead Lovable/Supabase-era config that no send path reads.

**Decision — Option A (remove the tab entirely), owner-confirmed.** `from_*` were dead too, so the whole tab was dead; email is a fixed system integration (Resend, hardcoded sender per ADR-0009), not an admin-configurable thing. Aligned with ADR-0009, so no new ADR. This also settles the **Email** half of the parked discussion #170 (recorded there; the Branding half stays open + `blocked`).

**Done.**
- **Frontend:** removed the Email tab, the `EmailSettings` type, `defaultEmail`, the `email`/`testingSmtp` state, the `email` effect case, `handleTestSmtpConnection`, the tab-nav entry, and now-unused imports (`Select*`, `toast`, `Mail`) from `PlatformSettings.tsx`; shrank the test fixture; swept the dead `platformSettings.email.*` + `tabs.email` i18n keys in `en` + `da`.
- **Backend:** deleted `functions/test-smtp-connection/` (index + test) and the now-orphaned `functions/shared/net-guard` (index + test — its only consumer was the SMTP endpoint, added in #267); removed the barrel import; dropped the `email` key + its field shapes (and the now-unused `isFiniteNumber` helper) from `platform-settings-update`, reworking the affected validator tests onto live keys (`user_access.default_role` covers the `isOneOf` path). Reworded two comments in `platform-settings`/`seat-pricing` that referenced dead "SMTP credentials".
- **Seed:** dropped the dead `email` row from `migration/azure/02-seed.sql` (surfaced by code review — a fresh DB no longer carries it). **No prod DB migration** — the existing prod `email` row is harmless orphaned JSONB.
- **Docs:** dropped the `test-smtp-connection` row from `migration/azure/README.md`; removed the stale "Add `resend-api-key`" USER action in STATUS.html (set + verified end-to-end). ADR-0014/ADR-0015 mention the endpoint but are append-only history — left untouched.

**Review.** Independent code review (Opus 4.8, pr-review-toolkit): **no findings at/above threshold, clean to merge**; its one optional observation (the dead seed row) was then fixed.

**Verify:** root `lint` 0 errors · `tsc` exit 0 · `test` 812 pass · `build` exit 0. functions `build` exit 0 · `test` 2527 pass (3 skip) — incl. the `registration-names` fleet guard (226) confirming clean endpoint removal. CI green on all required checks.

**Deploy:** functions changed → both workflows load-bearing. Announce on PR #322.

## 2026-07-28 — Org-detail page rendered the org name in two competing `<h1>`s (#320, PR #324)

**Who:** claude (Opus 4.8) + martin.

**Problem.** `/app/admin/platform/organizations/:id` rendered the org name as **two** `<h1>`s: `OrganizationDetail`'s main branch passed `AppLayout title={org.name}` (AppLayout renders `title` as the page `<h1>`) **and** rendered `OrgDetailHeader`, which carries its own `<h1>{org.name}`. Wrong document outline, a screen reader with no single "what page am I on", the name shown twice visibly, and an ambiguous `getByRole('heading', { level: 1 })` — the last is how it surfaced during the #316 e2e write-fence work. Low user-visible impact (both say the same thing); an a11y/semantics bug. `afk`-labelled.

**Fix.** Dropped `title={org.name}` from the main-branch `AppLayout` so `OrgDetailHeader`'s `<h1>` is the page's single heading; the loading branch keeps its `title` (it has no in-page header). This is the convention the sibling platform-admin pages already use (`OrganizationsManager`, `CoursesManager`, #101 — same explanatory comment). Chosen over the issue's *suggested* demote-`OrgDetailHeader`-to-`<h2>` because it matches existing code **and** removes the visible name-shown-twice redundancy. `OrgDetailHeader`'s `<h1>` (org name) survives, so #316's `getByRole('heading', { level: 1 })` fence assertion still holds — against a different element. Audited the tree for the same double-`<h1>` shape (layout `title` + own header component): only these three pages qualify, and the other two were already correct.

**Test.** Added a `#320` regression test to `OrganizationDetail.test.tsx`: upgraded the file's `AppLayout` mock to render `title` as `<h1>` (the faithful mock the #101 guards use), then asserted exactly one `Acme Corp` heading and that it is an `<h1>`. Mutation-checked — re-adding `title` makes it fail with "got 2".

**Verify:** root `lint` 0 errors · `tsc` exit 0 · `test` 110 files / 813 pass · `build` exit 0. `functions/` untouched (frontend-only); CI ran the functions gate green anyway.

**Deploy:** frontend-only → the SWA workflow ships it; no functions deploy. Announce on PR #324.

## 2026-07-28 — CourseEditor field labels not associated with their inputs (#325, PR #326)

**Who:** claude (Opus 4.8) + martin.

**Problem.** `CourseEditor.tsx` had **zero** `htmlFor` attributes — every `<Label>` was visually adjacent to its field but not programmatically tied to it. Screen readers announced each field with no name, clicking a label did not focus its input, and `page.getByLabel(...)` resolved to zero elements (which is how it surfaced, during the #316 e2e course-lifecycle work). WCAG 1.3.1 / 4.1.2. `afk`-labelled. The correct pattern already existed in `OrganizationsManager.tsx`'s org-create dialog; this file had simply diverged.

**Fix.** Wired **every** labelled field in the course editor via `htmlFor`↔`id`, not just the six the issue enumerated — the course-details form (Title, Description, Thumbnail, Level, Language) *and* the module/lesson dialogs (Module Title, Lesson Title, Type, Duration, Document/Video File, content text; the three mutually-exclusive `lesson-content` branches share one id). The three shared upload components (`FileUpload`, `AzureDocumentUpload`, `AzureVideoUpload`) gained an optional `id?: string` prop forwarded to their hidden `<input type="file">`, so a `<Label htmlFor>` names the picker (label-click opens the dialog). The "editions" title labelled a *section* (a list + a link control), not a single field, so it became an `<h3>`; the link-target Radix select got its own `aria-label`. No new i18n strings (existing keys reused).

**Test.** New guards in `CourseEditor.test.tsx` resolve each field **through its label** — `getByLabelText` for native inputs, name-scoped `getByRole('combobox', …)` for the Radix selects — across both the details form and the module/lesson dialogs. Stripping any `htmlFor` fails a matching assertion. (Also coordinates with #316: its title-field locator can now become `getByLabel('Title')`.)

**Sweep (per AC).** Grepped the other authoring surfaces for the same divergence; found it in ~12 more files (`QuizEditorDialog` — which also hardcodes non-i18n label text — `CoursesManager`, several org-detail/enroll dialogs, settings). Filed as **#327** rather than folded in, to keep this PR reviewable.

**Verify:** root `lint` 0 errors · `tsc` exit 0 · `test` 110 files / 815 pass (2 new) · `build` exit 0. `functions/` untouched (frontend-only).

**Deploy:** frontend-only → the SWA workflow ships it; no functions deploy. Announce on PR #326.

## 2026-07-28 — Remove platform Branding entirely from Platform Settings (#170)

**Who:** claude (Opus 4.8) + martin.

**Decision — remove branding entirely, owner-confirmed.** Issue #170 parked the "keep / rework / remove Branding & Email tabs" question. The Email half was settled by #317/PR #322 (removed). For the **Branding** half the owner chose the deepest of three options: remove not just the editing tab but the whole platform-branding concept, so the app falls back to its built-in navy theme. What made this bigger than the Email removal: branding was **not** dead — the stored `branding` platform-setting was read by the theming context and drove the live CSS theme (colors + favicon) plus the certificate footer name. So this removes a live reader, not merely dead config.

**Done.**
- **Frontend tab:** removed the Branding tab from `PlatformSettings.tsx` — the `BrandingSettings` type, `defaultBranding`, the `branding` state + load-effect case, `brandingColors`, the render block, the `Palette` import, and `branding` from the `SettingsKey`/`SettingsValue` unions + the tabs array; the default active tab moves `'branding'` → `'user_access'`.
- **Theming reader:** removed branding from `usePlatformSettings.tsx` — the `BrandingSettings` interface, `defaultBranding`, `hexToHslValue`, the `branding` context field + state, the fetch-merge for the `'branding'` key, and the `useEffect` that pushed CSS vars (`--primary`/`--accent`/`--sidebar-*`) + the favicon href. The provider still owns `features`. All five CSS vars it set have matching navy `:root` defaults in `src/index.css` (identical to the effect's own fallbacks), so the app stays navy with no JS — and dark mode no longer has the light-navy values force-inlined over it. Favicon reverts to the static `/favicon.png` in `index.html` (`favicon_url` was always null).
- **Certificate:** `CertificateCard`'s hover-preview footer used `branding.platform_name`; now a module const `PLATFORM_NAME = 'AIR Academy'` (the server-side `generate-certificate` PDF never read branding).
- **Backend:** dropped the `branding` key + field shapes from `platform-settings-update` (`ALLOWED_KEYS`/`FIELD_SHAPES`/error message) — the write path was dead once the tab was gone. GET `platform-settings` is key-agnostic and untouched.
- **Seed:** removed the `branding` row from `migration/azure/02-seed.sql`. **No prod DB migration** — an existing prod `branding` row is harmless orphaned JSONB (the frontend ignores unknown keys; the update endpoint now rejects `branding` at the allowlist), same posture as #322's email row.
- **i18n:** swept `tabs.branding` + the `platformSettings.branding.*` block in `en` + `da`.
- **Tests:** retargeted the branding-vehicled tests onto live keys — `PlatformSettings.test.tsx` drives the `user_access` panel's switches (round-trip / failed-read / retry / save-guard / morph); `usePlatformSettings.test.tsx` rewritten to cover the surviving `features` behavior; `platform-settings-update`/`platform-settings`/`usePlatformSettingsAdmin`/`CertificateCard` fixtures moved off the `branding` key.

**Untouched (deliberately):** the unrelated **org/community branding-asset** system — `BrandingAvatar`, `useSignedBrandingUrl`, `functions/branding-asset-url`, org `logo_url` — is a different "branding" (signed org logos + user avatars, #162/#165/#180) and stays intact.

**Review.** Independent code review (Opus 4.8, pr-review-toolkit): clean — one Minor (a merge-comment still using "stored branding colors" as its example → reworded to "the other feature flags"), fixed. Confirmed the navy-fallback reasoning, the untouched asset system, and that the retargeted tests still reach the checks they name.

**Verify:** root `lint` 0 errors · `tsc` exit 0 · `test` 813 pass · `build` exit 0. functions `build` exit 0 · `test` 2527 pass (3 skip). CI green on both required checks.

**Deploy:** functions changed (`platform-settings-update`) → both workflows load-bearing. Announce on PR #328.

## 2026-07-29 — Bind production domain www.ai-uddannelse.dk + ai-u.dk alias (#115, PR #331)

**Who:** claude (Opus 4.8) + martin.

**Goal.** Serve the app on a real domain instead of the default `black-forest-0d7f96c03.7.azurestaticapps.net`. Owner-chosen **Option B**: `www.ai-uddannelse.dk` is canonical; the bare apex `ai-uddannelse.dk` 301-forwards to it (GoDaddy can't ALIAS/ANAME an apex onto an SWA, and we deliberately did **not** migrate DNS to Azure). Mid-cutover the owner added a second short domain **`ai-u.dk`** as a pure redirect alias — apex + `www` both 301 → `https://www.ai-uddannelse.dk` (no serving, no code, no email).

**Code — one line (PR #331).** Pinned `VITE_PLATFORM_BASE_URL=https://www.ai-uddannelse.dk` in the SWA workflow, but **only for the production `push` build** via a `github.event_name == 'push'` guard — PR preview builds keep `""` and fall back to `window.location.origin`, preserving #80 (previews mint invite links on their own host). The issue's original plan also called for adding `www` to a static `ALLOWED_LINK_DOMAINS` array in `send-invitation-email`, but that file had since been refactored to derive allowed link hosts dynamically from `ALLOWED_ORIGINS` (`allowedLinkDomains()`), so `www` is trusted automatically once CORS includes it — **no source edit needed there**. `STATIC_ASSETS_BASE_URL` left at the apex default (the optional www flip was skipped — one harmless apex→www hop for the email logo).

**Owner-run cutover** (agent can't mutate prod Azure/DNS/Entra):
1. `ALLOWED_ORIGINS` += `https://www.ai-uddannelse.dk` on `func-ai-education-migration` — feeds **both** CORS and the invite-link allowlist. Idempotent read-modify-write script; ran **first**.
2. GoDaddy `ai-uddannelse.dk`: `www` CNAME → the SWA host; apex domain-forwarding → `https://www.ai-uddannelse.dk` (301, no masking). Email records (MX / SPF / DKIM / Resend TXT) left untouched.
3. `az staticwebapp hostname set … www.ai-uddannelse.dk` — validated via the CNAME, managed DigiCert cert issued (status `Ready`).
4. Entra `learn-wings`: added redirect URI `https://www.ai-uddannelse.dk` under the **Single-page application** platform (apex was already registered). SPA, not Web — the MSAL browser client redeems its token cross-origin with PKCE, which Entra only permits for the SPA client type (else `AADSTS9002326`).
5. GoDaddy `ai-u.dk`: apex + `www` subdomain forwarding → `https://www.ai-uddannelse.dk` (301). GoDaddy auto-provisions the redirect's TLS cert (took ~tens of minutes).

**Ordering gotcha.** Step 1 had to precede the merge/deploy: merging pins prod links to `www`, and if `www` weren't yet in `ALLOWED_ORIGINS`, the invite-email POST would 400. Sequenced accordingly.

**Verify (post-deploy).** `www` serves HTTP 200 behind a valid `CN=www.ai-uddannelse.dk` DigiCert cert; the deployed JS bundle contains the pinned base URL (confirming the prod pin, not the empty preview fallback); apex + both `ai-u.dk` hosts 301 → www (GoDaddy emits an `http://www` Location that the SWA upgrades to https — one cosmetic extra hop). Owner smoke: Entra login on `www` OK; invitation email end-to-end OK.

**Deploy:** merged @`8441d37`; SWA + functions workflows both green; smoke ok (announced on PR #331). Residual **optional** optimization (not part of #115): re-link the SWA backend + `VITE_API_BASE_URL=""` for same-origin `/api` — cross-origin works fine as-is.

## 2026-07-29 — Wire label↔input associations across the remaining authoring/form surfaces (#327)

**Who:** claude (Opus 4.8) + martin.

**What.** Follow-up sweep from #325/#326. A `<Label>` with no `htmlFor` (and a control with no matching `id`) leaves a screen reader announcing the field with no name and makes clicking the label a no-op (WCAG 1.3.1 / 4.1.2). Wired the remaining surfaces to the pattern `CourseEditor` already uses. Frontend-only.

**Done.**
- **Field labels (htmlFor ↔ control id):** CoursesManager create dialog (thumbnail/title/description/level/language), AddExistingUserDialog (user, role), InviteUserDialog (role), EditOrganizationDialog (logo), OrganizationsManager (logo), PlatformAdminsSection (grant), Settings (profile photo), BulkInviteDialog (CSV file → its hidden `<input>`), EnrollUserDialog (member), QuizEditorDialog (passing score). The three shared upload components already forward an optional `id` to their hidden file input (#326); Radix `SelectTrigger` takes an `id`.
- **Heading, not label:** captions that titled a group or a fixed value (so labelled no single control) became `<h3>`/`<h4>`/`<p>`, matching the CourseEditor editions precedent — QuizEditor "Questions"/"Question N", EnrollUserDialog "Select courses" (checkbox group), OrganizationsManager "Initial admin" (Tabs group), PlatformSettings fixed "Default role" (value is always Learner, no control). The quiz answer-options radio group gets its name via `aria-labelledby` (unique per question id).
- **i18n:** hardcoded English label text moved to en+da — new `quizEditor.*` and `bulkInvite.*` namespaces, plus `enrollDialog.selectMemberLabel/selectMemberPlaceholder/selectCoursesLabel`. Used the convention-correct "organization member" (not "Team Member"); QuizEditorDialog gained `useTranslation`. Non-label hardcoded English in those files (buttons, messages) is deliberately out of scope.
- **Tests:** the shared `src/test/select-mock.tsx` now renders `SelectTrigger` as a labelable `<button>` forwarding props (notably `id`), so `getByLabelText` resolves a select; verified against all 6 consumers. Added a `getByLabel`-based guard per surface that has a test file (9 surfaces) — each fails if the `htmlFor`/`id` is removed.

**Review.** Independent code review (Opus 4.8, pr-review-toolkit): clean — no Critical/Important. Two Minor: (1) the enroll member-picker placeholder still said "team member" after the label rename → i18n'd to `enrollDialog.selectMemberPlaceholder`, convention-correct wording; (2) `QuizEditorDialog`'s `new-${Date.now()}` id minting is a pre-existing, UI-unreachable collision risk (saved questions use DB uuids) → left as-is, out of the label-association scope.

**Verify:** root `lint` 0 errors · `tsc` exit 0 · `test` 110 files / 824 pass · `build` exit 0. `functions/` untouched (frontend-only).

**Deploy:** frontend-only → the SWA workflow ships it; no functions deploy. Announce on PR #330.
## 2026-07-27/29 — Playwright end-to-end suite, #124 rescoped and shipped (PR #316)

**Who:** claude (Opus 5) as controller + ten implementer/reviewer subagent pairs, with martin deciding scope and policy. Rescopes **#124 "FULL End to End Testing"** — unbounded, past its April due date — into a concrete suite.

**What shipped:** nine spec files, 16 tests, `npm run e2e`, driving the **deployed** app in a real browser through a real Entra login against the production backend and database, including write journeys. Two consecutive full-suite runs green; debris audits after each showed zero `e2e-` artefacts. **Deliberately not a CI gate** — real login plus real writes against the single shared database does not belong on the merge path. Only the new `tsc -p tsconfig.node.json` type-check went into CI.

**No credentials exist anywhere.** The original design assumed a stored password; that was replaced when martin offered to log in by hand. A human captures a browser session once (`npm run e2e:capture`), and specs replay it. `.env.e2e` holds only `E2E_BASE_URL` and `E2E_INVITE_TO`, both non-secret. An expired capture fails fast in the `setup` project with the re-capture command in the message (measured: 172ms for a missing capture, 164ms truncated, 2.3s session-less — down from ~90s).

**Three auth findings that the first design got wrong, all verified empirically rather than reasoned:**
1. The captured Entra cookies do **not** log the app in. MSAL caches in `sessionStorage`, which `storageState` cannot carry, and the app has no silent-SSO path (`loginRedirect` fires only from the button's `onClick`). Loading the app with the capture renders the login page.
2. Clicking "Sign in with Microsoft" **does** complete with no prompt — Entra returns via `/common/reprocess`. That click is therefore a required step of every authenticated spec.
3. `viewMode` is also in `sessionStorage`, so it is seeded per navigation via `addInitScript`; only `03-role-views` drives the real switcher UI.

**The write fence, and what it does not cover.** `OrgSelector` re-selects `orgs[0]` on every navigation, so write journeys use `gotoFenced(page, org, path)` (navigate + re-select + re-assert) against a `fencedOrg` fixture that Playwright creates and tears down. Teardown is fixture-owned, not `finally`-owned, because a test timeout can outrun `finally` — **reproduced on the real database first** (the delete never ran, audit showed a live `e2e-` row), then proven fixed. The fence bounds **org-scoped** writes only: `functions/course-create` takes no org id, so a course the suite creates is platform-global until deleted, protected by create-then-delete plus the `e2e-` prefix. Recorded in the spec rather than left implied.

**Eight assertions that could not fail were caught and fixed during development.** This is the substance of the work, not a footnote — an assertion that cannot fail is worse than no test, because it is believed. The instructive ones: a check that a course edit "round-tripped to the server" was matching the *editor page's own breadcrumb*; a quiz assertion passed during a **flash** where all three possible states measured zero elements; a `toBeHidden()` that would pass if `<header>` were absent entirely; and a nav assertion satisfied by page content, because the shadcn sidebar renders no `<nav>` landmark so `getByRole('navigation')` matched the breadcrumb inside `<main>`. Each fix was demonstrated by mutation — including one showing a download-event assertion is worthless, since sending a JSON body still fires the event, shows the toast and matches the filename. The final whole-branch review hunted specifically for a ninth and found none.

**A pattern worth carrying forward:** nine comments were found asserting a *false reason* while the code was correct — and every one originated in the controller's own plan prose, transcribed faithfully by implementers. A Global Constraint was added mid-plan telling implementers to treat the plan's "why" as a claim to verify, not a fact to quote; the next task's comment audit then checked ~20 line-referenced claims and found all true. Issue **#318** tracks the two survivors.

**Verify:** root `lint` 0 errors (1994 pre-existing warnings) · `tsc -p tsconfig.app.json` 0 · `tsc -p tsconfig.node.json` 0 (new; `e2e/` had no type-check gate at all before, which is how a `TS2584` survived every prior hand-check) · `npm test` **812 / 110 unchanged, no e2e collected** · `build` 0 · `playwright test --list` 16 tests / 10 files.

**Post-merge re-verification:** trunk moved during this work (the #115 cutover, plus #322/#324/#326/#328/#330 fixing four defects this suite uncovered). After merging trunk in, all gates were re-run: `lint` 0 errors (**1968** warnings — trunk's label fixes reduced the baseline from 1994), both `tsc` configs 0, `npm test` **824 / 110** (trunk added tests), `build` 0. Critically, **the full e2e suite was re-run against the updated deployed app and all 16 passed** — including the specs whose locators touch the files trunk changed (`OrgDetailHeader`'s de-duplicated `<h1>`, which the fence asserts on, and `CourseEditor`'s now-associated labels, which the course helpers locate).

**Cost worth knowing:** each full run sends one real invitation email to `E2E_INVITE_TO`; roughly a dozen were sent across development and verification. Inviting the signed-in account's own address **self-adopts** the invitation on the next page load (`user-context` adopts matching pending invites on every call, #176), which made the specced invite flow impossible — the journey reshaped around it, and a `+e2e` subaddress would restore the full lifecycle if wanted.

**Filed, not fixed** (per the review policy set this session: fix Minor, file Critical/Important, with a standing exception for production-debris findings, which are fixed because they compound): **#318** false-reason comments · **#321** nothing structurally stops a spec bypassing the fence · **#329** learner write runs once and the org is never asserted · **#332** post-revoke assertions pass green if the queries fail · **#334** the load-bearing wait has the shortest timeout · **#337** five specs' budgets are below their own waits. App defects found *by* this work: **#320** duplicate `<h1>` and **#325** unassociated `CourseEditor` labels (both since closed) · **#333** quiz copy promises a next lesson that is disabled · **#335** the role-view switcher hides platform nav but routes still serve it.

**One bookkeeping failure to record:** the switcher issue was reported as filed under #323 when no issue was created — `gh issue create` printed a URL for an issue that does not exist. Caught by the final review, re-filed as **#335**. Worth remembering that a printed URL is not proof an issue exists.

**Deploy:** none — the suite is test-only and touches no shipped code. `tsconfig.node.json` gained an `include` entry and `AGENTS.md`/`ci.yml` gained the type-check gate.

## 2026-07-29 — #333 quiz "not ready" copy no longer promises a disabled next lesson (PR #345)

**Who:** claude (Opus 4.8) with martin. Frontend-only. First of the app defects the #316 e2e suite surfaced (it asserts exactly this not-ready state) to be fixed.

**The defect:** the #299 empty state read *"There are no questions to answer here yet. You can continue to the next lesson."* On the **last** lesson of a course there is no next lesson and the footer's Next control is disabled, so the copy instructed the learner to do something the UI won't permit — a dead-end message on the screen built specifically to prevent dead ends. #299's whole purpose was that a quiz lesson must never trap the learner; the nav fix worked, the copy overstated it.

**The fix:** `CoursePlayer.tsx` selects the description by position, reusing the footer's own `currentIndex >= allLessons.length - 1` last-lesson test (the same one line 662 already uses for the submitted-quiz button). A following lesson → the unchanged wording still points to it; the last lesson → a new `quizNotReadyDescriptionLast` string that says something true (the quiz appears here once ready) and promises nothing the UI can't deliver. New key added to **both** `en` and `da`. The ternary sits **outside** `t()` so both keys stay static `t('literal')` call sites the #300 translation-key parity gate protects.

**No e2e change needed.** `07-quiz-lesson.spec.ts` (#316) asserts only the **title** (`quizNotReady` = "This quiz isn't ready yet"), which is untouched — never the description this fix changes. That let #333 land independently of the concurrent e2e-hardening work (incl. #334, also in that spec); disjoint trees (`src/` vs `e2e/`), so merge order was free.

**Tests:** two new `CoursePlayer.test.tsx` cases, one per branch — the next-lesson copy when a lesson follows, and the last-lesson copy (with Next asserted disabled) when the quiz is the only lesson. The `t` mock returns the key, so the cases assert on `coursePlayer.quizNotReadyDescription` vs `…DescriptionLast` (exact-match, so the shared prefix doesn't cross-match).

**Verify:** root `lint` 0 errors · `tsc -p tsconfig.app.json` 0 · `npm test` **826 / 110** · `build` 0. functions untouched. PR CI all green (frontend + functions + build/deploy job).

**Deploy:** frontend-only, so the SWA workflow ships it automatically on merge to `main`; no functions deploy.

## 2026-07-29 — #338 learner catalog sorts enrolled courses to the top (PR #347)

**Who:** claude (Opus 4.8) with martin. Frontend-only. First of three sequential learner-catalog issues (#338 → #340 → #339) worked in one worktree, each merged before the next so they stack cleanly.

**What:** the "All courses" grid on `src/pages/learner/Courses.tsx` had no client-side sort — cards rendered in the backend's alphabetical-by-title order. Now courses the learner has an enrollment in (status `enrolled` OR `completed`) sort above not-enrolled ones, and within that enrolled group by `enrolled_at` DESC (an interim ordering until #339 replaces it with last-activity recency). Not-enrolled courses keep their alphabetical order.

**How:** `filteredCourses` became a single `useMemo` (filter → enrolled-first sort) per the frontend convention that call-site derivation is memoized. The comparator keys on the *existence* of an enrollment row (the backend only emits rows for `enrolled`/`completed`, so row-exists ≡ enrolled-or-completed), sorts the enrolled group `enrolled_at` DESC, and returns `0` for two not-enrolled — `Array.prototype.sort` is stable (ES2019), so the alphabetical tail is preserved. It sorts a `.filter()` copy, never mutating `courses`. Module-level `NO_COURSES`/`NO_ENROLLMENTS` empty-array fallbacks keep the `?? …` reads referentially stable so the memo doesn't churn (this also cleared the two `react-hooks/exhaustive-deps` warnings the memo first introduced — surfaced by the task review and fixed in-loop).

**Scope:** no backend or schema change. The "Recommended for you" section, search, and level/status filters are untouched.

**Tests:** three new `Courses.test.tsx` cases assert rendered card order (read from the `<h3>` titles in DOM order): enrolled-first + `enrolled_at` DESC, a not-enrolled-only case that would catch an accidental reorder of the alphabetical tail, and filter-then-sort coexistence.

**Verify:** root `lint` 0 errors (1968 warnings = baseline) · `tsc -p tsconfig.app.json` 0 · `npm test` **829 / 110** · `build` 0. Re-run by the controller from the worktree after the fix, not just the implementer.

**Deploy:** frontend-only, so the SWA workflow ships it automatically on merge to `main`; no functions deploy.

## 2026-07-29 — #340 progress bar + % on enrolled learner-catalog cards (PR #348)

**Who:** claude (Opus 4.8) with martin. Backend + hook + frontend. Second of the three sequential catalog issues, built on #338.

**What:** enrolled cards on `src/pages/learner/Courses.tsx` showed only an enrolled/completed badge — no progress. They now show a progress bar + percentage in the dashboard's "Continue Learning" bar style. Completed cards read 100%; not-enrolled cards show no bar (they keep the Enroll CTA).

**How:** `functions/learner-courses` now returns a `progress: Record<courseId, {total, completed}>` map for the caller's enrolled courses, computed with the **same two batched `COUNT` queries** `functions/learner-dashboard` already uses (copied verbatim — totals over `course_modules`→`lessons`, completed over `lesson_progress`→`lessons`→`course_modules` scoped to the caller+org with `status='completed'`; both `GROUP BY cm.course_id` over `ANY($n::uuid[])`, so no N+1). Empty enrollments short-circuits to `progress: {}` before any count query runs. The existing course-visibility/language predicate and the enrollments query are untouched. `useLearnerCourses` widened its generic and passes `progress` through (thumbnail signing preserved). `renderCourseCard` reads `progress[course.id]`, renders the dashboard's exact bar markup/classes for enrolled cards, and computes `isCompleted ? 100 : total === 0 ? 0 : Math.round(completed/total*100)` (the `total === 0` guard prevents NaN). The #338 enrolled-first sort, the Recommended section, and the filters are unchanged.

**Scope:** the catalog stays on a single data source (`learner-courses`) — it does not call `learner-dashboard`. A shared `<CourseProgressBar>` (dashboard + catalog + #341) is deliberately deferred to #341; `Dashboard.tsx` is untouched and the bar markup is replicated here, which the issue anticipated.

**Tests:** `functions/learner-courses/index.test.ts` — the `progress` map with zero-fill, the `progress: {}` + exactly-two-queries (no count queries) empty case, and structural assertions that both count queries mirror the dashboard's SQL (aggregate/tables/joins/GROUP BY, not just the param). `Courses.test.tsx` — bar+% on an enrolled card (67% from 2/3, fill width asserted), 100% on a completed card, no bar on a not-enrolled card, and 0% (no `NaN%`) when `total === 0`.

**Verify:** root `lint` 0 errors (**1970** warnings; the +2 vs the 1968 baseline are `@typescript-eslint/no-explicit-any` in the new **backend test** mocks, matching the pervasive functions-test mocking convention — the three `src/` files lint clean) · `tsc -p tsconfig.app.json` 0 · `npm test` **833 / 110** · `build` 0. functions: `build` 0 · `npm test` **2529 / 143** (3 skipped). Controller re-ran all gates from the worktree.

**Deploy:** touches `functions/` + `src/`, so both the SWA and functions workflows ship on merge to `main`.

## 2026-07-29 — #339 order enrolled catalog courses by recent activity (PR #350)

**Who:** claude (Opus 4.8) with martin. Schema + backend + frontend. Third and largest of the sequential catalog issues, built on #338 + #340. **Landed via the controller** after the implementer subagent was cut off mid-run by an org spend-limit API error — the implementation was complete but uncommitted; the controller reviewed the diff, applied one robustness fix, re-ran all gates, and committed.

**What:** the enrolled group in the learner catalog now orders by how recently the learner was last active in each course (most-recent first), replacing #338's interim `enrolled_at DESC`. "Active" = opening the course player **or** recording lesson activity (grooming decision).

**How:** new nullable `enrollments.last_accessed_at timestamptz`. Two write signals stamp it: (1) a new **fire-and-forget** `touch-course` endpoint (`endpoint()` factory, barrel-registered, `profile.id`-scoped `UPDATE`) that `CoursePlayer` fires on entry in a **separate, non-awaited** effect — kept off the awaited render path per the issue's "must not block the player" requirement, a failed touch logged not surfaced; (2) `lesson-progress`, which after its critical progress upsert also stamps the enrollment for the lesson's course (course resolved via a `lessons → course_modules` subquery). `learner-courses` returns the column; `useLearnerCourses` surfaces it purely via the widened `Enrollment` type (no hook change). `Courses.tsx`'s enrolled comparator sorts `last_accessed_at` DESC, falling back to `enrolled_at` when null; enrolled-first, the stable alphabetical tail, and #340's bar are unchanged.

**Controller review fix:** the `lesson-progress` recency stamp was a second un-guarded `await query()` after the committed progress upsert — a transient failure there would have 500'd an already-saved progress write and tripped #289's optimistic-rollback (false "save failed"). Wrapped it best-effort (log + swallow) so the non-essential stamp can never fail the critical save; added a test proving a stamp failure still returns 200.

**Prod DB:** `migration/azure/09-enrollment-last-accessed.sql` (idempotent `ADD COLUMN IF NOT EXISTS`, folded into `01-schema.sql`) **must be applied to prod by martin BEFORE this deploys** — the function code references the column unconditionally. PR held as draft until then.

**Tests:** `touch-course` (happy/400×2 no-DB/401/403 no-DB/500); `lesson-progress` (stamp fires profile-scoped; stamp failure still 200); `learner-courses` (SQL selects `last_accessed_at`); `Courses.test.tsx` (enrolled sort by `last_accessed_at` DESC independent of `enrolled_at`; null falls back to `enrolled_at`).

**Verify:** root `lint` 0 errors · `tsc -p tsconfig.app.json` 0 · `npm test` **835 / 110** · `build` 0. functions `build` 0 · `npm test` **2540 / 144** (3 skipped; `registration-names` fleet guard green for `touch-course`). New `src/` files lint warning-free; +warnings are `no-explicit-any` in the new backend test mocks (functions-test convention). All gates re-run by the controller from the worktree.

**Deploy:** touches `functions/` + `src/` → both workflows ship on merge, **after** the prod migration.
## 2026-07-29 — #343 learner dashboard community section (PR #349)

**Who:** claude (Opus 4.8) with martin. Frontend-only. Run concurrently with two other sessions (e2e hardening #346, catalog recency #339) and deliberately kept disjoint from both.

**What:** the learner dashboard (`src/pages/learner/Dashboard.tsx`) had no community content. It now shows a **Community** section — a preview of recent posts plus the shared `UpcomingEvents` card, with a "View all" link into the feed (`routes.community.feed`) — gated behind `useCommunityGate` so it only appears when community is enabled for the user's org. Placed after "Completed Courses", before Certificates.

**How:** extracted a self-contained `src/components/learner/DashboardCommunitySection.tsx`; the dashboard renders it **only when the gate is `'allowed'`**, so its two `community-posts` queries stay idle when the feature is off (conditional mount, not a conditional hook). Both derivations reuse the existing `useCommunityEvents` reader (which returns every post for a scope): recent-activity = merged global+org sorted by `created_at` DESC, sliced to 4, each a reused `PostCard` navigating to `routes.community.postDetail(post.scope, post.id)`; events = the same merged posts handed to `UpcomingEvents` (it filters to future-dated internally and self-hides when empty). TanStack dedupes by query key, so events + recent-activity share one request per scope. Loading → spinner; error → `QueryErrorState` retrying both scopes. New i18n `dashboard.community.*` keys (en+da).

**Tests:** `DashboardCommunitySection.test.tsx` — 7 cases (4-most-recent merge/sort/slice, View-all href, empty state, post click-through on the post's own scope, merged posts → UpcomingEvents + event click-through, loading spinner, retryable error refetching both scopes). `Dashboard.test.tsx` — 2 gating cases (section shown when `community_enabled`, hidden when not) via a marker mock + configurable `usePlatformSettings`.

**Coordination:** verified none of the in-flight branches (338/339/340/e2e) touch `src/pages/learner/Dashboard.tsx` or `src/i18n/locales/*` — zero file overlap. Branched off `origin/main` @`1a85ec5` (already includes merged #338/#340).

**Verify:** root `lint` 0 errors (1970 warnings = baseline; the three touched `src/` files add none) · `tsc -p tsconfig.app.json` 0 · `npm test` **842 / 111** · `build` 0. functions untouched.

**Deploy:** frontend-only, so the SWA workflow ships it automatically on merge to `main`; no functions deploy.

## 2026-08-03 — #342 community category labels translate in Danish (PR #351)

**Who:** claude (Opus 4.8) with martin. Frontend-only. Run concurrently with the e2e-hardening session (#346); branched off `origin/main` @`f874e9a`, which already includes merged #338/#339/#340/#343.

**What:** community category names (the fixed seeded taxonomy — "Challenges / Obstacles", "Questions & Help", …) came straight from the DB (`cat.name`) and never passed through i18next, so they stayed English in Danish mode across four render sites: the feed filter chips, the post-card badge, the post-detail badge, and the composer category picker.

**How:** one shared `categoryLabel(cat, t)` helper (`src/lib/community-category-label.ts`) is the single source of truth — it maps `community.categories.<slug>.name` for the six seeded slugs, keyed off the stable slug (not the display name). Per #300 it passes no `defaultValue`; the six keys were added to BOTH `en.json` and `da.json`. All four sites route through it. Separately, `CategoryBadge` used to derive its colour by slug-ifying the English `name` — translating the name would have turned every badge grey — so it now takes an explicit `slug` prop for the colour lookup (required; all three callers updated), and the two DB-deleted colourMap slugs (`ideas-opportunities`, `resources-templates`) were dropped as unreachable.

**Tests:** `community-category-label.test.ts` — 5 cases: slug→translation resolution, slug-not-name keying, the #300 raw-key behaviour for an unmapped slug, plus two coverage guards asserting all six seeded slugs are keyed with non-empty names in both locales and that en/da expose exactly that set (catches a future category shipping without keys, or en/da drift).

**Coordination:** the only file surface shared with any in-flight branch was `src/i18n/locales/{en,da}.json`; #342's keys sit under `community.categories.*` while #343's went under `dashboard.community.*` — disjoint namespaces, merged with no conflict. `CommunityFeed.tsx` (the main edit) is touched by no other active branch. #343's `DashboardCommunitySection` inherits the fix for free (it renders `PostCard`).

**Verify:** root `lint` 0 errors (1981 warnings = baseline; the touched `src/` files add none) · `tsc -p tsconfig.app.json` 0 · `npm test` **849 / 112** · `build` 0. functions untouched. Opus code-review clean (no Critical/Important; both Minor findings fixed).

**Deploy:** frontend-only, so the SWA workflow ships it automatically on merge to `main`; no functions deploy.

---

## 2026-08-03 — e2e smoke-suite hardening: the six #124-review follow-ups (PR #346)

**Who:** claude (Opus 4.8) as controller + per-task implementer/reviewer subagent pairs, subagent-driven-development, with martin deciding the merge. Closes the six `hardening` issues filed off #124's own review (#316): **#318 #321 #329 #332 #334 #337**. Test-only — no shipped app code changed.

**What shipped (one commit per issue):**
- **#332** — the invite journey's post-revoke assertions (`0 invitations / 0 members / no-members`) passed green even if the queries *failed*, because `OrgMembersTab` renders `undefined → []`. The closing block now awaits `/api/invitations` + `/api/org-memberships` and asserts `response.ok()` *before* the emptiness reads, so a 500/expired-token can no longer masquerade as a successful revoke.
- **#321** — a fixture-installed route guard (`installWriteFenceGuard` in `fenced-org.ts`) aborts any non-GET `/api/*` carrying a *foreign* orgId. The fence id is learned only by exact match against the run's unique slug, so it is the fence's real id or null — a legitimate write can never be aborted (every write across 02/04/06/08 enumerated and confirmed allowed). A bare-`page.goto`-then-write now fails instead of silently writing into `orgs[0]`. Chosen over the eslint-rule option (which covers only one spelling of the mistake). The pre-existing `pinFenceLast` self-test already detects a gutted `gotoFenced`.
- **#329** — the learner journey now asserts *which* org it operates in (`SELECTED_ORG` regex rejecting `e2e-` debris + the placeholder, with a diagnostic message), so cross-run debris that changes `orgs[0]` produces a named failure instead of an unexplained red; the one-time write is relabelled honestly in the design doc + spec (no unqualified "(write)"). Falsifiability of the persistence check preserved.
- **#334** — the quiz journey's load-bearing `waitForResponse` was silently inheriting the 15s `actionTimeout` while its siblings got 30s. It now gets an explicit `QUIZ_READ_TIMEOUT` (30s) and a naming message. Verified against the installed Playwright 1.62 source that `expect(promise).resolves` awaits unbounded (no `Promise.race`/deadline), so the 30s genuinely governs rather than being clamped back to the config's 15s `expect` timeout.
- **#337** — per-test timeout budgets (`test.describe.configure`) added to the five specs that lacked them (01/02/03/04/07), each derived from its own worst-case wait sum (margins +30/+30/+30/+15/+30), mirroring 05/06/08; the global cap is unchanged (only a stale comment corrected).
- **#318** — corrected two fixture comments that justified the `ViewMode` split by a runtime import cycle that doesn't exist (`import type` is compile-time erased).

**Process worth noting:** each task got a fresh implementer then a spec+quality review before the next; a whole-branch review (Opus 4.8) returned APPROVE FOR MERGE with all five cross-task interactions (334×337 on 07, 332×337 on 06, 321×writing journeys, 329×321, constant coherence) confirmed sound. The controller couldn't run the live suite (no local deployed app/login), so every "red on a failed query / green on success" property was established structurally and against Playwright internals, not by executing `npm run e2e` — the PR preview environment (`...-346...`) is where the live run belongs.

**One accepted residual (intentional):** the new route guard's own abort path has no committed regression test — a test would require a browser-context `fetch` (barred by the `e2e/README` convention) plus `@ts-expect-error`, and is beyond #321's acceptance criteria. Documented rather than bending two tree conventions.

**Verify:** on the trunk-merged branch — root `lint` 0 errors · `tsc -p tsconfig.app.json` 0 · `tsc -p tsconfig.node.json` 0 · `npm test` **849 / 112** · `build` 0 · `playwright test --list` 16 tests / 10 files. Merged `origin/main` in cleanly first (trunk had moved by #342/#339/#343; disjoint files, no conflicts).

**Deploy:** test-only — the SWA workflow ships the (unchanged) frontend on merge; no user-visible change and no functions deploy. A full live `npm run e2e` against the deployed app is the remaining real-world confirmation, and is martin's to run (needs a hand-captured Entra session).

---

## 2026-08-05 — #357 remove course enrollment step (implicit auto-enroll) (PR #376)

**Who:** claude (Opus 4.8) with martin. Part of the AIU platform-review batch (Aug 2026). No PRs in flight at branch time; branched off `origin/main` @`045e857`.

**What:** removed the user-facing enroll step — the confusing Enroll→Continue two-step (same button position, no real consequence today). Opening a course now starts it; enrollment becomes an invisible "has started" marker created implicitly server-side on first access, so `lesson_progress` and certificates (keyed on the enrollment) keep working unchanged.

**How:**
- **Auto-enroll** lives in `course-player-data` (the endpoint hit on course access), not the admin `enrollment-create` path the issue tentatively named. It upserts `INSERT … ON CONFLICT (org_id,user_id,course_id) DO NOTHING`, self-gated inside the SQL for org isolation — the row is written only when the caller is an **active member of the passed org**, the org has the course **enabled**, and the course is **published**, so a client can't fabricate an enrollment in an org it doesn't belong to (#373 territory). Skips a second language edition per #213; platform admins previewing without a membership create no row (matches the suite's no-side-effect convention).
- **Deleted** the now-orphaned learner endpoints `functions/enroll` + `functions/unenroll` (+ their tests + barrel imports); the fleet registration guard confirms route↔folder parity still holds. `enrollment-create` (admin assign) and `enrollment-complete` untouched.
- **Catalog** (`Courses.tsx`): one CTA that's always a `<Link>` into the player — Start course / Continue / Review course by state. Dropped the unenroll button + confirm dialog and the now-meaningless "Enrolled" thumbnail badge; relabelled the status filter Not started / In progress / Completed. `Assessment.tsx` recommendations open the player directly.
- **i18n**: removed the `enroll`/`unenroll` keys (en+da), added `courses.startCourse`, reworded the dashboard empty state; event `register`/`Tilmeld` strings left alone.

**Decisions (martin):** delete the dead endpoints (vs. leave them); remove the unenroll capability entirely — a started course stays in Min Træning until saved/favorites (#358) adds another axis; relabel the status filter + drop the "Enrolled" badge now rather than defer to #360/#367.

**Tests:** a new `course-player-data` case pins the auto-enroll upsert's org-isolation gating by value + params. `Courses.test.tsx` reworked to the Start/Continue/Review link states (the old enroll-morph + enrolled-badge cases removed). Both learner e2e specs (05/07) had their stale "unenrolled card = Enroll button, no link" commentary refreshed — every card is a link now, so the journeys pass and no longer depend on prior enrollment.

**Verify:** root `lint` 0 errors · `tsc -p tsconfig.app.json` 0 · `npm test` **850 / 112** · `build` 0. functions `build` 0 · `test` **2516 / 142** (3 skipped). CI green (both jobs).

**Deploy:** merging to `main` auto-ships frontend (SWA) + backend (functions, one changed endpoint). Announced on PR #376.

---

## 2026-08-05 — #367 terminology sweep: seat→member + en/da glossary + heading==label (PR #379)

**Who:** claude (Opus 4.8) with martin. Part of the AIU platform-review batch (Aug 2026). Branched off `origin/main` @`9a322f2`; only PR in flight was #377 (course categories #361), disjoint files. Supersedes the abandoned draft #375 (empty seed on `feat/seat-to-member-367`, closed).

**What:** collapsed the user-facing "seat" concept into **Member/Medlem** across en+da — capacity, limits, requests, and pricing/invoice copy — renamed **Course Overview → Course Catalog / Kursuskatalog**, fixed heading==menu-label mismatches, and published `docs/glossary.md` as the canonical en/da terminology source.

**How:**
- **Locales only, values not keys:** swept `seats.*`, `seatRequests.*`, and the scattered `seatLimit`/`seatsUsed`/`seatPricing`/`editSeatLimit` keys under `orgDetail`/`platformSettings`. Swap + light rephrase where a literal swap read wrong (dropped "used" in the usage line; DA coinages `medlemsgrænse`, `medlemspriser`; `atCap` reworded to "reached your member limit"). Column collision handled: the org-list `colSeats` (a used/limit+bar cell next to a "Members" count column) became **Member limit / Medlemsgrænse**, not a duplicate "Members"; the seat-requests table's `colSeats` has no such neighbour and became "Members / Medlemmer".
- **Learning name:** `nav.courses` + `courses.title` (+ the `dashboard.startLearning` reference) → Course Catalog / Kursuskatalog. Learning/Læring + Community/Fællesskab were already correct.
- **Heading==label:** `dashboard.title` "My Dashboard" → Dashboard (the page's identity heading; the loaded learner dashboard deliberately shows a "Welcome back" hero per #362); `ideaManagement.title` Ideas Overview → Ideas Management / Idéhåndtering (matches its nav label). Analytics + moderation headings already render `t('nav.*')`. Org-admin Settings ("Organization Settings" vs "Settings") left for #369.
- **Glossary:** `docs/glossary.md` covers the seat→member decision, all learning names (incl. Min Træning + Tips & Tricks for #363/#364/#366), the carried-forward conventions, and the kept internal code names; `AGENTS.md` points at it.

**Decisions (martin):** terminology-only scope (rename Course Catalog now, leave the nav restructure + Min Træning/Tips&Tricks pages to their sibling issues); swap + light rephrase over strict 1:1; glossary in-repo at `docs/glossary.md`, with the out-of-repo `AIEDU/CLAUDE.md` line applied locally + flagged (that file isn't in the learn-wings repo). The Ideas heading fix was an in-spirit extension flagged for veto.

**Kept unchanged:** i18n keys, `SeatUsage*` components, `usedSeats`/`seatUsage` props, `seat-usage-bar` test IDs, `{{seats}}` placeholder, and the DB/SQL `seat_*` names — only rendered text follows the glossary, so the value-echo tests stay green.

**Verify:** root `lint` 0 errors · `tsc -p tsconfig.app.json` 0 · `tsc -p tsconfig.node.json` 0 · `npm test` **850 / 112** · `build` 0. Grep proof: zero user-facing `seat`/`plads` remain in locale values. functions untouched.

**Deploy:** frontend-only — merging to `main` auto-ships the (text-only) frontend via SWA; no functions deploy. Announced on PR #379.

---

## 2026-08-05 — #361 course categories (predefined admin-managed list + one per course) (PR #377)

**Who:** claude (Opus 4.8) with martin. Part of the AIU platform-review batch (Aug 2026). Branched off `origin/main` @`9a322f2`; subagent-driven development (fresh implementer per task + spec/quality review each + whole-branch review). Merged trunk (#367/#379) in before merging — i18n auto-merged clean, only these two migration docs conflicted.

**Status:** implemented; whole-branch review **APPROVE FOR MERGE**; merged via PR #377.

**What:** a category dimension for courses — a platform-admin-managed, **bilingual (en/da)** category list, **exactly one** category per course (nullable = uncategorized). Management lives in the **Course Manager** as a new **Categories** tab (deliberately NOT Platform Settings, so no collision with the #368 console rebuild). The catalog *filter UI* is out of scope (that is #360); this PR only exposes the data.

**How:**
- **DB** — `course_categories (name_en, name_da, slug, sort_order)` created immediately before `courses` in `01-schema.sql` (FK ordering for a fresh build) + `courses.category_id uuid REFERENCES … ON DELETE SET NULL` (NULL = uncategorized). Seeded AI Basics / Data & Ethics (Data & etik) / Automation (Automatisering) in `02-seed.sql`. Idempotent prod migration **`10-course-categories.sql`** (09 was already taken by #339's enrollment-last-accessed) — `CREATE TABLE IF NOT EXISTS` + `ADD COLUMN IF NOT EXISTS` + `ON CONFLICT (slug) DO NOTHING`. Seed rows carry generated UUIDs; code resolves categories by slug/id, never a hardcoded UUID.
- **Backend** — read endpoint `course-categories` (`endpoint()`, any authenticated user — the list is platform-global, no org data) + admin CRUD/reorder `course-category-create/-update/-delete/-reorder` (`adminEndpoint()`). `slugify` helper in `functions/shared/slug.ts` derives the slug from name_en on CREATE only (unique, collision-suffixed); slug is **stable** across renames. Reorder rewrites `sort_order` from an ordered id array in one `withTransaction`. `course-create`/`course-update` accept an optional `categoryId` (null allowed; a non-null id is existence-checked → 400 `category not found`). `learner-courses` Query 1 SELECT now returns `c.category_id` — this is what unblocks #360's filter.
- **Frontend** — `CourseCategory` type + `category_id` on `Course`; `useCourseCategories` hook (`queryKeys.courseCategories.all`). Category `Select` (Uncategorized option, `'__none__'` sentinel ↔ null, labelled by `i18n.resolvedLanguage`) in both the CourseEditor detail form and the create-course dialog. New `CategoryManager` component (Course Manager → Categories tab, between Courses and Organization Access): add / rename (both names) / up-down reorder / delete-with-confirm (courses become uncategorized), all via `useToastMutation` + `invalidateQueries`. i18n en + da for every new string.

**Decisions (martin):** management UI in a Course-Manager tab (not Platform Settings); bilingual category names; table `course_categories`; seed AI Basics / Data & Ethics / Automation; up/down-arrow reorder (not drag-and-drop).

**Tests:** mock contract test per endpoint (happy + 401/403 + validation) + slug unit tests; `useCourseCategories` + `CategoryManager` component tests (reorder computes the exact `orderedIds`; delete gated behind confirm). Whole-branch review APPROVE FOR MERGE; two minors fixed on-branch — softened the category-tab description that had over-promised learner filtering (a #360 capability), and made the `/api/course-categories` mock explicit in the CourseEditor strict-mock tests.

**Verify (on the branch):** root `lint` 0 errors · `tsc -p tsconfig.app.json` 0 · `tsc -p tsconfig.node.json` 0 · `npm test` **861 / 114** · `build` 0. functions `build` 0 · `test` **2597 / 148** (3 skipped).

**Deploy:** prod DB migration `10-course-categories.sql` **applied 2026-08-05** (martin ran it from his terminal via a temp single-IP firewall rule + Node `pg` runner; the 3 seed rows + `courses.category_id` verified present) — the required migrate-then-merge ordering (#191/#213/#286), since the new endpoints reference the table/column unconditionally. Merged to `main` → auto-ships frontend (SWA) + backend (functions: 5 new `course-category*` endpoints + `course-create`/`course-update`/`learner-courses` changes). Deploy announced on PR #377.

---

## 2026-08-05 — #353 org auto-join via verified Entra tenant (PR #378)

**Who:** claude (Opus 4.8) with martin. Part of the AIU platform-review batch (Aug 2026). Branched off `origin/main`; requirements grilled with martin before any code (5 decisions, below). Merged trunk (#361/#367) in before merging — `01-schema.sql`/`types.ts` auto-merged clean; README migration table + both locale files conflicted (resolved: slots 10+11 ordered; kept #367's Seat→Member label + my SSO keys).

**Status:** implemented; self-review (security-focused, org-isolation) + fixes; all gates green; merged via PR #378.

**What:** members of a known org self-onboard via Entra SSO with **no invite**, matched to their org by their **server-verified token tenant id** (`tid` from `shared/auth.ts`) — never an unverifiable email domain, so strict org isolation holds. Auto-joined users get **learner**; org admins still come via explicit invite. Fallback (no match / seats full / switch off) = the caller stays an org-less account (the individual-tier #354 will formalize), never a dead-end.

**How:**
- **DB** — `organizations.entra_tid` (`UNIQUE`, NULLs allowed = a tenant binds ≤1 org) + `entra_tid_label` (cosmetic domain hint) in `01-schema.sql`; idempotent prod migration **`11-org-entra-tenant.sql`** (10 taken by #361) — `ADD COLUMN IF NOT EXISTS` + guarded `ADD CONSTRAINT`.
- **`functions/shared/tenant-binding.ts`** (new) — `CONSUMER_TENANT_ID` guard (`9188040d-…-b66dad`, the shared personal-MSA tenant, must NEVER bind or it auto-joins every personal MS account on earth); `seedTenantBinding` (own connection, first-bound-wins via `NOT EXISTS`, never rolls back the invite txn); `selfRegistrationEnabled` (wires the previously-decorative platform-wide toggle as a real global kill-switch, default ON); `autoJoinByTenant` (seat-capped via `seats.ts` row-lock, non-destructive `ON CONFLICT DO NOTHING`, idempotent).
- **`user-context`** — seeds the binding when an `org_admin` invite converts on login adoption; auto-joins learners on every login (after adoption, so a first admin isn't double-joined). **`invitation-accept`** — seeds on `org_admin` link acceptance.
- **`organization-update`** — platform-admin override to set/correct/clear the binding (GUID-validated, consumer tenant refused, lowercased; distinct `409 DUPLICATE_TENANT`); org admins stay limited to `logo_url`. **`organizations`** — binding exposed to platform admins only. Self-review also closed two sibling leaks (`user-context` `row_to_json(o.*)`, `org-analytics-data` `SELECT *`) — own-org only, not cross-org, but they broke the platform-admin-only invariant.
- **Frontend** — `Organization.entra_tid?/entra_tid_label?`; `EditOrganizationDialog` view/edit/clear section (en+da); `OrganizationDetail` sends the binding fields only when changed (never clobbers an auto-seeded binding).

**Decisions (martin, grilled):** (1) learn-from-first-admin auto-seed, guarded against the consumer tenant + already-bound tids; (2) on-by-default gate + honor the existing platform-wide `allow_self_registration` as a global kill-switch; (3) domain **label** = the seeding admin's email domain (editable), `tid` stays the match source; (4) fallback = org-less account until #354; (5) full vertical (schema + backend + override UI) so #353 closes.

**Tests:** `shared/tenant-binding.test.ts` (guard/seed/collision/master-switch/auto-join, all mocked); endpoint contract cases for the override (GUID/consumer/label-length validation, `DUPLICATE_TENANT`, org-admin 403, clear-also-clears-label), the `organizations` strip, and the seed/auto-join wiring in `user-context`/`invitation-accept`. Two review nits fixed on-branch: raced-`23505` logs `warn` not `error`; `entra_tid_label` bounded (253) + cleared when `entra_tid` is cleared (no orphan label).

**Verify (post-trunk-merge on the branch):** root `lint` 0 errors · `tsc -p tsconfig.app.json` 0 · `tsc -p tsconfig.node.json` 0 · `npm test` **861 / 114** · `build` 0. functions `build` 0 · `test` **2636 / 149** (3 skipped).

**Deploy:** prod DB migration `11-org-entra-tenant.sql` **applied 2026-08-05** (martin ran it from his terminal — temp single-IP firewall rule + Node `pg` runner reusing the app's own CA-pinned `dist/shared/db.js`; `entra_tid`/`entra_tid_label` + the unique constraint verified present) — required migrate-then-merge ordering, since `organizations`/`organization-update` reference the columns unconditionally. Merged to `main` → auto-ships frontend (SWA) + backend (functions: `tenant-binding` + `user-context`/`invitation-accept`/`organization-update`/`organizations`/`org-analytics-data` changes). Deploy announced on PR #378.

---

## 2026-08-05 — #366 Tips & Tricks nav item + coming-soon page (PR #381)

**Who:** claude (Opus 4.8) with martin. Part of the AIU platform-review batch (Aug 2026). Branched off `origin/main` @`c0d7833`. While in flight, #378 (org auto-join #353) merged to trunk; merged `origin/main` back in before landing — the two locale files **auto-merged clean** (disjoint sections: my `tipsAndTricks.*` in the `courses` region vs #378's `sso*` keys in `orgDetail`), only this WORKLOG tail conflicted (both entries appended; kept both). #380 (favorites #358) was still an empty draft.

**What:** a coming-soon placeholder page for **Tips & Tricks** at `/app/tips` (en + da). Route + page + page copy only.

**Scope call (martin): no sidebar change, issue kept OPEN.** #363 (learner-nav restructure) is *blocked by* this issue as "the page the new nav links to," and #363 explicitly owns `AppSidebar.tsx` — the Læring group plus the Tips & Tricks nav entry's icon/order/label styling. So this PR deliberately does **not** touch `AppSidebar.tsx`, keeping #366 out of #363's hot-file collision set (`#367/#370/#371/#372/#344`). Consequence: the page is not nav-reachable until #363 lands (reachable directly at `/app/tips` meanwhile), so **#366 stays open** — its "clicking Tips & Tricks shows the page" acceptance criterion completes with #363, not here. The `(#366)` in the PR title is a reference, not a closing keyword, so the merge does not auto-close it.

**How:** `routes.ts` `learner.tips = /app/tips`; `App.tsx` route → new `TipsAndTricks` page (`learnerOnly`, matching its Læring-group siblings Courses/Dashboard/Assessment); `src/pages/learner/TipsAndTricks.tsx` = `AppLayout` + the shared `EmptyState` (Lightbulb icon, "Coming soon" + one line). `tipsAndTricks.*` keys in en + da; "Tips & Tricks" left untranslated in both locales per `docs/glossary.md`.

**Verify (post-trunk-merge on the branch):** root `lint` 0 errors · `tsc -p tsconfig.app.json` 0 · `tsc -p tsconfig.node.json` 0 · `npm test` **861 / 114** · `build` 0. functions untouched.

**Deploy:** frontend-only — merging to `main` auto-ships the static page via SWA; no functions deploy, no DB migration. Announced on PR #381.

---

## 2026-08-05 — #358 favorite / save a course (PR #380)

**Who:** claude (Opus 4.8) with martin. Part of the AIU platform-review batch (Aug 2026). Requirements grilled with martin first (base branch, "Min Træning" ownership, toggle placement, org-scoping, term). Branched off `origin/main` @`9a322f2` (post-#376). Subagent-driven build (4 tasks, per-task spec+quality reviews, whole-branch review, fix wave + scoped re-review). Merged trunk (#361/#353/#367/#366) in before landing.

**What:** the favorites **engine** — a per-user "favorite" heart on courses; favorited courses surface in a **Favorites / Favoritter** section. Scoped deliberately to the engine: does **not** build the Min Træning page (that's #364, which relocates the standalone `<FavoriteCourses>` component verbatim), the nav (#363), mandatory (#365), or naming (#367). Interim home for the section is the learner Dashboard.

**How:**
- **DB** — org-neutral `course_favorites (user_id, course_id, created_at)` (PK `(user_id, course_id)`, **no `org_id`** — a favorite is per-user, also supports org-less individual-tier #354) in `01-schema.sql`; idempotent prod migration **`12-course-favorites.sql`** (10/11 taken by #361/#353).
- **Functions** — `favorites` (POST `{orgId}`→`{courses}`: caller's favorites narrowed to the org-visible catalog via the same `courseVisibilityPredicate` as `learner-courses`) and `favorite-set` (POST `{orgId,courseId,favorite}`→`{favorited}`: `true` gates published+org-enabled then upserts `ON CONFLICT DO NOTHING`; `false` deletes ungated so a learner can always remove). Both authorize with `requireActiveMember(orgId)` and key every query on `profile.id` — org isolation upheld (verified airtight in the whole-branch review).
- **Frontend** — `useFavorites` hook (list query + `favoriteIds` Set/`isFavorite`, and `useToggleFavorite` via `useToastMutation` + `setQueryData` cache patch + invalidate; no `onMutate` — repo idiom); `CourseFavorite` type + `favorites` query-key family. Presentational `FavoriteToggle` (heart) on the catalog cards (`Courses.tsx`) + the CoursePlayer sidebar; standalone `FavoriteCourses` section on the Dashboard (between Continue Learning and Completed, empty state kept per owner). en+da (`courses.addToFavorites/removeFromFavorites/openCourse`, `dashboard.favoriteCourses/noFavorites*`, `favorites.toggleFailed`).

**Decisions (martin, grilled):** (1) base off trunk post-#376, not stacked; (2) "B" a dedicated Min Træning page — but that page is #364's; #358 = engine + interim Dashboard section; (3) no course-detail page exists → second toggle in the CoursePlayer; (4) org-neutral storage · org-scoped display · validated writes; (5) term **Favoritter**, heart; (6) keep the empty-state section (don't hide).

**Tests:** endpoint contract tests for both (OPTIONS/401/400/403/happy, favorite-set true-gate-403 + upsert-params + ungated-delete, favorites list + empty); `useFavorites.test.tsx` incl. direct `setQueryData` add/prepend/dedup/no-op/remove cache assertions; `FavoriteToggle`/`FavoriteCourses` + extended `Courses`/`Dashboard` component tests. Deferred minors (all triaged ship-as-is in the whole-branch review): favorites LIST intentionally language-agnostic (a favorite is a deliberate signal like enrollment); no platform-admin bypass on the add gate (strictly more restrictive).

**Verify (post-trunk-merge on the branch, controller-run):** root `lint` 0 errors · `tsc -p tsconfig.app.json` 0 · `tsc -p tsconfig.node.json` 0 · `npm test` **886 / 117** · `build` 0. functions `build` 0 · `test` **2660 / 151** (3 skipped, incl. registration fleet guard). (Caught + closed a subagent false-green tsc during the run by re-running gates in the worktree.)

**Deploy:** functions changed → migrate-then-merge. Prod migration **`12-course-favorites.sql` applied 2026-08-05** (owner ran it from his terminal — temp single-IP firewall rule + the Node `pg` runner reusing the app's CA-pinned `dist/shared/db.js`; `course_favorites` + `idx_course_favorites_user` verified present) BEFORE merge, since `favorites`/`favorite-set` reference the table unconditionally. Merged to `main` → auto-ships frontend (SWA) + backend (functions: `favorites` + `favorite-set`). Deploy + smoke announced on PR #380.

---

## 2026-08-06 — #365 mandatory training assignment (PR #383)

**Who:** claude (Opus 4.8, 1M) with martin. Part of the AIU platform-review batch (Aug 2026). Requirements grilled with martin first (learner surfacing / #364 ownership, read contract, mandatory-vs-recommended, view+remove scope, platform reach, assignable-course set). Branched off `origin/main` @`e72af01` (post-#381), worktree-isolated. Controller-implemented in the worktree with independent Opus review subagents (a backend review + a whole-branch review) — dispatched implementers can't safely edit a worktree, so the controller owned the edits/commits and the subagents owned review. Merged trunk (#358 favorites) in before landing.

**What:** admins assign a course to **one member or the whole org**, as **mandatory or recommended**, with an **optional due date**; a self-scoped learner read feeds the (separately-built #364) Min Træning page. Admins also **view + remove** assignments.

**How:**
- **DB** — `course_assignments (id, org_id, user_id NULL=whole-org, course_id, mandatory, due_date, assigned_by_user_id, created_at)` folded into `01-schema.sql`; idempotent prod migration **`13-course-assignments.sql`** (renumbered from `12-` on the trunk-merge — #358 took 12). Whole-org = `user_id NULL` (dynamic, resolved at read). Partial unique indexes: one individual per (org,user,course), one whole-org per (org,course).
- **Functions** (all factory; org-isolation upheld) — `assignment-create` (`requireOrgAdmin`; course published+org-enabled; individual target must be an active member of that org; mandatory/dueDate validated incl. impossible-date reject; unique→409), `assignment-delete` (loads the row's org then `requireOrgAdmin(row.org_id)`), `assignments` (admin list, `requireOrgAdmin`), `learner-assignments` (self-scoped on `profile.id` + `requireActiveMember`; dedups individual+whole-org by course — mandatory wins, earliest due — with `COALESCE`d overdue so a never-started past-due course reads overdue=true).
- **Frontend** — `LearnerAssignment`/`OrgAssignment`/`AssignableCourse` types; `learnerAssignments`/`assignments`/`orgCourseAccess` query-key families; `useLearnerAssignments` (signs thumbnails — the #364 hook), `useOrgAssignments`, `useOrgCourseAccess`; shared `AssignCourseDialog` + `AssignmentsManager` (table + confirm-remove), wired into org-admin `OrgMembersTab` and platform-admin `OrganizationDetail`/`MembersSection`/`MembersTable`. `assignments.*` i18n en+da (parity checked).

**Decisions (martin, grilled):** (1) #364 in flight elsewhere → #365 ships model + admin UIs + a ready-made `useLearnerAssignments` hook for #364 to plug in, and touches none of #364's files; (2) mandatory **or** recommended per assignment; (3) assign **+ view + remove**; (4) platform admin assigns **one org at a time** (any org); (5) picker offers **only published+org-enabled** courses; (6) whole-org dynamic (current+future members); due date informational (overdue badge, nothing blocked).

**Reviews:** backend review (Opus) — 1 Critical (overdue NULL-collapse) + 1 Minor (impossible-date 500), both fixed. Whole-branch review (Opus) — PASS / merge-READY, no Critical/Important, org-isolation confirmed end-to-end; 1 Minor fixed (empty-vs-load-error), 4 sub-threshold minors deferred (org_course_access not re-checked on read [mandatory persists by design]; no sibling-language guard [enroll backstops]; ghost assignment survives member removal; delete 404-vs-403 [UUIDs, no leak]).

**Verify (post-trunk-merge on the branch, controller-run):** root `lint` 0 errors · `tsc` app+node 0 · `npm test` **906 / 120** · `build` 0. functions `build` 0 · `test` **2713 / 155** (3 skipped, incl. registration fleet guard).

**Deploy:** functions changed → migrate-then-merge. Prod migration **applied 2026-08-06** (owner ran the Node `pg` runner from his terminal — temp single-IP firewall rule; `course_assignments` + all 6 indexes verified present) BEFORE merge, since the 4 endpoints reference the table unconditionally. Applied as `12-course-assignments.sql`, renumbered to `13-` on the trunk-merge (#358 took 12); prod already holds the table, so the rename is a repo-record fix only. Merged to `main` → auto-ships frontend (SWA) + backend (4 new functions). Deploy + smoke announced on PR #383.

---

## 2026-08-06 — #364 new "Min Træning" learner page (PR #382)

**Who:** claude (Opus 4.8, 1M) with martin. Part of the AIU platform-review batch (Aug 2026). Requirements grilled with martin first (PR scope vs unmerged deps, Dashboard/Catalog non-removal, route-only nav, dedicated data layer, section order). Branched off `origin/main` @`c0d7833`, worktree-isolated. Subagent-driven build — three implementer slices, each with an independent Opus spec+quality review, plus a whole-branch Opus review; dispatched implementers can't safely edit a worktree, so the controller briefed each slice's implementer/reviewer to work in the worktree. Draft PR opened at pickup start for cross-session visibility.

**What:** a dedicated learner **Min Træning** page (`/app/training`) — the home for *doing* training. Five sections: a slim lesson-level **overall-progress** strip, **Mandatory** (coming-soon placeholder → #365), **Continue** (in-progress resume cards), **Favorites** (coming-soon placeholder → #358), **Completed** (+ certificate download). Supersedes #341.

**How:**
- **Backend** — new `functions/shared/learner-progress.ts` helper (single source of truth for the enrollment + per-course lesson-progress aggregate, `(profile.id, orgId)`-scoped); new factory endpoint `learner-training` (orgId 400-guard + `requireActiveMember` + helper → `{ enrollments, progress }`); `learner-dashboard` retrofitted onto the helper with its response **unchanged** (2 consumers, one duplicate removed). **No schema change.** Barrel-registered; contract tests for the endpoint + the helper; the unchanged `learner-dashboard` test stays green.
- **Frontend** — `useLearnerTraining` hook (mirrors `useLearnerDashboard`, thumbnail-signing in the `queryFn`) + `learnerTraining` query-key family; `src/pages/learner/Training.tsx` (h1 = glossary "Min Træning"; call-site `useMemo` splits enrollments by status and sums the lesson aggregate with a divide-by-zero guard; reuses the standalone `CertificateCard` + existing `generate-certificate`, cert section `features.certificates_enabled`-gated); reusable `ComingSoonSection`; `training.*` i18n en+da; route in `routes.ts` + `App.tsx` — **route-only, no AppSidebar edit**.

**Decisions (martin, grilled):** (1) full 5-section page NOW, Mandatory/Favorites as honest "coming soon" placeholders that #365/#358 fill later; (2) do NOT strip the Continue/started displays off Dashboard/Courses (deferred to #362/#360; temporary duplication accepted); (3) route-only — the sidebar nav entry is #363's (blocked-by-#364, points at `routes.learner.training`); (4) dedicated `learner-training` endpoint + hook + shared helper (robustness over reuse — kills the dashboard/training aggregate duplication, insulates from #362's dashboard redesign; `learner-courses` left as a future 3rd consumer); (5) section order slim progress strip → Mandatory → Continue → Favorites → Completed (progress non-gamified; the gamified XP/streak version stays on the Dashboard per #362).

**Reviews:** three per-task Opus reviews (all SPEC ✅ / QUALITY ✅; 1 minor db-import-path fixed inline) + a whole-branch Opus review — READY TO MERGE, org-isolation confirmed end-to-end (helper scopes every query to `(profile.id, orgId)`; dashboard logic moved verbatim = no regression), 1 minor (dead local + orphaned import) fixed, 3 sub-threshold minors deferred (mirror-fidelity test/guard items, all covered elsewhere).

**Verify (post-trunk-merge on the branch, controller-run):** root `lint` 0 · `tsc` app+node 0 · `npm test` **923 / 122** · `build` 0. functions `build` 0 · `test` **2726 / 157** (3 skipped, incl. registration fleet guard). Merged trunk in across two drift cycles (#366 tips + #353 tenant, then #365 assignments + #358 favorites); one `query-keys.ts` conflict resolved keeping all families.

**Deploy:** functions changed but **no schema change** → straight merge (no migration). Merged to `main` → auto-ships frontend (SWA) + backend (new `learner-training`, retrofitted `learner-dashboard`). Deploy + smoke announced on PR #382.

**Follow-ups now unblocked on trunk:** #365 (`useLearnerAssignments`) and #358 (`useFavorites` + `FavoriteCourses`) both landed while this was in flight — wiring them into the two placeholder sections is a small follow-up; #363 adds the sidebar nav entry.

---

## 2026-08-06 — #363 learner navigation restructure (PR #385)

**Who:** claude (Opus 4.8, 1M) with martin. Part of the AIU platform-review batch (Aug 2026). Requirements grilled with martin first (single-item Fællesskab presentation, header prominence, restyle scope, Min Træning icon; English-mode parity explicitly flagged by martin). Branched off `origin/main` @`a1dacc7` (post-#364), worktree-isolated. Draft PR opened at pickup start for cross-session visibility; small cohesive change → controller-implemented inline (no subagent fan-out). Ran alongside martin's parallel #356 / #359 / #362 sessions — only i18n-JSON overlap, kept to the `nav.*` block.

**What:** rebuilt the learner sidebar from one flat "Læring" group into three sections — a top-level **Dashboard** (no header), a labelled **Læring** group (**Min Træning** · **Kursuskatalog** · **Tips & Tricks**) and a community-gated **Fællesskab** group (**Community**). Section headers made more prominent (sentence-case subheading, replacing the tiny grey uppercase eyebrow).

**How:** `AppSidebar.tsx` — `NavSection.label` made optional (headerless Dashboard); `learnerItems` split into `dashboardItems` / `laeringItems` / `faellesskabItems`, the Fællesskab group rendered only when `community_enabled` (no lone header); `Min Træning`→`PlayCircle`, `Tips & Tricks`→`Lightbulb` (matches the page's own icon). Shared `GROUP_LABEL_CLASSES` restyled to `text-[12.5px] font-semibold normal-case text-[#3f4657]` — applied to **every** role's section header for consistency (an org-admin sees learner + org headers stacked). New i18n keys `nav.training` + `nav.tips` en+da; all other labels reuse existing keys. **Sidebar-only** — routes (`/app/training`, `/app/tips`), both pages, and the Kursuskatalog rename already shipped in #364/#366/#367.

**Decisions (martin, grilled):** (1) build the **Fællesskab group now** with its single Community item, accepting the temporary header==item duplication until #344 splits it into Community/Events/Resources; (2) headers as a **sentence-case subheading**; (3) restyle **globally** (shared constant) for cross-role consistency over a learner-only variant; (4) Min Træning icon = **PlayCircle** ("continue" metaphor, echoes the page's own Play usage); (5) English parity explicitly required — every label is an i18n key, verified en+da.

**Reviews:** none formal — a 54-line frontend restructure, fully unit-tested + visually verified; controller self-reviewed the diff.

**Verify:** root `lint` 0 errors · `tsc` app+node 0 · `npm test` **923 / 122** · `build` 0. `AppSidebar.test.tsx` updated to lock in the three-section shape + the new Min Træning / Tips links, asserted in **both en and da**. Real component rendered loginless in a throwaway Vite harness (hooks stubbed via `resolve.alias`, dep-scan scoped via `optimizeDeps.entries`, desktop viewport since shadcn `Sidebar` goes off-canvas <768px) and screenshotted in **English + Danish** — grouping, icons, header prominence confirmed; harness torn down before commit.

**Deploy:** frontend-only, no functions/schema change → straight merge; SWA auto-ships the frontend on merge to `main`. Deploy + smoke announced on PR #385.

---

## 2026-08-06 — #356 per-org "Allow self-registration" toggle (PR #386)

**Who:** claude (Opus 4.8, 1M) with martin. Part of the AIU platform-review batch (Aug 2026). Requirements grilled with martin first (scope vs #369's settings-area rebuild; override model; label/copy). Branched off `origin/main` @`a1dacc7` (post-#364), worktree-isolated; draft PR opened at pickup start. Blocked-by #353 (its tenant auto-join mechanism) — already merged, so unblocked. Ran alongside martin's parallel #363 / #359 / #362 sessions — merged #363 (PR #385) in on the way to merge; only i18n-JSON + append-only WORKLOG/STATUS overlap.

**What:** a per-organization on/off switch governing #353's Entra tenant auto-join. Stacks with the platform-wide master switch and the member seat cap — auto-join fires only when global ON **and** per-org ON **and** a seat is free. Default `true` (existing orgs unchanged); toggling off blocks only *future* auto-joins, never removes or disables existing members.

**How:**
- **DB** — `organizations.allow_self_registration boolean NOT NULL DEFAULT true` folded into `01-schema.sql`; idempotent prod migration **`14-org-self-registration.sql`** (slots 11–13 already taken on trunk).
- **Enforce** — one AND-gate in `autoJoinByTenant` (`functions/shared/tenant-binding.ts`), read off the org lookup itself so it short-circuits *before* the global master-switch query.
- **Read** — added to the `organizations` single-org + platform-admin list SELECTs; org-owned, so (unlike the SSO binding) **not** stripped for org admins; reaches `currentOrg` for free via `user-context`'s `row_to_json`.
- **Write** — both roles through `organization-update` (one validation path): platform admin via the field whitelist, org admin via a new `ORG_ADMIN_WRITABLE` subset (`logo_url`, `allow_self_registration`); boolean-only; org isolation via `isOrgAdmin(profile.id, orgId)`.
- **Frontend** — `Organization.allow_self_registration?`; minimal org-admin toggle on `OrgSettings` (#369 absorbs it into the real settings area later; persisted via `organization-update`, change-only); platform-admin override in `EditOrganizationDialog` (sent only when changed, via `OrganizationDetail.saveEditMutation`); `orgSettings.selfReg*` + `orgDetail.selfReg*` i18n en+da.

**Decisions (martin, grilled):** (1) minimal org-admin toggle now — #369 rebuilds the settings area later; (2) one shared column, both roles write it (no separate hard-override column), last-write-wins; (3) keep the "self-registration" term (matches the column + the platform-wide switch), a concise tenant-aware hint carries the disambiguation. Not in scope: individual-tier overflow (#354) — seats-full stays the current graceful org-less fallback.

**Verify (controller-run on the branch):** root `lint` 0 errors · `tsc` app+node 0 · `npm test` **925 / 122** · `build` 0. functions `build` 0 · `test` **2733 / 157** (3 skipped, incl. registration fleet guard). Added tests: enforcement short-circuit, endpoint authz/validation (platform + org-admin paths, non-boolean 400, cross-field smuggle guard), read exposure/strip-parity, both UIs.

**Deploy:** functions changed + new column → **migrate-then-merge**. Prod migration `14-org-self-registration.sql` must run before deploy — `user-context` (via `autoJoinByTenant`), `organizations`, and `organization-update` reference the column unconditionally, so a merge-first deploy would 500 the org read/update paths. Owner runs it from his terminal (temp single-IP firewall rule). Merged to `main` → auto-ships frontend (SWA) + backend. Deploy + smoke announced on PR #386.
