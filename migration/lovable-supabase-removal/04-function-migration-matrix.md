# 04 — Function Migration Matrix

Verified contracts for all 10 Supabase edge functions. Decision codes: A=merge existing | B=implement in current stack | C=Azure-native | D=dead remove | E=ambiguous.

---

## 1. grade-quiz

| Field | Value |
|-------|-------|
| **Status** | Live |
| **Implementation** | `supabase/functions/grade-quiz/index.ts` |
| **HTTP Method** | POST |
| **Auth** | Bearer JWT (Supabase anon key, verifies via `supabase.auth.getUser()`) |
| **Role Check** | Any authenticated user + RPC `user_can_access_quiz(p_quiz_id)` |
| **Request Body** | `{ quiz_id: string, answers: Record<string, string> }` (question_id → option_id) |
| **Response** | `{ score: number, passed: boolean, passing_score: number, correct_count: number, total_questions: number }` |
| **CORS** | `*` wildcard (NOT Lovable-restricted) |
| **Database** | Tables: `quizzes`, `quiz_questions`, `quiz_options` (via service role for is_correct); RPC: `user_can_access_quiz`; **INSERT** into `quiz_attempts` (server-side — see below) |
| **Env Vars** | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` |
| **Security Critical** | `quiz_options.is_correct` read via service role ONLY. Never returned to client. |
| **Frontend Caller** | `src/pages/learner/CoursePlayer.tsx:335` — `supabase.functions.invoke('grade-quiz', { body: { quiz_id, answers } })` |
| **Existing Replacement** | None found |
| **Decision** | **B** — Implement in `func-ai-education-migration` |
| **Proposed Route** | `POST /api/grade-quiz` |
| **Auth in Replacement** | Validate JWT from new auth provider; check quiz access via DB query |
| **DB in Replacement** | Azure PostgreSQL — query `quiz_options` with privileged DB user (no RLS bypass needed if app-layer auth is enforced) |
| **quiz_attempts ownership** | **⚠️ CRITICAL CHANGE:** Currently `CoursePlayer.tsx:357` inserts `quiz_attempts` from the browser. Supabase RLS prevents score manipulation. Azure PostgreSQL has no RLS. The replacement grade-quiz function MUST insert into `quiz_attempts` server-side (after grading) — return `{ score, passed, passing_score, correct_count, total_questions }` as before but include `attemptId`. Remove `quiz_attempts.insert` from CoursePlayer.tsx:357 entirely. |
| **Code Changes** | Update CoursePlayer.tsx:335 to call Azure Function URL; **remove** CoursePlayer.tsx:357 (quiz_attempts insert) |
| **Azure Changes** | Deploy function; add DB connection string |
| **Test Required** | Unit: score calculation; integration: DB query; security: is_correct never in response; quiz_attempts insert happens server-side and cannot be spoofed from browser |
| **Rollback** | Keep Supabase function until Azure Function verified |
| **Confidence** | High |

---

## 2. generate-certificate

| Field | Value |
|-------|-------|
| **Status** | Live |
| **Implementation** | `supabase/functions/generate-certificate/index.ts` |
| **HTTP Method** | POST |
| **Auth** | Bearer JWT (Supabase anon key) |
| **Role Check** | Must be owner of enrollment (`enrollments.user_id = user.id`) AND `status = 'completed'` |
| **Request Body** | `{ enrollmentId: string }` |
| **Response** | Binary `application/pdf` — `Content-Disposition: attachment; filename="certificate-{courseName}.pdf"` |
| **CORS** | Restricted to 2 Lovable domains only (L16, L17) — blocks current production domain |
| **Database** | Tables: `enrollments`, `courses`, `organizations`, `profiles` (all via anon key + RLS) |
| **Env Vars** | `SUPABASE_URL`, `SUPABASE_ANON_KEY` |
| **PDF Generation** | Pure TypeScript PDF (no PDFKit/puppeteer) — generates A4 landscape certificate |
| **Frontend Caller** | `src/pages/learner/Dashboard.tsx:147` — `supabase.functions.invoke('generate-certificate', { body: { enrollmentId } })` |
| **Existing Replacement** | None found |
| **Decision** | **B** — Implement in `func-ai-education-migration` |
| **Proposed Route** | `POST /api/generate-certificate` |
| **Auth in Replacement** | Validate JWT; verify enrollment ownership via DB query |
| **Binary Response** | Preserve `application/pdf` + `Content-Disposition: attachment; filename="certificate-{courseName}.pdf"` exactly |
| **Code Changes** | Port PDF generation TypeScript code to Node.js; update Dashboard.tsx:147 |
| **Azure Changes** | Deploy function; CORS update |
| **Test Required** | Integration: PDF binary response, content-type header, enrollment ownership check |
| **Rollback** | Keep Supabase function |
| **Confidence** | High |

---

## 3. delete-user

| Field | Value |
|-------|-------|
| **Status** | Live |
| **Implementation** | `supabase/functions/delete-user/index.ts` |
| **HTTP Method** | POST |
| **Auth** | Bearer JWT (service role key) |
| **Role Check** | Requesting user must have `profiles.is_platform_admin = true` |
| **Request Body** | `{ userId: string }` |
| **Response** | `{ success: true }` or `{ error: string }` |
| **CORS** | 3 Lovable domains (L13-L15) |
| **Database** | Calls `supabaseAdmin.auth.admin.deleteUser(userId)` — cascades to profile via Supabase trigger |
| **Self-deletion guard** | `userId === requestingUser.id` → 400 error |
| **Frontend Caller** | `src/components/platform-admin/UserDetailDialog.tsx:186` — raw `fetch(\`${VITE_SUPABASE_URL}/functions/v1/delete-user\`, ...)` |
| **Existing Replacement** | None found |
| **Decision** | **B** — Implement in `func-ai-education-migration` |
| **Proposed Route** | `POST /api/delete-user` |
| **Auth in Replacement** | Validate JWT; check `is_platform_admin` in DB |
| **User Deletion** | Use new auth provider's admin API to delete user + DB cascade; OR delete from DB + mark auth user inactive |
| **Blocker** | Depends on auth provider choice (see open questions) |
| **Code Changes** | Update UserDetailDialog.tsx:186 from raw fetch to Azure Function URL |
| **Azure Changes** | Deploy function; CORS update |
| **Test Required** | Auth: non-admin gets 403; self-delete gets 400; successful delete confirmed in DB |
| **Rollback** | Keep Supabase function |
| **Confidence** | Medium (auth provider dependency) |

---

## 4. send-invitation-email

| Field | Value |
|-------|-------|
| **Status** | Live |
| **Implementation** | `supabase/functions/send-invitation-email/index.ts` |
| **HTTP Method** | POST |
| **Auth** | Bearer JWT (Supabase anon key) |
| **Role Check** | `is_platform_admin` OR `org_memberships.role = 'org_admin'` |
| **Request Body** | `{ email, orgName, role, inviteLink }` |
| **Response** | `{ success: true, data: ResendResponse }` or `{ success: false, error: string }` |
| **CORS** | 3 Lovable domains + (no ai-uddannelse.dk in CORS) |
| **Invite Domain Allowlist** | `learn-wings.lovable.app`, `id-preview--*.lovable.app`, `ai-uddannelse.dk` |
| **Dead References** | Lovable domains in invite allowlist are dead — frontend `getInviteLink()` always generates `ai-uddannelse.dk` links |
| **External Service** | Resend API via `RESEND_API_KEY` — sends from `no-reply@ai-uddannelse.dk` |
| **Email Logo** | Hardcoded Supabase storage URL in HTML: `cairuxpyfshugwjrrqha.supabase.co/storage/v1/object/public/email-assets/logo-light.png` |
| **Frontend Caller** | `src/lib/sendInvitationEmail.ts:24` — `supabase.functions.invoke('send-invitation-email', ...)` |
| **Existing Replacement** | None |
| **Decision** | **B** — Implement in `func-ai-education-migration` |
| **Proposed Route** | `POST /api/send-invitation-email` |
| **Invite Domain Cleanup** | Remove Lovable domains; keep only `ai-uddannelse.dk` |
| **Email Logo** | Move logo to Azure Blob Storage or Static Web App public assets; update HTML |
| **Code Changes** | Update sendInvitationEmail.ts:24; update invite allowlist; update logo URL |
| **Azure Changes** | Deploy function; add `RESEND_API_KEY` to Key Vault; update CORS |
| **Test Required** | Auth: non-admin gets 403; email sends via Resend; Lovable domain rejected |
| **Rollback** | Keep Supabase function |
| **Confidence** | High |

---

## 5. azure-upload-url

| Field | Value |
|-------|-------|
| **Status** | Live |
| **Implementation** | `supabase/functions/azure-upload-url/index.ts` |
| **HTTP Method** | POST |
| **Auth** | Bearer JWT (service role key for auth verify) |
| **Role Check** | `profiles.is_platform_admin = true` |
| **Request Body** | `{ fileName: string, contentType?: string }` |
| **Response** | `{ uploadUrl: string, blobPath: string, contentType: string }` |
| **SAS Details** | Permissions: `cw` (create+write), 30-min expiry, 5-min clock skew, HMAC-SHA256, sv=2022-11-02 |
| **Container** | `AZURE_STORAGE_CONTAINER_NAME` or default `lms-videos` |
| **CORS** | 3 Lovable domains + `ai-uddannelse.dk` |
| **Env Vars** | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `AZURE_STORAGE_ACCOUNT_NAME`, `AZURE_STORAGE_ACCOUNT_KEY` |
| **Frontend Caller** | `src/components/ui/azure-video-upload.tsx:75` |
| **Existing Replacement** | None in Azure |
| **Decision** | **C** — Azure Function (natural owner: Azure Blob SAS) |
| **Proposed Route** | `POST /api/azure-upload-url` |
| **Auth in Replacement** | Validate JWT; check is_platform_admin via DB |
| **Secret Handling** | Use Key Vault reference for AZURE_STORAGE_ACCOUNT_KEY or use Managed Identity |
| **Code Changes** | Port SAS generation (Web Crypto API) to Node.js; update azure-video-upload.tsx:75 |
| **Azure Changes** | Add storage account name to app settings; add KV reference for key; deploy function |
| **Test Required** | SAS URL is valid for upload; expires correctly; non-admin gets 403 |
| **Rollback** | Keep Supabase function |
| **Confidence** | High |

---

## 6. azure-view-url

| Field | Value |
|-------|-------|
| **Status** | Live |
| **Implementation** | `supabase/functions/azure-view-url/index.ts` |
| **HTTP Method** | POST |
| **Auth** | Bearer JWT (service role key) |
| **Role Check** | Platform admin (bypass access check) OR `can_user_access_lms_asset(p_user_id, file_path)` RPC returns true |
| **Request Body** | `{ blobPath: string, lessonId?: string }` |
| **Response** | `{ viewUrl: string }` |
| **SAS Details** | Permissions: `r` (read), 120-min expiry, 5-min clock skew, HMAC-SHA256 |
| **CORS** | 3 Lovable domains + `ai-uddannelse.dk` |
| **Frontend Callers** | CoursePlayer.tsx:208 (video), CoursePlayer.tsx:233 (document), azure-video-upload.tsx:38 (preview) |
| **Security Critical** | Authorization MUST happen before SAS issued. RPC must be replicated in replacement. |
| **Decision** | **C** — Azure Function (natural owner: Azure Blob SAS + authorization) |
| **Proposed Route** | `POST /api/azure-view-url` |
| **Auth in Replacement** | Validate JWT; platform admin check OR `can_user_access_lms_asset` equivalent DB query |
| **RPC Migration** | Port `can_user_access_lms_asset` to Azure PostgreSQL stored procedure or inline app logic |
| **Code Changes** | Port SAS generation; update 3 call sites in CoursePlayer.tsx + azure-video-upload.tsx |
| **Test Required** | Non-enrolled user gets 403; enrolled user gets valid SAS; platform admin bypasses check |
| **Rollback** | Keep Supabase function |
| **Confidence** | High |

---

## 7. azure-delete-blob

| Field | Value |
|-------|-------|
| **Status** | Live |
| **Implementation** | `supabase/functions/azure-delete-blob/index.ts` |
| **HTTP Method** | POST |
| **Auth** | Bearer JWT (service role) |
| **Role Check** | `profiles.is_platform_admin = true` |
| **Request Body** | `{ blobPath: string }` |
| **Response** | `{ success: true, message: string }` — 404 treated as success |
| **SAS Details** | Permissions: `d` (delete), 10-min expiry |
| **CORS** | 3 Lovable domains + `ai-uddannelse.dk` |
| **Side Effect** | Executes HTTP DELETE against Azure Blob URL using SAS |
| **Frontend Caller** | `src/pages/platform-admin/CourseEditor.tsx:262` |
| **Decision** | **C** — Azure Function (natural owner: Azure Blob delete) |
| **Proposed Route** | `POST /api/azure-delete-blob` |
| **404 Semantics** | Preserve: 404 from Azure Blob = success response |
| **Code Changes** | Port SAS generation + fetch delete; update CourseEditor.tsx:262 |
| **Test Required** | Non-admin gets 403; delete succeeds; 404 returns success |
| **Rollback** | Keep Supabase function |
| **Confidence** | High |

---

## 8. generate-compliance-report

| Field | Value |
|-------|-------|
| **Status** | Live |
| **Implementation** | `supabase/functions/generate-compliance-report/index.ts` |
| **HTTP Method** | POST |
| **Auth** | Bearer JWT (service role) |
| **Role Check** | `is_platform_admin` OR `org_memberships.role = 'org_admin'` for the org |
| **Request Body** | `{ orgId: string }` |
| **Response** | Binary `application/pdf` — `Content-Disposition: attachment; filename="ai-act-compliance-report-{timestamp}.pdf"` |
| **CORS** | `*` wildcard |
| **Database** | `org_memberships`, `profiles`, `organizations`, `enrollments`, `quiz_attempts`, `org_course_access`, `courses` |
| **PDF Generation** | Custom TypeScript PDF generation (not PDFKit) |
| **Frontend Caller** | `src/pages/org-admin/OrgAnalytics.tsx:275` — raw `fetch(\`${VITE_SUPABASE_URL}/functions/v1/generate-compliance-report\`, ...)` |
| **Decision** | **B** — Implement in `func-ai-education-migration` |
| **Proposed Route** | `POST /api/generate-compliance-report` |
| **Auth in Replacement** | Validate JWT; check org admin membership via DB |
| **Binary Response** | Preserve PDF response, content-type, content-disposition filename pattern |
| **Code Changes** | Port PDF + DB aggregation to Node.js; update OrgAnalytics.tsx:275 from raw fetch |
| **Test Required** | Non-admin gets 403; PDF binary response; correct org data scoping |
| **Rollback** | Keep Supabase function |
| **Confidence** | High |

---

## 9. azure-document-upload-url

| Field | Value |
|-------|-------|
| **Status** | Live |
| **Implementation** | `supabase/functions/azure-document-upload-url/index.ts` |
| **HTTP Method** | POST |
| **Auth** | Bearer JWT (service role) |
| **Role Check** | `profiles.is_platform_admin = true` |
| **Request Body** | `{ fileName: string, contentType?: string }` |
| **Response** | `{ uploadUrl: string, blobPath: string, contentType: string }` |
| **SAS Details** | Permissions: `cw`, 30-min expiry — same as azure-upload-url |
| **Container** | Same `lms-videos` container, blobs under `documents/` prefix |
| **CORS** | 3 Lovable domains + `ai-uddannelse.dk` |
| **Difference from azure-upload-url** | BlobPath prefix `documents/`, default contentType `application/pdf` |
| **Frontend Caller** | `src/components/ui/azure-document-upload.tsx:65` |
| **Decision** | **C** — Azure Function (natural owner: Azure Blob SAS) |
| **Proposed Route** | `POST /api/azure-document-upload-url` |
| **Code Changes** | Can share SAS generation utility with azure-upload-url; update azure-document-upload.tsx:65 |
| **Test Required** | Same as azure-upload-url plus documents/ prefix verification |
| **Rollback** | Keep Supabase function |
| **Confidence** | High |

---

## 10. test-smtp-connection

| Field | Value |
|-------|-------|
| **Status** | Live |
| **Implementation** | `supabase/functions/test-smtp-connection/index.ts` |
| **HTTP Method** | POST |
| **Auth** | **NONE** — no JWT check, no role check (security gap in current implementation) |
| **Role Check** | None |
| **Request Body** | `{ host, port, username?, password?, encryption: 'none'|'ssl_tls'|'starttls', fromEmail? }` |
| **Response** | `{ success: true, message: string }` or `{ success: false, error: string }` |
| **CORS** | `*` wildcard |
| **Behaviour** | Opens TCP or TLS connection to SMTP host; closes immediately on success; 8-second timeout |
| **Deno APIs** | `Deno.connectTls`, `Deno.connect` |
| **Frontend Caller** | `src/pages/platform-admin/PlatformSettings.tsx:151` — `supabase.functions.invoke('test-smtp-connection', ...)` |
| **Security Note** | Current implementation has NO auth. Replacement MUST add platform_admin check. |
| **Decision** | **B** — Implement in `func-ai-education-migration` |
| **Proposed Route** | `POST /api/test-smtp-connection` |
| **Node.js Replacement** | Use `net.createConnection()` + `tls.connect()` instead of Deno APIs |
| **Auth Added** | Validate JWT; check `is_platform_admin` |
| **Timeout** | Preserve 8-second connection timeout |
| **Code Changes** | Port to Node.js `net`/`tls`; add auth check; update PlatformSettings.tsx:151 |
| **Test Required** | Platform admin can test; non-admin gets 403; timeout returns error |
| **Rollback** | Keep Supabase function |
| **Confidence** | High |

---

## Summary Table — Original 10 Functions

| Function | Decision | Target Route | Caller Update | DB Needed | Azure Secrets | Binary |
|----------|---------|-------------|--------------|-----------|--------------|--------|
| grade-quiz | B | POST /api/grade-quiz | CoursePlayer.tsx:335, **remove** line 357 | Yes | DB | No |
| generate-certificate | B | POST /api/generate-certificate | Dashboard.tsx:147 | Yes | DB | **PDF** |
| delete-user | B | POST /api/delete-user | UserDetailDialog.tsx:186 | Yes | DB + auth admin | No |
| send-invitation-email | B | POST /api/send-invitation-email | sendInvitationEmail.ts:24 | Yes | DB + RESEND_API_KEY | No |
| azure-upload-url | C | POST /api/azure-upload-url | azure-video-upload.tsx:75 | Yes | DB + storage | No |
| azure-view-url | C | POST /api/azure-view-url | CoursePlayer.tsx:208,233 + azure-video-upload.tsx:38 | Yes | DB + storage | No |
| azure-delete-blob | C | POST /api/azure-delete-blob | CourseEditor.tsx:262 | Yes | DB + storage | No |
| generate-compliance-report | B | POST /api/generate-compliance-report | OrgAnalytics.tsx:275 | Yes | DB | **PDF** |
| azure-document-upload-url | C | POST /api/azure-document-upload-url | azure-document-upload.tsx:65 | Yes | DB + storage | No |
| test-smtp-connection | B | POST /api/test-smtp-connection | PlatformSettings.tsx:151 | Yes | DB | No |

## Summary Table — Additional Endpoints Required (frontend DB/RPC calls)

These endpoints were not in the original 10. All frontend direct `supabase.from()` and `supabase.rpc()` calls need HTTP equivalents. Without these, removing `@supabase/supabase-js` breaks these call sites silently.

| Endpoint | Route | Caller | Purpose |
|----------|-------|--------|---------|
| course-player-data | GET /api/course-player-data | CoursePlayer.tsx:68-176 | Load course+modules+lessons+progress+review |
| lesson-progress | POST /api/lesson-progress | CoursePlayer.tsx:276 | Upsert lesson_progress |
| enrollment-complete | POST /api/enrollment-complete | CoursePlayer.tsx:310 | Mark enrollment completed |
| quiz-options | POST /api/quiz-options | CoursePlayer.tsx:177 | Learner quiz options (no is_correct) |
| quiz-options-admin | POST /api/quiz-options-admin | QuizEditorDialog.tsx:100 | Admin quiz options (with is_correct) |
| user-context | GET /api/user-context | useAuth.tsx:fetchUserContext | Profile + memberships on auth state change |
| org-analytics-data | POST /api/org-analytics-data | OrgAnalytics.tsx:70-200 | Analytics dashboard data |
| admin-user-actions | POST /api/admin/user-actions | UserDetailDialog.tsx:81,105,129,153 | Toggle admin, role, membership |
| invitation-link | POST /api/invitation-link | OrganizationDetail.tsx | get_invitation_link_id RPC |
