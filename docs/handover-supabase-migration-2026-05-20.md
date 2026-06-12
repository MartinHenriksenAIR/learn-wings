# Handover: Lovable/Supabase → Azure Migration

**Date:** 2026-05-20  
**Branch:** `feature/lovable-migration`  
**For:** Dawid  
**From:** Martin

---

## What This Migration Is

The learn-wings LMS is being migrated from its original Lovable/Supabase stack to:

- **Backend:** Azure Functions (Node.js 22, TypeScript v4 model)
- **Auth:** Microsoft Entra ID (multi-tenant, MSAL, RS256 JWT)
- **Database:** Azure PostgreSQL (same schema, RLS replaced by app-layer auth)
- **Storage:** Azure Blob Storage (SAS-based, replacing Supabase storage)

The full plan is at: `docs/superpowers/plans/2026-05-17-lovable-supabase-migration.md`

---

## What Has Been Completed

All Azure Functions are built and tested. The frontend has been largely migrated off Supabase. The auth system has been replaced.

### Azure Functions (all in `functions/` directory)

| Endpoint | Purpose |
|---|---|
| `user-context` | First-login profile provisioning, returns profile + memberships |
| `azure-upload-url` | SAS URL for video uploads to Azure Blob |
| `azure-document-upload-url` | SAS URL for document uploads |
| `azure-view-url` | Signed view URL for blob content |
| `azure-delete-blob` | Delete a blob (platform admin) |
| `grade-quiz` | Server-side quiz grading + inserts `quiz_attempts` |
| `course-player-data` | Single call: course + modules/lessons + progress + review |
| `lesson-progress` | Upsert lesson completion |
| `enrollment-complete` | Mark enrollment as completed |
| `quiz-options` | Quiz options **without** `is_correct` (learner-safe) |
| `quiz-options-admin` | Quiz options **with** `is_correct` (platform admin only) |
| `org-analytics-data` | Members + enrollments + quiz attempts for an org |
| `invitation-link` | Returns active invite link ID for an org |
| `admin-user-actions` | toggle-platform-admin, update-role, add/remove membership |
| `generate-certificate` | PDF certificate generation |
| `generate-compliance-report` | AI Act compliance PDF |
| `test-smtp-connection` | SMTP connectivity test (now auth-gated) |
| `delete-user` | Permanent user deletion (platform admin only) |
| `send-invitation-email` | Sends invite email via Resend |

### Frontend Changes

- **Auth:** `useAuth.tsx` replaced entirely — uses `useMsal()` + `useAccount()`. `signIn()` calls `instance.loginRedirect()`. No email/password.
- **Login/Signup/ForgotPassword/ResetPassword:** Replaced with simple Entra ID redirect pages.
- **Settings:** Password change section removed (Entra ID handles it).
- **`callApi` / `callApiRaw`:** `src/lib/api-client.ts` — acquires a silent MSAL token before every request to Azure Functions.
- **`msalInstance`:** Initialized in `main.tsx` before React renders. App is wrapped in `<MsalProvider>`.
- **All 12 `supabase.functions.invoke` call sites:** Replaced with `callApi`.
- **CoursePlayer.tsx:** 8 separate supabase DB reads → single `callApi('/api/course-player-data')`.
- **UserDetailDialog.tsx:** All DB writes → `callApi('/api/admin-user-actions')`.
- **OrgAnalytics.tsx:** Analytics reads → `callApi('/api/org-analytics-data')`.
- **`file-upload.tsx`:** Now uploads to Azure Blob via `callApi('/api/azure-upload-url')` + XHR.

### Shared function infrastructure (`functions/shared/`)

- **`auth.ts`:** Multi-tenant Entra ID JWT validation via JWKS (`RS256`). Returns `{ id: entra_oid, tid: entra_tid, email, name }`.
- **`db.ts`:** pg Pool client. `query()` returns rows, `queryOne()` returns first row or null.
- **`cors.ts`:** CORS helpers with `ai-uddannelse.dk` allowlist.

---

## What Remains Before Supabase Can Be Removed

The Supabase client (`@supabase/supabase-js`) is still imported in 13 files. Task 22 in the plan (removing the package) is blocked until all of these are resolved.

### Group A — Need new Azure Function endpoints

These files have supabase reads/writes that don't yet have a corresponding Azure Function. Each endpoint would need to be built following TDD (write test → watch it fail → implement → verify green).

| File | Calls remaining | What's needed |
|---|---|---|
| `src/pages/platform-admin/CourseEditor.tsx` | 8 | Endpoints for course/module/lesson CRUD (`update-course`, `create-module`, `update-module`, `delete-module`, `create-lesson`, `update-lesson`, `delete-lesson`, `delete-course`) |
| `src/pages/platform-admin/CoursesManager.tsx` | 8 | Course list + publish/unpublish/delete |
| `src/pages/platform-admin/OrganizationsManager.tsx` | 3 | Org list + create/update |
| `src/pages/platform-admin/OrganizationDetail.tsx` | 2 | Org member disable/reactivate writes |
| `src/pages/org-admin/OrgUsers.tsx` | 1 | Org member list |
| `src/components/org-admin/OrgMembersTab.tsx` | 1 | Member list (may overlap with `org-analytics-data`) |
| `src/components/org-admin/EnrollUserDialog.tsx` | 1 | Enrollment write |
| `src/pages/learner/Courses.tsx` | 1 | Enrolled courses list (already in `course-player-data`?) |
| `src/hooks/usePlatformSettings.tsx` | 2 | Platform + org settings reads |
| `src/pages/org-admin/OrgSettings.tsx` | 1 | Org settings write |

### Group B — Community / Ideas features

| File | Calls remaining | Note |
|---|---|---|
| `src/lib/ideas-api.ts` | 9 | Ideas board: comments, votes, `supabase.auth.getUser()` |
| `src/lib/community-api.ts` | 4 | Community posts: `supabase.auth.getUser()` (for user ID) |

The community/ideas files use `supabase.auth.getUser()` to get the current user's ID. In the new system, the user ID (Entra `oid`) comes from the MSAL account — these calls should be replaced with `msalInstance.getActiveAccount()?.localAccountId` or a `callApi` to a new endpoint.

### Group C — Legacy Supabase storage (content migration dependency)

| File | Calls remaining | Note |
|---|---|---|
| `src/lib/storage.ts` | 1 | `supabase.storage.createSignedUrl` for legacy content |

`storage.ts` generates signed URLs for content (thumbnails, legacy videos) that is **still physically stored in Supabase storage**. This file can only be removed after that content is migrated to Azure Blob Storage. The functions `getSignedAssetUrl` and `getSignedLmsAssetUrl` are still called from `CoursePlayer.tsx` (legacy video/doc fallback) and `Dashboard.tsx` (thumbnails).

---

## The Decision Point

Martin is unsure how to proceed. There are two main paths:

### Option A — Complete the migration fully before merging

Build the remaining Azure Function endpoints (Group A above), migrate every file, verify `grep -r "integrations/supabase" src/` returns nothing, then run Task 22 (remove package) and Task 23 (schema migration to Azure PostgreSQL).

**Pros:** Clean cut. No Supabase dependency in production code.  
**Cons:** A lot of endpoints to build (course/module/lesson CRUD alone is ~8 endpoints). Dawid would need to estimate effort before committing.

### Option B — Deploy with hybrid and clean up later

The app currently works in a hybrid state: Azure Functions handle auth and learner flows, while admin/editor flows still touch Supabase directly. This is the strangler fig pattern the plan was designed around.

**Pros:** Can deploy and validate the Entra ID auth + Azure Functions work in production sooner.  
**Cons:** Both Supabase and Azure PostgreSQL are needed simultaneously. Supabase subscription cost continues. The cleanup debt grows.

### Option C — Deprioritise community/ideas entirely

The community/ideas features (`ideas-api.ts`, `community-api.ts`, community moderation pages) are a self-contained feature that may not be core to the current business priority. These could be feature-flagged off or removed from the codebase, reducing Group B to zero work.

---

## Key Technical Patterns to Know

If Dawid continues building endpoints, the established patterns are:

**Every Azure Function follows this structure:**
```ts
const user = await authenticate(req);          // always await — returns { id: oid, tid, email, name }
const { param } = await req.json() as { param: string };
const profile = await queryOne<{ id: string }>( // look up profile UUID from Entra oid
  'SELECT id FROM profiles WHERE entra_oid = $1', [user.id]
);
// ... business logic with query() / queryOne()
return corsResponse(origin, 200, { result }) as HttpResponseInit;
```

**Tests use `vi.hoisted()` for mock variables:**
```ts
const { mockQuery, mockQueryOne } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockQueryOne: vi.fn(),
}));
vi.mock('../shared/db', () => ({ query: mockQuery, queryOne: mockQueryOne }));
beforeEach(() => vi.clearAllMocks());
```

**The plan's column name bug:** The plan consistently wrote `profiles WHERE id = $1` with the Entra OID. The correct pattern is always `WHERE entra_oid = $1`. This has been fixed in every implemented endpoint but will bite again if Dawid follows the plan verbatim for new endpoints.

---

## Environment Variables

Both sets exist already (set in Azure Function App + `.env` locally):

| Variable | Used by |
|---|---|
| `VITE_ENTRA_CLIENT_ID` | Frontend MSAL config |
| `VITE_API_BASE_URL` | `callApi` base URL |
| `VITE_STORAGE_BASE_URL` | Azure Blob base URL for public assets |
| `VITE_REDIRECT_URI` | MSAL redirect after login |
| `ENTRA_CLIENT_ID` | Functions JWT validation |
| `ENTRA_TENANT_ID` | Functions JWT validation |
| `DB_CONNECTION_STRING` | Functions PostgreSQL |
| `AZURE_STORAGE_*` | Functions Blob SAS generation |
| `RESEND_API_KEY` | `send-invitation-email` |
| `STATIC_ASSETS_BASE_URL` | Logo URL in invitation emails |

---

## Where to Find Things

- **Migration plan:** `docs/superpowers/plans/2026-05-17-lovable-supabase-migration.md`
- **Azure deployment details:** `azure-deployment-handoff.md` (resource names, credentials, outstanding infra work)
- **Azure Functions source:** `functions/` (each endpoint in its own directory)
- **Shared auth/db/cors:** `functions/shared/`
- **Frontend API client:** `src/lib/api-client.ts`
- **MSAL config:** `src/lib/msal-config.ts`
- **Auth hook:** `src/hooks/useAuth.tsx`
