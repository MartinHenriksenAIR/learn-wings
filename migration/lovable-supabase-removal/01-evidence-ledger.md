# 01 — Evidence Ledger

All Supabase and Lovable references found in the repository and Azure. Classified by category.
Secret values are redacted. Domain hostnames are recorded as they are central to migration evidence.

## Legend
- **Category**: runtime | config | deployment | test | doc | dead-code | package | db-rpc | azure-config
- **Blocker**: Yes = must be removed/replaced for migration; No = cleanup only

---

## LOVABLE REFERENCES

| ID | Category | Source | File/Resource | Line | Identifier | Related Function | Interpretation | Blocker | Confidence |
|----|---------|--------|--------------|------|-----------|----------------|----------------|---------|-----------|
| L01 | runtime | repo | supabase/functions/azure-delete-blob/index.ts | 5 | `https://learn-wings.lovable.app` | azure-delete-blob | CORS allowlist origin | Yes | High |
| L02 | runtime | repo | supabase/functions/azure-delete-blob/index.ts | 6 | `https://id-preview--ee335e84-7b72-46fe-bdb4-cd3d716c9247.lovable.app` | azure-delete-blob | CORS allowlist origin | Yes | High |
| L03 | runtime | repo | supabase/functions/azure-delete-blob/index.ts | 7 | `https://ee335e84-7b72-46fe-bdb4-cd3d716c9247.lovableproject.com` | azure-delete-blob | CORS allowlist origin | Yes | High |
| L04 | runtime | repo | supabase/functions/azure-document-upload-url/index.ts | 5 | `https://learn-wings.lovable.app` | azure-document-upload-url | CORS allowlist origin | Yes | High |
| L05 | runtime | repo | supabase/functions/azure-document-upload-url/index.ts | 6 | `https://id-preview--ee335e84-7b72-46fe-bdb4-cd3d716c9247.lovable.app` | azure-document-upload-url | CORS allowlist origin | Yes | High |
| L06 | runtime | repo | supabase/functions/azure-document-upload-url/index.ts | 7 | `https://ee335e84-7b72-46fe-bdb4-cd3d716c9247.lovableproject.com` | azure-document-upload-url | CORS allowlist origin | Yes | High |
| L07 | runtime | repo | supabase/functions/azure-upload-url/index.ts | 5 | `https://learn-wings.lovable.app` | azure-upload-url | CORS allowlist origin | Yes | High |
| L08 | runtime | repo | supabase/functions/azure-upload-url/index.ts | 6 | `https://id-preview--ee335e84-7b72-46fe-bdb4-cd3d716c9247.lovable.app` | azure-upload-url | CORS allowlist origin | Yes | High |
| L09 | runtime | repo | supabase/functions/azure-upload-url/index.ts | 7 | `https://ee335e84-7b72-46fe-bdb4-cd3d716c9247.lovableproject.com` | azure-upload-url | CORS allowlist origin | Yes | High |
| L10 | runtime | repo | supabase/functions/azure-view-url/index.ts | 5 | `https://learn-wings.lovable.app` | azure-view-url | CORS allowlist origin | Yes | High |
| L11 | runtime | repo | supabase/functions/azure-view-url/index.ts | 6 | `https://id-preview--ee335e84-7b72-46fe-bdb4-cd3d716c9247.lovable.app` | azure-view-url | CORS allowlist origin | Yes | High |
| L12 | runtime | repo | supabase/functions/azure-view-url/index.ts | 7 | `https://ee335e84-7b72-46fe-bdb4-cd3d716c9247.lovableproject.com` | azure-view-url | CORS allowlist origin | Yes | High |
| L13 | runtime | repo | supabase/functions/delete-user/index.ts | 5 | `https://learn-wings.lovable.app` | delete-user | CORS allowlist origin | Yes | High |
| L14 | runtime | repo | supabase/functions/delete-user/index.ts | 6 | `https://id-preview--ee335e84-7b72-46fe-bdb4-cd3d716c9247.lovable.app` | delete-user | CORS allowlist origin | Yes | High |
| L15 | runtime | repo | supabase/functions/delete-user/index.ts | 7 | `https://ee335e84-7b72-46fe-bdb4-cd3d716c9247.lovableproject.com` | delete-user | CORS allowlist origin | Yes | High |
| L16 | runtime | repo | supabase/functions/generate-certificate/index.ts | 5 | `https://learn-wings.lovable.app` | generate-certificate | CORS allowlist origin | Yes | High |
| L17 | runtime | repo | supabase/functions/generate-certificate/index.ts | 6 | `https://id-preview--ee335e84-7b72-46fe-bdb4-cd3d716c9247.lovable.app` | generate-certificate | CORS allowlist origin | Yes | High |
| L18 | runtime | repo | supabase/functions/send-invitation-email/index.ts | 9 | `https://learn-wings.lovable.app` | send-invitation-email | CORS allowlist origin | Yes | High |
| L19 | runtime | repo | supabase/functions/send-invitation-email/index.ts | 10 | `https://id-preview--ee335e84-7b72-46fe-bdb4-cd3d716c9247.lovable.app` | send-invitation-email | CORS allowlist origin | Yes | High |
| L20 | runtime | repo | supabase/functions/send-invitation-email/index.ts | 11 | `https://ee335e84-7b72-46fe-bdb4-cd3d716c9247.lovableproject.com` | send-invitation-email | CORS allowlist origin | Yes | High |
| L21 | dead-code | repo | supabase/functions/send-invitation-email/index.ts | 114 | `learn-wings.lovable.app` | send-invitation-email | Invite link allowlist domain — DEAD: frontend now uses `ai-uddannelse.dk` | Yes (cleanup) | High |
| L22 | dead-code | repo | supabase/functions/send-invitation-email/index.ts | 115 | `id-preview--ee335e84-7b72-46fe-bdb4-cd3d716c9247.lovable.app` | send-invitation-email | Invite link allowlist domain — DEAD | Yes (cleanup) | High |
| L23 | config | repo | .lovable/plan.md | all | Lovable project plan | all | Lovable project config file | No (delete dir) | High |
| L24 | package | repo | package.json | devDeps | `lovable-tagger: ^1.1.13` | build | Dev dependency, no runtime impact | Yes (cleanup) | High |
| L25 | runtime | repo | vite.config.ts | 4 | `componentTagger` from `lovable-tagger` | build | Build plugin — dev mode only | Yes (remove) | High |
| L26 | doc | repo | README.md | 5,13,67,96 | `lovable.dev` | doc | Documentation links | No (cleanup) | High |

**Lovable CORS summary:** 7 functions have Lovable CORS origins. `grade-quiz`, `generate-compliance-report`, `test-smtp-connection` use `*` wildcard.

---

## SUPABASE REFERENCES — Frontend / Package

| ID | Category | Source | File/Resource | Line | Identifier | Related Function | Interpretation | Blocker | Confidence |
|----|---------|--------|--------------|------|-----------|----------------|----------------|---------|-----------|
| S01 | package | repo | package.json | deps | `@supabase/supabase-js: ^2.93.1` | all | Runtime SDK dependency | Yes | High |
| S02 | runtime | repo | src/integrations/supabase/client.ts | 2 | `import createClient from @supabase/supabase-js` | all | SDK import | Yes | High |
| S03 | runtime | repo | src/integrations/supabase/client.ts | 5 | `VITE_SUPABASE_URL` | all | Supabase project URL env var read | Yes | High |
| S04 | runtime | repo | src/integrations/supabase/client.ts | 6 | `VITE_SUPABASE_PUBLISHABLE_KEY` | all | Supabase anon key env var read | Yes | High |
| S05 | runtime | repo | src/integrations/supabase/client.ts | 11 | `createClient<Database>` | all | Supabase client singleton exported for app-wide use | Yes | High |
| S06 | db-rpc | repo | src/integrations/supabase/types.ts | all | `Database` type, all table types | all | Auto-generated Supabase type file, 2000+ lines | Yes | High |
| S07 | config | repo | .env | 1 | `VITE_SUPABASE_PROJECT_ID=cairuxpyfshugwjrrqha` | all | Supabase project ID | Yes | High |
| S08 | config | repo | .env | 2 | `VITE_SUPABASE_PUBLISHABLE_KEY=[REDACTED]` | all | Supabase anon JWT key | Yes | High |
| S09 | config | repo | .env | 3 | `VITE_SUPABASE_URL=https://cairuxpyfshugwjrrqha.supabase.co` | all | Supabase project URL | Yes | High |

---

## SUPABASE REFERENCES — Frontend Call Sites

| ID | Category | Source | File/Resource | Line | Identifier | Related Function | Interpretation | Blocker | Confidence |
|----|---------|--------|--------------|------|-----------|----------------|----------------|---------|-----------|
| C01 | runtime | repo | src/pages/learner/CoursePlayer.tsx | 208 | `supabase.functions.invoke('azure-view-url', ...)` | azure-view-url | Video blob URL request | Yes | High |
| C02 | runtime | repo | src/pages/learner/CoursePlayer.tsx | 233 | `supabase.functions.invoke('azure-view-url', ...)` | azure-view-url | Document blob URL request | Yes | High |
| C03 | runtime | repo | src/pages/learner/CoursePlayer.tsx | 335 | `supabase.functions.invoke('grade-quiz', ...)` | grade-quiz | Server-side quiz grading | Yes | High |
| C04 | runtime | repo | src/pages/learner/Dashboard.tsx | 147 | `supabase.functions.invoke('generate-certificate', ...)` | generate-certificate | PDF certificate generation | Yes | High |
| C05 | runtime | repo | src/components/platform-admin/UserDetailDialog.tsx | 186 | `fetch(${VITE_SUPABASE_URL}/functions/v1/delete-user, ...)` | delete-user | Raw fetch to Supabase URL | Yes | High |
| C06 | runtime | repo | src/lib/sendInvitationEmail.ts | 24 | `supabase.functions.invoke('send-invitation-email', ...)` | send-invitation-email | Invitation email dispatch | Yes | High |
| C07 | runtime | repo | src/components/ui/azure-video-upload.tsx | 38 | `supabase.functions.invoke('azure-view-url', ...)` | azure-view-url | Preview URL for existing video | Yes | High |
| C08 | runtime | repo | src/components/ui/azure-video-upload.tsx | 75 | `supabase.functions.invoke('azure-upload-url', ...)` | azure-upload-url | Signed upload URL request | Yes | High |
| C09 | runtime | repo | src/pages/platform-admin/CourseEditor.tsx | 262 | `supabase.functions.invoke('azure-delete-blob', ...)` | azure-delete-blob | Blob deletion | Yes | High |
| C10 | runtime | repo | src/pages/org-admin/OrgAnalytics.tsx | 275 | `fetch(${VITE_SUPABASE_URL}/functions/v1/generate-compliance-report, ...)` | generate-compliance-report | Raw fetch to Supabase URL for PDF | Yes | High |
| C11 | runtime | repo | src/components/ui/azure-document-upload.tsx | 65 | `supabase.functions.invoke('azure-document-upload-url', ...)` | azure-document-upload-url | Signed document upload URL | Yes | High |
| C12 | runtime | repo | src/pages/platform-admin/PlatformSettings.tsx | 151 | `supabase.functions.invoke('test-smtp-connection', ...)` | test-smtp-connection | SMTP connection test | Yes | High |

**Note:** C05 and C10 use raw `fetch()` against `VITE_SUPABASE_URL/functions/v1/...` instead of `supabase.functions.invoke`. Both confirmed by line number search.

---

## SUPABASE REFERENCES — Edge Function Env Vars

| ID | Category | Source | File/Resource | Line | Identifier | Related Function | Interpretation | Blocker | Confidence |
|----|---------|--------|--------------|------|-----------|----------------|----------------|---------|-----------|
| E01 | runtime | repo | supabase/functions/grade-quiz/index.ts | 32,86 | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | grade-quiz | Supabase Deno runtime secrets | Yes | High |
| E02 | runtime | repo | supabase/functions/generate-certificate/index.ts | 312,313 | `SUPABASE_URL`, `SUPABASE_ANON_KEY` | generate-certificate | Supabase Deno runtime secrets | Yes | High |
| E03 | runtime | repo | supabase/functions/delete-user/index.ts | 30,31 | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | delete-user | Supabase Deno runtime secrets | Yes | High |
| E04 | runtime | repo | supabase/functions/send-invitation-email/index.ts | 51,52 | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `RESEND_API_KEY` | send-invitation-email | Supabase Deno runtime secrets + Resend | Yes | High |
| E05 | runtime | repo | supabase/functions/azure-upload-url/index.ts | 120,121,157,174 | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `AZURE_STORAGE_ACCOUNT_NAME`, `AZURE_STORAGE_ACCOUNT_KEY` | azure-upload-url | All secrets | Yes | High |
| E06 | runtime | repo | supabase/functions/azure-view-url/index.ts | 122,123,186,187 | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `AZURE_STORAGE_ACCOUNT_NAME`, `AZURE_STORAGE_ACCOUNT_KEY` | azure-view-url | All secrets | Yes | High |
| E07 | runtime | repo | supabase/functions/azure-delete-blob/index.ts | 109,110,157,158 | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `AZURE_STORAGE_ACCOUNT_NAME`, `AZURE_STORAGE_ACCOUNT_KEY` | azure-delete-blob | All secrets | Yes | High |
| E08 | runtime | repo | supabase/functions/generate-compliance-report/index.ts | 192,193 | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | generate-compliance-report | Supabase Deno runtime secrets | Yes | High |
| E09 | runtime | repo | supabase/functions/azure-document-upload-url/index.ts | 108,109,150,151 | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `AZURE_STORAGE_ACCOUNT_NAME`, `AZURE_STORAGE_ACCOUNT_KEY` | azure-document-upload-url | All secrets | Yes | High |
| E10 | runtime | repo | supabase/functions/test-smtp-connection/index.ts | — | (no Supabase env vars used) | test-smtp-connection | No auth, CORS wildcard | Yes | High |
| E11 | runtime | repo | supabase/functions/seed-mock-users/index.ts | 37,38 | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | seed-mock-users | Admin seeding function | Yes | High |

---

## SUPABASE REFERENCES — Database / RPC

| ID | Category | Source | File/Resource | Line | Identifier | Related Function | Interpretation | Blocker | Confidence |
|----|---------|--------|--------------|------|-----------|----------------|----------------|---------|-----------|
| D01 | db-rpc | repo | supabase/migrations/ | all | 30+ migration files | schema | Supabase-format PostgreSQL migrations | Yes | High |
| D02 | db-rpc | repo | supabase/functions/grade-quiz/index.ts | 122-125 | `quiz_options.is_correct` (service role read) | grade-quiz | Correct answer data — must stay server-side | Yes | High |
| D03 | db-rpc | repo | supabase/functions/grade-quiz/index.ts | 68 | `user_can_access_quiz` RPC | grade-quiz | Supabase RPC call | Yes | High |
| D04 | db-rpc | repo | supabase/functions/azure-view-url/index.ts | 164 | `can_user_access_lms_asset` RPC | azure-view-url | Supabase RPC call for access check | Yes | High |
| D05 | db-rpc | repo | supabase/migrations/20260130173935_*.sql | 3 | `can_user_access_lms_asset` function definition | azure-view-url | SQL RPC definition | Yes | High |
| D06 | db-rpc | repo | src/integrations/supabase/types.ts | 1536 | `can_user_access_lms_asset` type | azure-view-url | Frontend type for RPC | Yes | High |
| D07 | db-rpc | repo | src/integrations/supabase/types.ts | 1406,1409 | `quiz_options.is_correct` type | grade-quiz | Frontend type — should not expose is_correct to client | Yes | High |
| D08 | db-rpc | repo | src/pages/learner/CoursePlayer.tsx | 177 | `get_quiz_options_for_learner` RPC | grade-quiz | Learner-safe quiz options (without is_correct) | Yes | High |
| D09 | db-rpc | repo | src/components/platform-admin/QuizEditorDialog.tsx | 100 | `get_quiz_options_with_answers` RPC | grade-quiz | Admin quiz options (with is_correct) | Yes | High |
| D10 | db-rpc | repo | supabase/config.toml | all | `project_id = "cairuxpyfshugwjrrqha"` | all | Supabase project reference | Yes | High |

---

## SUPABASE REFERENCES — Frontend Direct SDK Usage (Auth / DB / Storage / RPC)

These are **not** function invocation call sites — they are direct `@supabase/supabase-js` SDK calls made from the frontend. All must be replaced when the Supabase client is removed.

### Auth (supabase.auth.*)

| ID | Category | File | Usage | Interpretation | Blocker |
|----|---------|------|-------|----------------|---------|
| FA01 | runtime | src/hooks/useAuth.tsx | `supabase.auth.getSession`, `supabase.auth.onAuthStateChange`, `supabase.auth.signOut` | Central auth hook used by entire app | Yes |
| FA02 | runtime | src/pages/Login.tsx | `supabase.auth.signInWithPassword` | Email/password login | Yes |
| FA03 | runtime | src/pages/Signup.tsx | `supabase.auth.signUp` | New user registration | Yes |
| FA04 | runtime | src/pages/ForgotPassword.tsx | `supabase.auth.resetPasswordForEmail` | Password reset email | Yes |
| FA05 | runtime | src/pages/ResetPassword.tsx | `supabase.auth.updateUser` | Password update after reset | Yes |
| FA06 | runtime | src/pages/Settings.tsx | `supabase.auth.updateUser`, `supabase.auth.getUser` | Profile/password update | Yes |
| FA07 | runtime | src/lib/community-api.ts | `supabase.auth.getUser` | Auth token for community API requests | Yes |
| FA08 | runtime | src/lib/ideas-api.ts | `supabase.auth.getUser` | Auth token for ideas API requests | Yes |
| FA09 | runtime | src/pages/learner/CoursePlayer.tsx | `supabase.auth.getUser` | Current user lookup for quiz/progress | Yes |
| FA10 | runtime | src/pages/org-admin/OrgAnalytics.tsx | `supabase.auth.getUser` | Auth user for analytics requests | Yes |
| FA11 | runtime | src/pages/platform-admin/CourseEditor.tsx | `supabase.auth.getUser` | Auth user for editor operations | Yes |

### Direct Database Reads (supabase.from())

| ID | Category | File | Tables Queried | Interpretation | Blocker |
|----|---------|------|---------------|----------------|---------|
| FD01 | runtime | src/pages/learner/CoursePlayer.tsx | `lesson_progress`, `enrollments`, `quiz_attempts` | Learner progress tracking (read+write) | Yes |
| FD02 | runtime | src/pages/learner/Courses.tsx | courses, enrollments | Learner course list | Yes |
| FD03 | runtime | src/hooks/usePlatformSettings.tsx | platform_settings | Global platform config | Yes |
| FD04 | runtime | src/pages/org-admin/OrgAnalytics.tsx | org_memberships, enrollments, quiz_attempts | Org-level analytics data | Yes |
| FD05 | runtime | src/pages/org-admin/OrgSettings.tsx | organizations | Org details + update | Yes |
| FD06 | runtime | src/pages/org-admin/OrgUsers.tsx | org_memberships, profiles | Org member list | Yes |
| FD07 | runtime | src/pages/platform-admin/CoursesManager.tsx | courses | Course CRUD | Yes |
| FD08 | runtime | src/pages/platform-admin/CourseEditor.tsx | courses, lessons, modules, quiz_questions, quiz_options | Full course editing | Yes |
| FD09 | runtime | src/pages/platform-admin/OrganizationsManager.tsx | organizations | Org list + CRUD | Yes |
| FD10 | runtime | src/lib/ideas-api.ts | ideas (or equivalent) | Ideas/community feature | Yes |
| FD11 | runtime | src/components/org-admin/EnrollUserDialog.tsx | enrollments | Enroll user in course | Yes |
| FD12 | runtime | src/components/org-admin/OrgMembersTab.tsx | org_memberships, profiles | Org member management | Yes |

### Storage (supabase.storage.*)

| ID | Category | File | Usage | Interpretation | Blocker |
|----|---------|------|-------|----------------|---------|
| FS01 | runtime | src/components/ui/file-upload.tsx | `supabase.storage.from(...).upload(...)` | File upload (non-Azure) | Yes |
| FS02 | runtime | src/lib/storage.ts | `supabase.storage.*` | Storage abstraction layer | Yes |
| FS03 | runtime | src/pages/org-admin/OrgAnalytics.tsx | `supabase.storage.from(...).getPublicUrl(...)` | Fetching public asset URLs | Yes |
| FS04 | runtime | src/pages/platform-admin/OrganizationDetail.tsx | `supabase.storage.*` | Org logo/asset storage | Yes |
| FS05 | runtime | src/pages/platform-admin/OrganizationsManager.tsx | `supabase.storage.*` | Org asset management | Yes |

### RPC (supabase.rpc()) — Beyond Already-Catalogued

| ID | Category | File | RPC Called | Interpretation | Blocker |
|----|---------|------|-----------|----------------|---------|
| FR01 | db-rpc | src/components/platform-admin/QuizEditorDialog.tsx | `get_quiz_options_with_answers` | Admin quiz options with correct answers | Yes |
| FR02 | db-rpc | src/pages/platform-admin/OrganizationDetail.tsx | `get_invitation_link_id` | Generate org invite link | Yes |

**Total direct SDK usage beyond function.invoke:** 11 auth calls (11 files), 12 DB calls (12 files), 5 storage calls (5 files), 2 RPC calls (2 files) — **30 additional call sites across 19 files**.

---

## SUPABASE REFERENCES — Documentation

| ID | Category | File | Reference Count | Notes |
|----|---------|------|----------------|-------|
| DOC01 | doc | AZURE_DEPLOYMENT_GUIDE.md | ~25 lines | Supabase Edge Functions paths, VITE_SUPABASE_* secrets in GitHub Actions, migration commands |
| DOC02 | doc | QUICK_START.md | ~3 lines | `supabase/migrations/*.sql` paths, VITE_SUPABASE env vars |
| DOC03 | doc | DEPLOYMENT_SUMMARY.md | ~1 line | Supabase Edge Functions mentioned as current backend |

---

## SUPABASE REFERENCES — Deployment / CI-CD

| ID | Category | Source | File/Resource | Line | Identifier | Related Function | Interpretation | Blocker | Confidence |
|----|---------|--------|--------------|------|-----------|----------------|----------------|---------|-----------|
| CI01 | deployment | repo | .github/workflows/main_func-ai-education-migration.yml | all | Azure Functions deploy workflow | all | Deploys from repo root to func-ai-education-migration | No (keep, update) | High |
| CI02 | deployment | repo | .github/workflows/azure-static-web-apps-black-forest-0d7f96c03.yml | all | Static Web App deploy | all | Deploys frontend to stapp-ai-education-migration | No (keep, update) | High |
| CI03 | deployment | repo | .github/workflows/codeql.yml | all | CodeQL scanning | all | Security scanning, unrelated to Supabase | No | High |

---

## AZURE REFERENCES

| ID | Category | Source | Resource | Setting/Config | Identifier | Blocker | Confidence |
|----|---------|--------|---------|---------------|-----------|---------|-----------|
| A01 | azure-config | Azure | func-ai-education-migration | App settings | No SUPABASE_* settings found | No (gap — needs populating) | High |
| A02 | azure-config | Azure | func-ai-education-migration | Runtime | `FUNCTIONS_WORKER_RUNTIME=node`, `~22` | No | High |
| A03 | azure-config | Azure | stapp-ai-education-migration | CustomDomains | None — only `black-forest-0d7f96c03.7.azurestaticapps.net` | No | High |
| A04 | azure-config | Azure | staieducationmigration | Public access | `allowBlobPublicAccess: false` | No | High |
| A05 | azure-config | Azure | ai-education-migration (KV) | Secrets | Names inaccessible — private endpoint, unreachable from local | Possible gap | Medium |
| A06 | azure-config | Azure | psql-ai-education-migration | PostgreSQL | Flexible Server in Sweden Central, private VNet | No | High |

---

## TOTAL COUNTS
- Lovable CORS origins: 17 references across 7 functions
- Lovable invite domain: 2 dead references
- Lovable build: 2 references (package.json, vite.config.ts)
- Lovable doc: 4 references (README.md)
- Supabase SDK/env frontend: 9 references (client.ts, .env)
- Supabase function.invoke / raw fetch call sites: 12 references (10 function invocations, 2 raw fetch)
- Supabase direct auth calls: 11 auth call sites across 11 files (useAuth.tsx, Login.tsx, Signup.tsx, ForgotPassword.tsx, ResetPassword.tsx, Settings.tsx, community-api.ts, ideas-api.ts, CoursePlayer.tsx, OrgAnalytics.tsx, CourseEditor.tsx)
- Supabase direct DB reads: 12 supabase.from() call sites across 12 files
- Supabase direct storage calls: 5 supabase.storage.* call sites across 5 files
- Supabase direct RPC calls: 2 additional supabase.rpc() call sites (QuizEditorDialog.tsx, OrganizationDetail.tsx)
- Supabase edge function env vars: 11 sets across 11 functions
- Supabase DB/RPC: 10 references
- Supabase config files: supabase/config.toml + 30+ migration files
- Supabase doc references: ~29 across 3 doc files
- Supabase lockfile refs: 7 in bun.lock, 18 in package-lock.json
- Lovable lockfile refs: 2 in bun.lock, 27 in package-lock.json
- Azure gaps: Function App has no Supabase/Lovable but also no replacement secrets yet
