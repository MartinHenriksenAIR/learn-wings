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

Create a new top-level directory for Azure Functions source (separate from the React app root to fix the CI/CD path issue):

```
functions/                           # New directory
├── host.json
├── package.json
├── tsconfig.json
├── shared/
│   ├── auth.ts
│   ├── db.ts
│   ├── sas.ts
│   └── cors.ts
├── grade-quiz/
│   ├── function.json
│   └── index.ts
├── generate-certificate/
│   ├── function.json
│   └── index.ts
[... one dir per function ...]
```

See `patches/03-azure-functions-src.patch` for proposed implementations.

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
