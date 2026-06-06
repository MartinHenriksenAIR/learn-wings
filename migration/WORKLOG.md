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
