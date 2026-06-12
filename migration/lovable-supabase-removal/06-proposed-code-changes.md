# 06 — Proposed Code Changes

**DRAFT ONLY. Do not apply to repository until auth/DB migration decisions are confirmed.**

All changes listed below are proposals. No files in the application tree were modified.

---

## 1. package.json

**Remove:**
```json
"dependencies": {
  "@supabase/supabase-js": "^2.93.1"   // REMOVE
}
"devDependencies": {
  "lovable-tagger": "^1.1.13"           // REMOVE
}
```

**Add (example for PostgreSQL client):**
```json
"dependencies": {
  "pg": "^8.11.x"                       // Azure PostgreSQL client
}
```

See `patches/01-package-json.patch` for diff.

---

## 2. vite.config.ts

**Remove** `lovable-tagger` import and usage:

```ts
// BEFORE
import { componentTagger } from "lovable-tagger";
// ...
plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),

// AFTER
// No lovable-tagger import
plugins: [react()],
```

See `patches/02-vite-config.patch`.

---

## 3. src/integrations/supabase/ — REMOVE ENTIRE DIRECTORY

- Delete `src/integrations/supabase/client.ts`
- Delete `src/integrations/supabase/types.ts`

These files will be replaced by a new API client module and TypeScript types derived from the Azure PostgreSQL schema.

**New file: `src/lib/api-client.ts`** (proposed):
```ts
// Replaces supabase client for function calls
const API_BASE = import.meta.env.VITE_API_BASE_URL;

function getAuthHeader(): Record<string, string> {
  const token = /* get from new auth provider */;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function callApi<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

export async function callApiRaw(path: string, body: unknown): Promise<Response> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res;
}
```

---

## 4. .env

**Remove:**
```
VITE_SUPABASE_PROJECT_ID=...
VITE_SUPABASE_PUBLISHABLE_KEY=...
VITE_SUPABASE_URL=...
```

**Add:**
```
VITE_API_BASE_URL=https://func-ai-education-migration-c0fgeqdnfvd6h0cf.swedencentral-01.azurewebsites.net
```

Also update `.env.example` / `.env.template` if present.

---

## 5. src/lib/sendInvitationEmail.ts

**Remove** Supabase invoke. **Replace** with `callApi`:

```ts
// BEFORE (line 24):
const { data, error } = await supabase.functions.invoke('send-invitation-email', {
  body: { email, orgName, role, inviteLink },
});

// AFTER:
import { callApi } from '@/lib/api-client';
const data = await callApi('/api/send-invitation-email', { email, orgName, role, inviteLink });
```

---

## 6. src/pages/learner/CoursePlayer.tsx

**Line 208** (azure-view-url for video):
```ts
// BEFORE:
const { data } = await supabase.functions.invoke('azure-view-url', { body: { blobPath } });

// AFTER:
const data = await callApi<{ viewUrl: string }>('/api/azure-view-url', { blobPath });
```

**Line 233** (azure-view-url for document):
```ts
// Same pattern as line 208
```

**Line 335** (grade-quiz):
```ts
// BEFORE:
const { data, error } = await supabase.functions.invoke('grade-quiz', { body: { quiz_id, answers } });

// AFTER:
const data = await callApi<GradeQuizResponse>('/api/grade-quiz', { quiz_id, answers });
```

**Note:** Lines 177 (`get_quiz_options_for_learner` RPC) still uses Supabase client for DB query. Must be replaced with an API call or direct DB read via new auth-gated endpoint.

---

## 7. src/pages/learner/Dashboard.tsx

**Line 147** (generate-certificate — binary response):
```ts
// BEFORE:
const { data, error } = await supabase.functions.invoke('generate-certificate', {
  body: { enrollmentId },
});

// AFTER:
const response = await callApiRaw('/api/generate-certificate', { enrollmentId });
const blob = await response.blob();
// trigger download as before
```

---

## 8. src/components/platform-admin/UserDetailDialog.tsx

**Line 186** (delete-user — raw fetch to Supabase URL):
```ts
// BEFORE (raw fetch to Supabase):
const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/delete-user`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ userId }),
});

// AFTER:
const data = await callApi('/api/delete-user', { userId });
```

---

## 9. src/pages/org-admin/OrgAnalytics.tsx

**Line 275** (generate-compliance-report — raw fetch, binary):
```ts
// BEFORE (raw fetch to Supabase):
const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-compliance-report`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ orgId }),
});

// AFTER:
const response = await callApiRaw('/api/generate-compliance-report', { orgId });
const blob = await response.blob();
```

---

## 10. src/components/ui/azure-video-upload.tsx

**Line 38** (azure-view-url preview):
```ts
// BEFORE:
const { data } = await supabase.functions.invoke('azure-view-url', { body: { blobPath } });
// AFTER:
const data = await callApi<{ viewUrl: string }>('/api/azure-view-url', { blobPath });
```

**Line 75** (azure-upload-url):
```ts
// BEFORE:
const { data, error } = await supabase.functions.invoke('azure-upload-url', { body: { fileName, contentType } });
// AFTER:
const data = await callApi<{ uploadUrl: string, blobPath: string, contentType: string }>('/api/azure-upload-url', { fileName, contentType });
```

---

## 11. src/pages/platform-admin/CourseEditor.tsx

**Line 262** (azure-delete-blob):
```ts
// BEFORE:
const { error } = await supabase.functions.invoke('azure-delete-blob', { body: { blobPath } });
// AFTER:
await callApi('/api/azure-delete-blob', { blobPath });
```

---

## 12. src/components/ui/azure-document-upload.tsx

**Line 65** (azure-document-upload-url):
```ts
// BEFORE:
const { data, error } = await supabase.functions.invoke('azure-document-upload-url', { body: { fileName, contentType } });
// AFTER:
const data = await callApi<{ uploadUrl: string, blobPath: string, contentType: string }>('/api/azure-document-upload-url', { fileName, contentType });
```

---

## 13. src/pages/platform-admin/PlatformSettings.tsx

**Line 151** (test-smtp-connection):
```ts
// BEFORE:
const { data, error } = await supabase.functions.invoke('test-smtp-connection', { body: payload });
// AFTER:
const data = await callApi('/api/test-smtp-connection', payload);
```

---

## 14. New Azure Function Implementations

Create a new top-level directory for Azure Functions source (separate from the React app root to fix the CI/CD path issue).

**NOTE: `pg` goes in `functions/package.json`, NOT root `package.json`.** Root is the Vite frontend — pg is a Node.js TCP client, will not work in browser bundle.

```
functions/
├── host.json
├── package.json            ← pg, @azure/functions — NOT root package.json
├── tsconfig.json
├── shared/
│   ├── auth.ts             ← JWT validation (provider-specific)
│   ├── db.ts               ← pg Pool, DATABASE_URL from Key Vault
│   ├── sas.ts              ← Azure Blob SAS via Node.js crypto.createHmac
│   └── cors.ts             ← CORS headers, ai-uddannelse.dk only
├── grade-quiz/index.ts
├── generate-certificate/index.ts
├── delete-user/index.ts
├── send-invitation-email/index.ts
├── azure-upload-url/index.ts
├── azure-view-url/index.ts
├── azure-delete-blob/index.ts
├── generate-compliance-report/index.ts
├── azure-document-upload-url/index.ts
├── test-smtp-connection/index.ts
│
│ — Additional endpoints required for frontend DB/RPC calls (see §19–23 below):
├── quiz-options/index.ts           ← GET /api/quiz-options (replaces get_quiz_options_for_learner)
├── quiz-options-admin/index.ts     ← GET /api/quiz-options-admin (replaces get_quiz_options_with_answers)
├── course-player-data/index.ts     ← GET /api/course-player-data (courses+modules+lessons+progress)
├── lesson-progress/index.ts        ← POST /api/lesson-progress (upsert lesson_progress)
├── enrollment-complete/index.ts    ← POST /api/enrollment-complete (update enrollment status)
├── org-analytics-data/index.ts     ← GET /api/org-analytics-data (OrgAnalytics supabase.from reads)
├── admin-user-actions/index.ts     ← POST /api/admin/user-actions (profiles+memberships writes)
└── invitation-link/index.ts        ← GET /api/invitation-link (replaces get_invitation_link_id)
```

See `patches/03-azure-functions-src.patch` for proposed implementations.

---

## 19. CoursePlayer.tsx — DB Reads and Writes (missing from plan)

In addition to the 3 function.invoke replacements (lines 208, 233, 335), CoursePlayer.tsx makes 11 additional direct Supabase calls that need API replacements. These are covered by 3 new endpoints:

### New endpoint: GET /api/course-player-data

Replaces lines 68, 79, 88, 105, 130, 157, 166, 176 — the entire data-loading `fetchData()` function:

```ts
// CoursePlayer.tsx — replace fetchData() body:
const data = await callApi<CoursePlayerData>('/api/course-player-data', { courseId, orgId });
setCourse(data.course);
setModules(data.modules);
setProgress(data.progressMap);
setExistingReview(data.review ?? null);
```

The endpoint returns one JSON object with all data needed for course player initialization:
```ts
// Response shape:
{
  course: Course,
  modules: Array<Module & { lessons: Lesson[] }>,
  progressMap: Record<string, { status: 'completed' | 'not_started', completed_at: string | null }>,
  review: { id: string, rating: number, comment: string } | null,
}
```

### New endpoint: POST /api/lesson-progress

Replaces line 276 (`supabase.from('lesson_progress').upsert()`):
```ts
// CoursePlayer.tsx line 276 — BEFORE:
const { error } = await supabase.from('lesson_progress').upsert({ ... });
// AFTER:
await callApi('/api/lesson-progress', { orgId, userId, lessonId, status: 'completed' });
```

### New endpoint: POST /api/enrollment-complete

Replaces line 310 (`supabase.from('enrollments').update()`):
```ts
// CoursePlayer.tsx line 310 — BEFORE:
await supabase.from('enrollments').update({ status: 'completed', completed_at: ... }).eq(...);
// AFTER:
await callApi('/api/enrollment-complete', { orgId, courseId });
// Server resolves userId from JWT — client does not pass userId
```

### Existing grade-quiz endpoint must own quiz_attempts.insert (security fix)

Line 357 inserts `quiz_attempts` from the browser. With Azure PostgreSQL (no RLS), this lets a client write any score. The grade-quiz Azure Function must insert `quiz_attempts` server-side as part of grading and return the result. Remove line 357 from CoursePlayer.tsx entirely.

### quiz-options endpoint (replaces get_quiz_options_for_learner RPC, line 177)

```ts
// CoursePlayer.tsx line 176 — BEFORE:
const { data: options } = await supabase.rpc('get_quiz_options_for_learner', { p_question_id: q.id });
// AFTER:
const options = await callApi<QuizOption[]>('/api/quiz-options', { questionId: q.id });
// Returns options WITHOUT is_correct field (server strips it)
```

---

## 20. UserDetailDialog.tsx — Admin Privilege Writes (missing from plan)

Plan §8 covers line 186 (delete-user raw fetch). Four additional direct DB writes are in this component. **These are security-critical** — `is_platform_admin` grant must never be a direct DB write from a browser JWT without server-side admin verification.

### New endpoint: POST /api/admin/user-actions

Handles all 4 operations via a `type` field:

```ts
// UserDetailDialog.tsx line 81 — BEFORE:
const { error } = await supabase.from('profiles').update({ is_platform_admin: newValue }).eq('id', user.id);
// AFTER:
await callApi('/api/admin/user-actions', { type: 'toggle-platform-admin', targetUserId: user.id, value: newValue });

// Line 105 — BEFORE:
const { error } = await supabase.from('org_memberships').update({ role: newRole }).eq('id', membershipId);
// AFTER:
await callApi('/api/admin/user-actions', { type: 'update-member-role', membershipId, role: newRole });

// Line 129 — BEFORE:
const { error } = await supabase.from('org_memberships').delete().eq('id', membershipId);
// AFTER:
await callApi('/api/admin/user-actions', { type: 'remove-membership', membershipId });

// Line 153 — BEFORE:
const { error } = await supabase.from('org_memberships').insert({ org_id: newOrgId, user_id: user.id, ... });
// AFTER:
await callApi('/api/admin/user-actions', { type: 'add-membership', targetUserId: user.id, orgId: newOrgId, role });
```

The Azure Function verifies the requesting user has `is_platform_admin = true` before applying any of these changes.

---

## 21. OrgAnalytics.tsx — Analytics DB Reads (missing from plan)

Plan §9 covers line 275 (generate-compliance-report raw fetch). OrgAnalytics.tsx also makes ~10 direct `supabase.from()` reads for the analytics dashboard (lines 70-200) and `supabase.storage.getPublicUrl()` at line 315.

### New endpoint: GET /api/org-analytics-data

```ts
// OrgAnalytics.tsx — replace the entire analytics data fetch:
const analytics = await callApi<OrgAnalyticsData>('/api/org-analytics-data', { orgId });
```

Response covers all tables currently queried directly: `org_memberships`, `enrollments`, `quiz_attempts`, `profiles`, `organizations`. Auth check: requesting user must be `is_platform_admin` OR have `org_admin` membership for the requested orgId.

### Storage URL (line 315) — move to static assets

`supabase.storage.from(...).getPublicUrl(...)` at line 315 fetches a public logo URL. After migration, org logos must be stored in Azure Blob Storage with public read access OR served from the Static Web App's static path. Replace with a direct URL construction:
```ts
// BEFORE:
const { data: { publicUrl } } = supabase.storage.from('org-assets').getPublicUrl(`logos/${orgId}.png`);
// AFTER:
const publicUrl = `${import.meta.env.VITE_STORAGE_BASE_URL}/org-assets/logos/${orgId}.png`;
```
Where `VITE_STORAGE_BASE_URL` is the Azure Blob Storage public container base URL.

---

## 22. useAuth.tsx — DB Reads Inside Auth Hook (missing from plan)

`useAuth.tsx:43-81` (`fetchUserContext`) calls:
- `supabase.from('profiles').select('*').eq('id', userId)` 
- `supabase.from('org_memberships').select('*, organization:organizations(*)').eq('user_id', userId)`

These run on every auth state change. After migration, `fetchUserContext` must call API endpoints, not Supabase directly.

These reads can use the grade-quiz or another authenticated endpoint pattern — both tables need an endpoint. Option: single `GET /api/user-context` endpoint that returns `{ profile, memberships }` for the authenticated user (userId extracted from JWT server-side, never passed as URL param).

```ts
// useAuth.tsx fetchUserContext — AFTER:
const { profile, memberships } = await callApi<UserContext>('/api/user-context', {});
setProfile(profile);
setMemberships(memberships);
if (memberships.length > 0 && !currentOrg && !profile.is_platform_admin) {
  setCurrentOrg(memberships[0].organization!);
}
```

**Also:** `useAuth.tsx` imports and re-exports `User` and `Session` from `@supabase/supabase-js`. These types must be replaced with local type definitions or the new auth provider's SDK types. Every component that uses `user.id` or `session.access_token` depends on these types matching the new auth provider's shape.

Add to `functions/` as well: `POST /api/user-context` endpoint.

---

## 23. QuizEditorDialog.tsx and OrganizationDetail.tsx — Admin RPCs (missing from plan)

### QuizEditorDialog.tsx:100 — get_quiz_options_with_answers

```ts
// BEFORE:
const { data } = await supabase.rpc('get_quiz_options_with_answers', { p_quiz_id: quizId });
// AFTER:
const data = await callApi<QuizOptionWithAnswer[]>('/api/quiz-options-admin', { quizId });
// Server verifies is_platform_admin before returning is_correct field
```

### OrganizationDetail.tsx — get_invitation_link_id

```ts
// BEFORE:
const { data } = await supabase.rpc('get_invitation_link_id', { p_org_id: orgId });
// AFTER:
const data = await callApi<{ linkId: string }>('/api/invitation-link', { orgId });
```

---

## Patch Files Index (updated)

| Patch | Covers |
|-------|--------|
| `patches/01-package-json.patch` | Remove @supabase/supabase-js, lovable-tagger from root; create functions/package.json with pg |
| `patches/02-vite-config.patch` | Remove lovable-tagger from vite.config.ts |
| `patches/03-azure-functions-src.patch` | New functions/ directory with all 10+8 implementations (deferred pending auth decision) |
| `patches/04-frontend-callsites.patch` | All 12 original function.invoke call sites (see §5-13); §19-23 not yet patched |
| `patches/05-ci-cd-workflow.patch` | Fix Azure Functions workflow path |

---

## 15. supabase/ — REMOVE ENTIRE DIRECTORY (after migration complete)

```bash
# DO NOT RUN until migration is verified in production
rm -rf supabase/
```

Includes:
- `supabase/config.toml`
- `supabase/functions/` (all 11 function implementations)
- `supabase/migrations/` (all SQL migration files — archive before deletion)

---

## 16. .lovable/ — REMOVE

```bash
rm -rf .lovable/
```

---

## 17. README.md — UPDATE

Remove all `lovable.dev` links. Update setup instructions to reference Azure deployment.

---

## 18. .github/workflows/main_func-ai-education-migration.yml — UPDATE

Fix `AZURE_FUNCTIONAPP_PACKAGE_PATH` to point to the new `functions/` directory:
```yaml
env:
  AZURE_FUNCTIONAPP_PACKAGE_PATH: 'functions'  # was '.'
  NODE_VERSION: '22.x'
```

Also switch from `windows-latest` to `ubuntu-latest` (no reason to use Windows runner for Node.js).

---

## Patch Files Index

| Patch | Covers |
|-------|--------|
| `patches/01-package-json.patch` | Remove @supabase/supabase-js, lovable-tagger; add pg |
| `patches/02-vite-config.patch` | Remove lovable-tagger from vite.config.ts |
| `patches/03-azure-functions-src.patch` | New functions/ directory with all 10 implementations |
| `patches/04-frontend-callsites.patch` | All 12 frontend call site updates |
| `patches/05-ci-cd-workflow.patch` | Fix Azure Functions workflow path |
