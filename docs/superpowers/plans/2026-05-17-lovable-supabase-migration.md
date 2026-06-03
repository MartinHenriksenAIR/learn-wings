# Lovable/Supabase Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove every Lovable and Supabase dependency from the learn-wings application, replacing with Azure Functions (Node.js 22) + Azure PostgreSQL Flexible Server.

**Architecture:** Frontend (Vite/React SPA on Azure Static Web Apps) calls Azure Functions at `func-ai-education-migration` via Bearer-JWT-authenticated POST endpoints. Functions share `functions/shared/` utilities for auth, DB (pg Pool), Azure Blob SAS generation (Node.js crypto), and CORS. Auth is **multi-tenant Microsoft Entra ID**: MSAL.js v3 on the frontend (`@azure/msal-browser` + `@azure/msal-react`), RS256 JWT validation with `jwks-rsa` on the backend. Users from any Entra tenant (including external orgs with their own Azure subscriptions) can sign in. All Supabase Edge Functions, the Supabase SDK, and Lovable build tooling are removed.

**Tech Stack:** Azure Functions v4 (`@azure/functions`), Node.js 22, TypeScript, `pg` (PostgreSQL), `node:crypto` (SAS), `node:net`/`node:tls` (SMTP test), `jwks-rsa` + `jsonwebtoken` (Entra ID JWT validation), `@azure/msal-browser` + `@azure/msal-react` (frontend SSO), Resend API (email), Vitest (tests)

**Auth:** Multi-tenant Microsoft Entra ID — Q1 resolved. Tasks 1–8.5 have no auth dependency. Task 8.5 configures the Azure App Registration (required before Task 9).

---

## File Structure

### New files
```
functions/
├── host.json
├── package.json                      ← pg, @azure/functions (NOT root package.json)
├── tsconfig.json
├── shared/
│   ├── auth.ts                       ← Entra ID RS256 multi-tenant JWT validation (jwks-rsa)
│   ├── db.ts                         ← pg Pool singleton
│   ├── sas.ts                        ← Azure Blob SAS (Node.js crypto.createHmac port)
│   └── cors.ts                       ← CORS headers, ai-uddannelse.dk allowlist
├── azure-upload-url/index.ts
├── azure-view-url/index.ts
├── azure-delete-blob/index.ts
├── azure-document-upload-url/index.ts
├── grade-quiz/index.ts
├── generate-certificate/index.ts
├── delete-user/index.ts
├── send-invitation-email/index.ts
├── generate-compliance-report/index.ts
├── test-smtp-connection/index.ts
├── course-player-data/index.ts       ← NEW: replaces 8 CoursePlayer supabase.from reads
├── lesson-progress/index.ts          ← NEW: replaces CoursePlayer.tsx:276
├── enrollment-complete/index.ts      ← NEW: replaces CoursePlayer.tsx:310
├── quiz-options/index.ts             ← NEW: replaces get_quiz_options_for_learner RPC
├── quiz-options-admin/index.ts       ← NEW: replaces get_quiz_options_with_answers RPC
├── user-context/index.ts             ← NEW: replaces useAuth fetchUserContext DB reads
├── org-analytics-data/index.ts       ← NEW: replaces OrgAnalytics.tsx:70–200 DB reads
├── admin-user-actions/index.ts       ← NEW: replaces UserDetailDialog.tsx:81,105,129,153
├── invitation-link/index.ts          ← NEW: replaces get_invitation_link_id RPC
├── platform-settings/index.ts        ← NEW (Task 21.2): platform_settings + org_settings reads/writes
├── learner-data/index.ts             ← NEW (Task 21.3): enrolled + available + dashboard
├── submit-review/index.ts            ← NEW (Task 21.3): course_reviews upsert
├── org-members/index.ts              ← NEW (Task 21.5): list + lookup + status + invitation
├── user-progress/index.ts            ← NEW (Task 21.6): admin view of a user's progress
├── enroll/index.ts                   ← NEW (Task 21.6): enrollment insert (self + admin)
├── admin-courses/index.ts            ← NEW (Task 21.7): courses list + CRUD + org access
├── admin-course-editor/index.ts      ← NEW (Task 21.8): course/module/lesson/quiz CRUD (txn)
├── admin-organizations/index.ts      ← NEW (Task 21.9): organizations CRUD + logo update
├── course-progress-analytics/index.ts ← NEW (Task 21.10): per-course progress + active users
├── community-moderation/index.ts     ← NEW (Task 21.11): flagged-post management
└── resources/index.ts                ← NEW (Task 21.13): resources library CRUD
src/lib/
├── api-client.ts                     ← NEW: replaces supabase.functions.invoke everywhere
└── msal-config.ts                    ← NEW: MSAL singleton, multi-tenant config, API scopes
```

### Modified files
```
package.json                          ← remove @supabase/supabase-js, lovable-tagger
vite.config.ts                        ← remove lovable-tagger import + plugin
src/main.tsx                          ← MSAL init (NOTE: use .then(), not top-level await)
src/hooks/useAuth.tsx                 ← replace supabase.auth.* + fetchUserContext DB reads
src/hooks/usePlatformSettings.tsx     ← Task 21.2
src/pages/Login.tsx
src/pages/Signup.tsx
src/pages/ForgotPassword.tsx
src/pages/ResetPassword.tsx
src/pages/Settings.tsx
src/pages/learner/CoursePlayer.tsx    ← 15 supabase calls → API calls (Tasks 20, 21.4)
src/pages/learner/Courses.tsx         ← Task 21.3
src/pages/learner/Dashboard.tsx       ← Tasks 19, 21.3
src/pages/org-admin/OrgAnalytics.tsx  ← Tasks 19, 21.10
src/pages/org-admin/OrgSettings.tsx   ← Task 21.2
src/pages/org-admin/OrgUsers.tsx      ← Task 21.5
src/pages/org-admin/OrgCommunityModeration.tsx ← Task 21.11
src/components/platform-admin/UserDetailDialog.tsx     ← Tasks 19, 21.1 (also covered Task 21 Step 1)
src/components/platform-admin/QuizEditorDialog.tsx     ← Tasks 21, 21.8
src/components/org-admin/OrgMembersTab.tsx             ← Task 21.5
src/components/org-admin/EnrollUserDialog.tsx          ← Task 21.6
src/components/org-admin/BulkInviteDialog.tsx          ← Task 21.6
src/components/org-admin/UserProgressDialog.tsx        ← Task 21.6
src/components/org-admin/analytics/CourseProgressTab.tsx ← Task 21.10
src/components/community/AIChampionsList.tsx           ← Task 21.13 (only if 21.12 ≠ Option C)
src/components/course/CourseReviewDialog.tsx           ← Task 21.3
src/components/OrgSelector.tsx                         ← Task 21.13
src/components/ui/azure-video-upload.tsx               ← Task 19
src/components/ui/azure-document-upload.tsx            ← Task 19
src/components/ui/file-upload.tsx                      ← Task 21 (Step 6)
src/pages/platform-admin/CourseEditor.tsx              ← Tasks 19, 21.8
src/pages/platform-admin/CoursesManager.tsx            ← Task 21.7
src/pages/platform-admin/OrganizationsManager.tsx      ← Task 21.9
src/pages/platform-admin/OrganizationDetail.tsx        ← Tasks 21, 21.5
src/pages/platform-admin/PlatformSettings.tsx          ← Tasks 19, 21.2
src/pages/platform-admin/PlatformCommunityModeration.tsx ← Task 21.11
src/lib/sendInvitationEmail.ts                         ← Task 19
src/lib/storage.ts                                     ← Task 21.15 (content migration required)
src/lib/resources-api.ts                               ← Task 21.13
src/lib/ideas-api.ts                                   ← Task 21.12 (if Option A)
src/lib/community-api.ts                               ← Task 21.12 (if Option A)
.github/workflows/main_func-ai-education-migration.yml
```

### Deleted files (Phase 7)
```
supabase/                             ← entire directory (after production verified)
.lovable/                             ← Lovable project config
src/integrations/supabase/            ← client.ts, types.ts
```

---

## Phase 0: Lovable Removal (no blockers)

### Task 1: Remove lovable-tagger

**Files:**
- Modify: `package.json`
- Modify: `vite.config.ts`

- [ ] **Step 1: Write failing test — vite config imports cleanly without lovable-tagger**

```bash
# Verify lovable-tagger is currently referenced
grep -c "lovable-tagger" package.json vite.config.ts
```
Expected: `package.json:1` and `vite.config.ts:1`

- [ ] **Step 2: Remove from package.json**

In `package.json`, remove the line from `devDependencies`:
```diff
-    "lovable-tagger": "^1.1.13",
```

- [ ] **Step 3: Remove from vite.config.ts**

Replace full `vite.config.ts` content:
```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig(() => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
```

- [ ] **Step 4: Uninstall and verify build**

```bash
npm uninstall lovable-tagger
npm run build
```
Expected: Build succeeds, no `lovable-tagger` in output.

- [ ] **Step 5: Commit**

```bash
git add package.json vite.config.ts package-lock.json
git commit -m "chore: remove lovable-tagger build plugin"
```

---

### Task 2: Remove Lovable project config

**Files:**
- Delete: `.lovable/` directory

- [ ] **Step 1: Verify contents**

```bash
find .lovable/ -type f
```
Expected: `.lovable/plan.md` only.

- [ ] **Step 2: Delete**

```bash
rm -rf .lovable/
```

- [ ] **Step 3: Commit**

```bash
git add -A .lovable/
git commit -m "chore: remove Lovable project config directory"
```

---

### Task 3: Fix Azure Functions CI/CD workflow

**Files:**
- Modify: `.github/workflows/main_func-ai-education-migration.yml`

- [ ] **Step 1: Verify current broken config**

```bash
grep -n "AZURE_FUNCTIONAPP_PACKAGE_PATH\|runs-on" .github/workflows/main_func-ai-education-migration.yml
```
Expected: `AZURE_FUNCTIONAPP_PACKAGE_PATH: '.'` and `runs-on: windows-latest`

- [ ] **Step 2: Apply fix**

In `.github/workflows/main_func-ai-education-migration.yml`, change:
```diff
 env:
-  AZURE_FUNCTIONAPP_PACKAGE_PATH: '.'
+  AZURE_FUNCTIONAPP_PACKAGE_PATH: 'functions'
   NODE_VERSION: '22.x'

 jobs:
   build:
-    runs-on: windows-latest
+    runs-on: ubuntu-latest
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/main_func-ai-education-migration.yml
git commit -m "fix(ci): point Azure Functions deploy at functions/ directory, use ubuntu runner"
```

---

## Phase 1: Azure Functions Scaffold + SAS Functions

### Task 4: Create functions/ scaffold

**Files:**
- Create: `functions/host.json`
- Create: `functions/package.json`
- Create: `functions/tsconfig.json`

- [ ] **Step 1: Create host.json**

```bash
mkdir -p functions/shared
```

`functions/host.json`:
```json
{
  "version": "2.0",
  "logging": {
    "applicationInsights": {
      "samplingSettings": {
        "isEnabled": true,
        "excludedTypes": "Request"
      }
    }
  },
  "extensionBundle": {
    "id": "Microsoft.Azure.Functions.ExtensionBundle",
    "version": "[4.*, 5.0.0)"
  }
}
```

- [ ] **Step 2: Create package.json**

`functions/package.json`:
```json
{
  "name": "func-ai-education-migration",
  "version": "1.0.0",
  "description": "Azure Functions backend for learn-wings",
  "main": "dist/{functionName}/index.js",
  "scripts": {
    "build": "tsc",
    "build:watch": "tsc --watch",
    "start": "npm run build && func start",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@azure/functions": "^4.5.0",
    "jwks-rsa": "^3.1.0",
    "jsonwebtoken": "^9.0.2",
    "pg": "^8.11.3"
  },
  "devDependencies": {
    "@types/jsonwebtoken": "^9.0.6",
    "@types/node": "^22.0.0",
    "@types/pg": "^8.11.6",
    "typescript": "^5.4.0",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 3: Create tsconfig.json**

`functions/tsconfig.json`:
```json
{
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2022",
    "outDir": "dist",
    "rootDir": ".",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["**/*.ts"],
  "exclude": ["node_modules", "dist", "**/*.test.ts"]
}
```

- [ ] **Step 4: Install deps and verify build**

```bash
cd functions && npm install && npm run build
```
Expected: `dist/` created, no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
cd .. && git add functions/
git commit -m "feat(functions): scaffold Azure Functions directory with build config"
```

---

### Task 5: shared/cors.ts

**Files:**
- Create: `functions/shared/cors.ts`
- Create: `functions/shared/cors.test.ts`

- [ ] **Step 1: Write failing test**

`functions/shared/cors.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { getCorsHeaders } from './cors';

describe('getCorsHeaders', () => {
  it('returns allowed origin for known origin', () => {
    const headers = getCorsHeaders('https://ai-uddannelse.dk');
    expect(headers['Access-Control-Allow-Origin']).toBe('https://ai-uddannelse.dk');
  });

  it('returns first allowed origin for unknown origin', () => {
    const headers = getCorsHeaders('https://attacker.com');
    expect(headers['Access-Control-Allow-Origin']).not.toBe('https://attacker.com');
  });

  it('handles null origin', () => {
    const headers = getCorsHeaders(null);
    expect(headers['Access-Control-Allow-Origin']).toBeDefined();
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd functions && npm test -- cors
```
Expected: FAIL — `Cannot find module './cors'`

- [ ] **Step 3: Implement**

`functions/shared/cors.ts`:
```ts
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? 'https://ai-uddannelse.dk').split(',').filter(Boolean);

export function getCorsHeaders(origin: string | null): Record<string, string> {
  const allowed = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed ?? '',
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Credentials': 'true',
  };
}

export function corsResponse(origin: string | null, status: number, body: unknown): object {
  return {
    status,
    headers: getCorsHeaders(origin),
    body: JSON.stringify(body),
  };
}

export function corsPreflightResponse(origin: string | null): object {
  return { status: 204, headers: getCorsHeaders(origin), body: '' };
}
```

- [ ] **Step 4: Verify pass**

```bash
cd functions && npm test -- cors
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add functions/shared/cors.ts functions/shared/cors.test.ts
git commit -m "feat(functions/shared): add CORS helper with ai-uddannelse.dk allowlist"
```

---

### Task 6: shared/sas.ts — Port Azure Blob SAS from Deno Web Crypto to Node.js crypto

**Files:**
- Create: `functions/shared/sas.ts`
- Create: `functions/shared/sas.test.ts`

- [ ] **Step 1: Write failing test**

`functions/shared/sas.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { generateSasToken, buildBlobUrl } from './sas';

// Test account key (base64 of 32 zero bytes — not a real key)
const TEST_KEY = Buffer.alloc(32).toString('base64');

describe('generateSasToken', () => {
  it('returns a query string with required SAS params', () => {
    const qs = generateSasToken('myaccount', TEST_KEY, 'mycontainer', 'folder/file.mp4', 'r', 120);
    const params = new URLSearchParams(qs);
    expect(params.get('sp')).toBe('r');
    expect(params.get('sv')).toBe('2022-11-02');
    expect(params.get('sr')).toBe('b');
    expect(params.get('sig')).toBeTruthy();
    expect(params.get('se')).toBeTruthy();
  });

  it('expiry is approximately expiryMinutes in the future', () => {
    const before = new Date();
    const qs = generateSasToken('a', TEST_KEY, 'c', 'b.mp4', 'r', 120);
    const params = new URLSearchParams(qs);
    const expiry = new Date(params.get('se')!);
    const diffMinutes = (expiry.getTime() - before.getTime()) / 60000;
    expect(diffMinutes).toBeGreaterThan(115);
    expect(diffMinutes).toBeLessThan(125);
  });
});

describe('buildBlobUrl', () => {
  it('assembles full blob URL', () => {
    const url = buildBlobUrl('myaccount', 'mycontainer', 'path/to/blob.mp4', 'tok=1&sp=r');
    expect(url).toBe('https://myaccount.blob.core.windows.net/mycontainer/path/to/blob.mp4?tok=1&sp=r');
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd functions && npm test -- sas
```
Expected: FAIL

- [ ] **Step 3: Implement**

`functions/shared/sas.ts`:
```ts
import { createHmac } from 'node:crypto';

export function generateSasToken(
  accountName: string,
  accountKey: string,
  containerName: string,
  blobName: string,
  permissions: string,
  expiryMinutes: number
): string {
  const start = new Date();
  start.setMinutes(start.getMinutes() - 5); // clock skew buffer
  const expiry = new Date();
  expiry.setMinutes(expiry.getMinutes() + expiryMinutes);

  const startTime = start.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const expiryTime = expiry.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const signedVersion = '2022-11-02';
  const signedResource = 'b';
  const canonicalResource = `/blob/${accountName}/${containerName}/${blobName}`;

  // Azure Blob Service SAS string-to-sign (sv=2022-11-02, blob resource)
  // https://learn.microsoft.com/en-us/rest/api/storageservices/create-service-sas
  const stringToSign = [
    permissions,      // signedPermissions
    startTime,        // signedStart
    expiryTime,       // signedExpiry
    canonicalResource,
    '',               // signedIdentifier
    '',               // signedIP
    'https',          // signedProtocol
    signedVersion,
    signedResource,
    '',               // signedSnapshotTime
    '',               // signedEncryptionScope
    '',               // rscc (cache-control)
    '',               // rscd (content-disposition)
    '',               // rsce (content-encoding)
    '',               // rscl (content-language)
    '',               // rsct (content-type)
  ].join('\n');

  const keyBuffer = Buffer.from(accountKey, 'base64');
  const signature = createHmac('sha256', keyBuffer).update(stringToSign, 'utf8').digest('base64');

  return new URLSearchParams({
    sp: permissions,
    st: startTime,
    se: expiryTime,
    sr: signedResource,
    sv: signedVersion,
    spr: 'https',
    sig: signature,
  }).toString();
}

export function buildBlobUrl(
  accountName: string,
  containerName: string,
  blobName: string,
  sasToken: string
): string {
  return `https://${accountName}.blob.core.windows.net/${containerName}/${blobName}?${sasToken}`;
}
```

- [ ] **Step 4: Verify pass**

```bash
cd functions && npm test -- sas
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add functions/shared/sas.ts functions/shared/sas.test.ts
git commit -m "feat(functions/shared): port Azure Blob SAS generation from Deno Web Crypto to Node.js crypto"
```

---

### Task 7: shared/db.ts

**Files:**
- Create: `functions/shared/db.ts`

- [ ] **Step 1: Implement**

`functions/shared/db.ts`:
```ts
import { Pool } from 'pg';

let pool: Pool | null = null;

export function getDb(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL not set');
    pool = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false }, // Azure PostgreSQL Flexible Server requires SSL
      max: 5,
      idleTimeoutMillis: 30000,
    });
  }
  return pool;
}

export async function query<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const db = getDb();
  const { rows } = await db.query(sql, params);
  return rows as T[];
}

export async function queryOne<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}
```

- [ ] **Step 2: Commit**

```bash
git add functions/shared/db.ts
git commit -m "feat(functions/shared): add pg Pool database client"
```

---

### Task 8: azure-upload-url, azure-view-url, azure-delete-blob, azure-document-upload-url

These four SAS functions have no auth code yet — we use a placeholder that will be swapped in Task 11. Each is fully testable in isolation with a hardcoded test token.

**Files:**
- Create: `functions/azure-upload-url/index.ts`
- Create: `functions/azure-view-url/index.ts`
- Create: `functions/azure-delete-blob/index.ts`
- Create: `functions/azure-document-upload-url/index.ts`
- Create: `functions/azure-upload-url/index.test.ts`

- [ ] **Step 1: Write failing test for azure-upload-url**

`functions/azure-upload-url/index.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock DB and env before import
vi.mock('../shared/db', () => ({
  queryOne: vi.fn().mockResolvedValue({ is_platform_admin: true }),
}));
process.env.AZURE_STORAGE_ACCOUNT_NAME = 'testaccount';
process.env.AZURE_STORAGE_ACCOUNT_KEY = Buffer.alloc(32).toString('base64');
process.env.AZURE_STORAGE_CONTAINER_NAME = 'lms-videos';
process.env.ALLOWED_ORIGINS = 'https://ai-uddannelse.dk';

import { default as handler } from './index';

describe('azure-upload-url', () => {
  it('returns uploadUrl, blobPath, contentType for admin user', async () => {
    const req = {
      method: 'POST',
      headers: { get: (k: string) => k === 'authorization' ? 'Bearer valid.test.token' : k === 'origin' ? 'https://ai-uddannelse.dk' : null },
      json: async () => ({ fileName: 'test-video.mp4', contentType: 'video/mp4' }),
    };
    // inject mock user — will be replaced by real auth in Task 11
    (req as any)._mockUser = { id: 'user-uuid', email: 'admin@test.com' };
    const res = await handler(req as any, {} as any);
    const body = JSON.parse(res.body);
    expect(body.uploadUrl).toMatch(/https:\/\/testaccount\.blob\.core\.windows\.net/);
    expect(body.blobPath).toMatch(/\.mp4$/);
    expect(body.contentType).toBe('video/mp4');
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd functions && npm test -- azure-upload-url
```

- [ ] **Step 3: Implement azure-upload-url**

`functions/azure-upload-url/index.ts`:
```ts
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { generateSasToken, buildBlobUrl } from '../shared/sas';
import { corsPreflightResponse, corsResponse } from '../shared/cors';
import { queryOne } from '../shared/db';
import { authenticate } from '../shared/auth';

async function handler(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin) as HttpResponseInit;

  try {
    const user = authenticate(req);

    const isAdmin = await queryOne<{ is_platform_admin: boolean }>(
      'SELECT is_platform_admin FROM profiles WHERE id = $1',
      [user.id]
    );
    if (!isAdmin?.is_platform_admin) {
      return corsResponse(origin, 403, { error: 'Only platform admins can upload videos' }) as HttpResponseInit;
    }

    const { fileName, contentType: reqContentType } = await req.json() as { fileName: string; contentType?: string };
    if (!fileName) return corsResponse(origin, 400, { error: 'fileName is required' }) as HttpResponseInit;

    const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME!;
    const accountKey = process.env.AZURE_STORAGE_ACCOUNT_KEY!;
    const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME ?? 'lms-videos';
    if (!accountName || !accountKey) {
      return corsResponse(origin, 500, { error: 'Azure storage not configured' }) as HttpResponseInit;
    }

    const ext = fileName.split('.').pop() ?? '';
    const uniqueName = `${crypto.randomUUID()}.${ext}`;
    const contentType = reqContentType ?? 'application/octet-stream';

    const sasToken = generateSasToken(accountName, accountKey, containerName, uniqueName, 'cw', 30);
    const uploadUrl = buildBlobUrl(accountName, containerName, uniqueName, sasToken);

    return corsResponse(origin, 200, { uploadUrl, blobPath: uniqueName, contentType }) as HttpResponseInit;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    const status = msg.includes('token') || msg.includes('Token') ? 401 : 500;
    return corsResponse(origin, status, { error: msg }) as HttpResponseInit;
  }
}

export default handler;
app.http('azure-upload-url', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
```

- [ ] **Step 4: Implement azure-view-url**

`functions/azure-view-url/index.ts`:
```ts
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { generateSasToken, buildBlobUrl } from '../shared/sas';
import { corsPreflightResponse, corsResponse } from '../shared/cors';
import { queryOne } from '../shared/db';
import { authenticate } from '../shared/auth';

async function canAccessAsset(userId: string, filePath: string): Promise<boolean> {
  const result = await queryOne<{ can_access: boolean }>(
    `SELECT (
      EXISTS(SELECT 1 FROM profiles WHERE id = $1 AND is_platform_admin = TRUE)
      OR EXISTS (
        SELECT 1 FROM lessons l
        JOIN course_modules cm ON cm.id = l.module_id
        JOIN courses c ON c.id = cm.course_id
        JOIN org_course_access oca ON oca.course_id = c.id
        JOIN org_memberships om ON om.org_id = oca.org_id
        WHERE c.is_published = TRUE AND oca.access = 'enabled'
          AND om.user_id = $1 AND om.status = 'active'
          AND (l.video_storage_path = $2 OR l.document_storage_path = $2)
      )
    ) AS can_access`,
    [userId, filePath]
  );
  return result?.can_access ?? false;
}

async function handler(req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin) as HttpResponseInit;

  try {
    const user = authenticate(req);
    const { blobPath } = await req.json() as { blobPath: string };
    if (!blobPath) return corsResponse(origin, 400, { error: 'blobPath is required' }) as HttpResponseInit;

    const hasAccess = await canAccessAsset(user.id, blobPath);
    if (!hasAccess) return corsResponse(origin, 403, { error: 'Access denied' }) as HttpResponseInit;

    const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME!;
    const accountKey = process.env.AZURE_STORAGE_ACCOUNT_KEY!;
    const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME ?? 'lms-videos';

    const sasToken = generateSasToken(accountName, accountKey, containerName, blobPath, 'r', 120);
    const viewUrl = buildBlobUrl(accountName, containerName, blobPath, sasToken);

    return corsResponse(origin, 200, { viewUrl }) as HttpResponseInit;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    const status = msg.includes('token') || msg.includes('Token') ? 401 : 500;
    return corsResponse(origin, status, { error: msg }) as HttpResponseInit;
  }
}

export default handler;
app.http('azure-view-url', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
```

- [ ] **Step 5: Implement azure-delete-blob**

`functions/azure-delete-blob/index.ts`:
```ts
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { generateSasToken, buildBlobUrl } from '../shared/sas';
import { corsPreflightResponse, corsResponse } from '../shared/cors';
import { queryOne } from '../shared/db';
import { authenticate } from '../shared/auth';

async function handler(req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin) as HttpResponseInit;

  try {
    const user = authenticate(req);
    const isAdmin = await queryOne<{ is_platform_admin: boolean }>(
      'SELECT is_platform_admin FROM profiles WHERE id = $1', [user.id]
    );
    if (!isAdmin?.is_platform_admin) return corsResponse(origin, 403, { error: 'Forbidden' }) as HttpResponseInit;

    const { blobPath } = await req.json() as { blobPath: string };
    if (!blobPath) return corsResponse(origin, 400, { error: 'blobPath is required' }) as HttpResponseInit;

    const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME!;
    const accountKey = process.env.AZURE_STORAGE_ACCOUNT_KEY!;
    const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME ?? 'lms-videos';

    const sasToken = generateSasToken(accountName, accountKey, containerName, blobPath, 'd', 10);
    const deleteUrl = buildBlobUrl(accountName, containerName, blobPath, sasToken);

    const res = await fetch(deleteUrl, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) {
      return corsResponse(origin, 500, { error: `Blob delete failed: ${res.status}` }) as HttpResponseInit;
    }

    return corsResponse(origin, 200, { success: true, message: 'Blob deleted' }) as HttpResponseInit;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    const status = msg.includes('token') || msg.includes('Token') ? 401 : 500;
    return corsResponse(origin, status, { error: msg }) as HttpResponseInit;
  }
}

export default handler;
app.http('azure-delete-blob', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
```

- [ ] **Step 6: Implement azure-document-upload-url**

`functions/azure-document-upload-url/index.ts`:
```ts
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { generateSasToken, buildBlobUrl } from '../shared/sas';
import { corsPreflightResponse, corsResponse } from '../shared/cors';
import { queryOne } from '../shared/db';
import { authenticate } from '../shared/auth';

async function handler(req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin) as HttpResponseInit;

  try {
    const user = authenticate(req);
    const isAdmin = await queryOne<{ is_platform_admin: boolean }>(
      'SELECT is_platform_admin FROM profiles WHERE id = $1', [user.id]
    );
    if (!isAdmin?.is_platform_admin) return corsResponse(origin, 403, { error: 'Forbidden' }) as HttpResponseInit;

    const { fileName, contentType: reqContentType } = await req.json() as { fileName: string; contentType?: string };
    if (!fileName) return corsResponse(origin, 400, { error: 'fileName is required' }) as HttpResponseInit;

    const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME!;
    const accountKey = process.env.AZURE_STORAGE_ACCOUNT_KEY!;
    const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME ?? 'lms-videos';

    const ext = fileName.split('.').pop() ?? 'pdf';
    const uniqueName = `documents/${crypto.randomUUID()}.${ext}`;
    const contentType = reqContentType ?? 'application/pdf';

    const sasToken = generateSasToken(accountName, accountKey, containerName, uniqueName, 'cw', 30);
    const uploadUrl = buildBlobUrl(accountName, containerName, uniqueName, sasToken);

    return corsResponse(origin, 200, { uploadUrl, blobPath: uniqueName, contentType }) as HttpResponseInit;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    const status = msg.includes('token') || msg.includes('Token') ? 401 : 500;
    return corsResponse(origin, status, { error: msg }) as HttpResponseInit;
  }
}

export default handler;
app.http('azure-document-upload-url', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
```

- [ ] **Step 7: Build and run tests**

```bash
cd functions && npm run build && npm test -- azure-upload-url
```
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add functions/azure-upload-url/ functions/azure-view-url/ functions/azure-delete-blob/ functions/azure-document-upload-url/
git commit -m "feat(functions): implement 4 Azure Blob SAS functions (upload/view/delete/document)"
```

---

## Auth Decision: Multi-tenant Microsoft Entra ID

**Decision made.** Auth is multi-tenant Entra ID. Users from any Entra tenant (including organizations in external Azure subscriptions) sign in via Microsoft SSO. The operator's app registration is multi-tenant; each user's `oid` + `tid` together form the unique identity. No custom password endpoints. No B2C.

Task 8.5 creates the App Registration. Task 9 implements the JWKS validator.

---

### Task 8.5: Create Azure App Registration (multi-tenant)

**This is a portal task, not a code task.** Complete before running `npm test` for Task 9.

- [ ] **Step 1: Create App Registration**

In Azure Portal → Microsoft Entra ID → App registrations → New registration:
- Name: `learn-wings`
- Supported account types: **Accounts in any organizational directory (Any Microsoft Entra ID tenant - Multitenant)**
- Redirect URI: Platform = **Single-page application (SPA)**, URI = `http://localhost:5173`

Click Register. Note the **Application (client) ID** — this is `VITE_ENTRA_CLIENT_ID`.

- [ ] **Step 2: Add production redirect URIs**

In the app registration → Authentication → Add URI:
- `https://ai-uddannelse.dk`
- `https://black-forest-0d7f96c03.7.azurestaticapps.net`

- [ ] **Step 3: Expose an API scope**

In Expose an API → Add a scope:
- Application ID URI: accept default `api://<client-id>`
- Scope name: `access_as_user`
- Who can consent: Admins and users
- Admin consent display name: `Access learn-wings as user`
- State: Enabled

Note the full scope string: `api://<client-id>/access_as_user` — this is `VITE_ENTRA_SCOPE`.

- [ ] **Step 4: Add API permissions**

In API permissions → Add a permission → Microsoft Graph → Delegated:
- `User.Read` (already present by default)

Click "Grant admin consent" for your tenant.

- [ ] **Step 5: Store in Key Vault + env files**

The client ID is not a secret but must be consistent between frontend and backend:
```bash
# Frontend .env (not a secret — included in bundle)
VITE_ENTRA_CLIENT_ID=<application-client-id>
VITE_ENTRA_SCOPE=api://<application-client-id>/access_as_user

# Azure Functions app settings (set in Azure Portal or via Key Vault reference)
ENTRA_CLIENT_ID=<application-client-id>
```

- [ ] **Step 6: Commit env template update**

```bash
# Update .env.example (NOT .env — never commit real values)
git add .env.example
git commit -m "chore: add VITE_ENTRA_CLIENT_ID and VITE_ENTRA_SCOPE to env template"
```

---

### Task 9: shared/auth.ts — multi-tenant Entra ID JWKS validation

**Files:**
- Create: `functions/shared/auth.ts`
- Create: `functions/shared/auth.test.ts`

**Note:** `authenticate` is now `async` — all calling functions from Task 10 onward must `await authenticate(req)`.

- [ ] **Step 1: Write failing test**

`functions/shared/auth.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('jwks-rsa', () => ({
  default: () => ({
    getSigningKey: (_kid: string, cb: (err: Error | null, key?: any) => void) => {
      cb(null, { getPublicKey: () => 'mock-public-key' });
    },
  }),
}));

const VALID_ISSUER = 'https://login.microsoftonline.com/11111111-1111-1111-1111-111111111111/v2.0';

vi.mock('jsonwebtoken', () => ({
  verify: (_token: string, _getKey: unknown, _opts: unknown, cb: Function) => {
    const parts = _token.split('.');
    if (parts.length !== 3) return cb(new Error('invalid token'));
    try {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
      if (payload._forceError) return cb(new Error('invalid signature'));
      cb(null, payload);
    } catch {
      cb(new Error('decode error'));
    }
  },
}));

process.env.ENTRA_CLIENT_ID = 'test-client-id';

import { authenticate, AuthError } from './auth';

function makeToken(claims: Record<string, unknown>): string {
  const h = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'k1' })).toString('base64url');
  const p = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${h}.${p}.fakesig`;
}

describe('authenticate', () => {
  it('returns user from valid Entra token', async () => {
    const token = makeToken({ oid: 'oid-abc', tid: '11111111-1111-1111-1111-111111111111', preferred_username: 'user@contoso.com', iss: VALID_ISSUER });
    const req = { headers: { get: (k: string) => k === 'authorization' ? `Bearer ${token}` : null } };
    const user = await authenticate(req as any);
    expect(user.id).toBe('oid-abc');
    expect(user.tid).toBe('11111111-1111-1111-1111-111111111111');
    expect(user.email).toBe('user@contoso.com');
  });

  it('throws AuthError on missing Bearer header', async () => {
    const req = { headers: { get: () => null } };
    await expect(authenticate(req as any)).rejects.toBeInstanceOf(AuthError);
  });

  it('throws AuthError on invalid issuer pattern', async () => {
    const token = makeToken({ oid: 'o', tid: 't', iss: 'https://evil.com/token' });
    const req = { headers: { get: () => `Bearer ${token}` } };
    await expect(authenticate(req as any)).rejects.toBeInstanceOf(AuthError);
  });

  it('throws AuthError on invalid signature', async () => {
    const token = makeToken({ _forceError: true });
    const req = { headers: { get: () => `Bearer ${token}` } };
    await expect(authenticate(req as any)).rejects.toBeInstanceOf(AuthError);
  });

  it('throws AuthError on missing oid or tid', async () => {
    const token = makeToken({ iss: VALID_ISSUER, email: 'x@y.com' });
    const req = { headers: { get: () => `Bearer ${token}` } };
    await expect(authenticate(req as any)).rejects.toBeInstanceOf(AuthError);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd functions && npm test -- auth
```
Expected: FAIL (module not found)

- [ ] **Step 3: Implement**

`functions/shared/auth.ts`:
```ts
import jwksClient from 'jwks-rsa';
import { verify } from 'jsonwebtoken';
import type { HttpRequest } from '@azure/functions';

export class AuthError extends Error {
  constructor(message: string) { super(message); this.name = 'AuthError'; }
}

export interface AuthUser {
  id: string;    // Entra oid claim
  tid: string;   // Entra tenant ID
  email: string; // preferred_username or email claim
}

const client = jwksClient({
  jwksUri: 'https://login.microsoftonline.com/common/discovery/v2.0/keys',
  cache: true,
  cacheMaxEntries: 5,
  cacheMaxAge: 600_000,
});

function getKey(header: any, callback: (err: Error | null, key?: string) => void): void {
  client.getSigningKey(header.kid, (err, key) => {
    if (err) return callback(err);
    callback(null, key?.getPublicKey());
  });
}

// Multi-tenant: issuer varies per tenant — validate pattern, not fixed value
const ISSUER_RE = /^https:\/\/login\.microsoftonline\.com\/[0-9a-f-]{36}\/v2\.0$/;

export function verifyToken(token: string): Promise<AuthUser> {
  return new Promise((resolve, reject) => {
    verify(
      token,
      getKey as any,
      {
        audience: process.env.ENTRA_CLIENT_ID,
        algorithms: ['RS256'],
        // issuer intentionally omitted — multi-tenant tokens have per-tenant issuers
      },
      (err, decoded) => {
        if (err) return reject(new AuthError(err.message));
        const d = decoded as Record<string, string>;
        if (!ISSUER_RE.test(d.iss)) return reject(new AuthError('Invalid token issuer'));
        if (!d.oid || !d.tid) return reject(new AuthError('Missing oid or tid claims'));
        resolve({
          id: d.oid,
          tid: d.tid,
          email: d.preferred_username ?? d.email ?? d.upn ?? '',
        });
      },
    );
  });
}

export async function authenticate(req: Pick<HttpRequest, 'headers'>): Promise<AuthUser> {
  const auth = req.headers.get('authorization') ?? '';
  if (!auth.startsWith('Bearer ')) throw new AuthError('Missing Bearer token');
  return verifyToken(auth.slice(7));
}
```

- [ ] **Step 4: Verify pass**

```bash
cd functions && npm test -- auth
```
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add functions/shared/auth.ts functions/shared/auth.test.ts
git commit -m "feat(functions/shared): implement multi-tenant Entra ID JWKS authentication"
```

---

### Task 10: grade-quiz (with quiz_attempts server-side)

**Files:**
- Create: `functions/grade-quiz/index.ts`
- Create: `functions/grade-quiz/index.test.ts`

- [ ] **Step 1: Write failing test**

`functions/grade-quiz/index.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('../shared/auth', () => ({
  authenticate: () => ({ id: 'learner-uuid', email: 'learner@test.com' }),
  AuthError: class AuthError extends Error {},
}));

const mockQuery = vi.fn();
const mockQueryOne = vi.fn();
vi.mock('../shared/db', () => ({ query: mockQuery, queryOne: mockQueryOne }));

import handler from './index';

describe('grade-quiz', () => {
  it('returns score and inserts quiz_attempts server-side', async () => {
    // user_can_access_quiz check
    mockQueryOne.mockResolvedValueOnce({ has_access: true });
    // quiz metadata
    mockQueryOne.mockResolvedValueOnce({ id: 'quiz-uuid', passing_score: 70 });
    // quiz questions
    mockQuery.mockResolvedValueOnce([
      { id: 'q1-uuid' }, { id: 'q2-uuid' }
    ]);
    // correct options for q1 → user selected opt-a (correct)
    mockQuery.mockResolvedValueOnce([{ id: 'opt-a', is_correct: true }]);
    // correct options for q2 → user selected opt-c (wrong)
    mockQuery.mockResolvedValueOnce([{ id: 'opt-b', is_correct: true }]);
    // quiz_attempts insert
    mockQuery.mockResolvedValueOnce([]);

    const req = {
      method: 'POST',
      headers: { get: (k: string) => k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok' },
      json: async () => ({
        quiz_id: 'quiz-uuid',
        answers: { 'q1-uuid': 'opt-a', 'q2-uuid': 'opt-c' },
      }),
    };

    const res = await handler(req as any, {} as any);
    const body = JSON.parse(res.body);

    expect(body.score).toBe(50); // 1 of 2 correct
    expect(body.passed).toBe(false);
    expect(body.correct_count).toBe(1);
    expect(body.total_questions).toBe(2);
    // Verify quiz_attempts was inserted (last mock call)
    const insertCall = mockQuery.mock.calls.find(c => (c[0] as string).includes('quiz_attempts'));
    expect(insertCall).toBeDefined();
  });

  it('returns 403 if user cannot access quiz', async () => {
    mockQueryOne.mockResolvedValueOnce({ has_access: false });
    const req = {
      method: 'POST',
      headers: { get: (k: string) => k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok' },
      json: async () => ({ quiz_id: 'quiz-uuid', answers: {} }),
    };
    const res = await handler(req as any, {} as any);
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd functions && npm test -- grade-quiz
```

- [ ] **Step 3: Implement**

`functions/grade-quiz/index.ts`:
```ts
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { query, queryOne } from '../shared/db';
import { corsPreflightResponse, corsResponse } from '../shared/cors';

async function handler(req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin) as HttpResponseInit;

  try {
    const user = authenticate(req);
    const { quiz_id, answers } = await req.json() as { quiz_id: string; answers: Record<string, string> };

    // Access check (equivalent to user_can_access_quiz RPC)
    const access = await queryOne<{ has_access: boolean }>(
      `SELECT (
        EXISTS(SELECT 1 FROM profiles WHERE id = $1 AND is_platform_admin = TRUE)
        OR EXISTS (
          SELECT 1 FROM quizzes qz
          JOIN lessons l ON l.id = qz.lesson_id
          JOIN course_modules cm ON cm.id = l.module_id
          JOIN courses c ON c.id = cm.course_id
          JOIN org_course_access oca ON oca.course_id = c.id
          JOIN org_memberships om ON om.org_id = oca.org_id
          WHERE qz.id = $2 AND c.is_published = TRUE
            AND oca.access = 'enabled' AND om.user_id = $1 AND om.status = 'active'
        )
      ) AS has_access`,
      [user.id, quiz_id]
    );
    if (!access?.has_access) return corsResponse(origin, 403, { error: 'Quiz access denied' }) as HttpResponseInit;

    const quiz = await queryOne<{ id: string; passing_score: number }>(
      'SELECT id, passing_score FROM quizzes WHERE id = $1', [quiz_id]
    );
    if (!quiz) return corsResponse(origin, 404, { error: 'Quiz not found' }) as HttpResponseInit;

    const questions = await query<{ id: string }>(
      'SELECT id FROM quiz_questions WHERE quiz_id = $1 ORDER BY sort_order', [quiz_id]
    );

    let correct_count = 0;
    for (const q of questions) {
      const correctOptions = await query<{ id: string; is_correct: boolean }>(
        'SELECT id, is_correct FROM quiz_options WHERE question_id = $1', [q.id]
      );
      const correctOptionId = correctOptions.find(o => o.is_correct)?.id;
      if (correctOptionId && answers[q.id] === correctOptionId) correct_count++;
    }

    const total_questions = questions.length;
    const score = total_questions > 0 ? Math.round((correct_count / total_questions) * 100) : 0;
    const passed = score >= quiz.passing_score;
    const passing_score = quiz.passing_score;

    // Insert quiz_attempts server-side — never trust the client to record scores
    await query(
      `INSERT INTO quiz_attempts (org_id, user_id, quiz_id, score, passed, finished_at)
       SELECT om.org_id, $1, $2, $3, $4, NOW()
       FROM org_memberships om WHERE om.user_id = $1 AND om.status = 'active' LIMIT 1`,
      [user.id, quiz_id, score, passed]
    );

    return corsResponse(origin, 200, { score, passed, passing_score, correct_count, total_questions }) as HttpResponseInit;
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message }) as HttpResponseInit;
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return corsResponse(origin, 500, { error: msg }) as HttpResponseInit;
  }
}

export default handler;
app.http('grade-quiz', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
```

- [ ] **Step 4: Verify pass**

```bash
cd functions && npm test -- grade-quiz
```
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add functions/grade-quiz/
git commit -m "feat(functions): implement grade-quiz with server-side quiz_attempts insert"
```

---

### Task 11: user-context endpoint (replaces useAuth.tsx fetchUserContext)

**Files:**
- Create: `functions/user-context/index.ts`

- [ ] **Step 1: Implement**

`functions/user-context/index.ts`:
```ts
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { query, queryOne } from '../shared/db';
import { corsPreflightResponse, corsResponse } from '../shared/cors';

async function handler(req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin) as HttpResponseInit;

  try {
    // authenticate is async (Entra ID JWKS fetch)
    const user = await authenticate(req);

    // First-login provisioning: look up by Entra oid+tid, create profile if absent
    let profile = await queryOne<{ id: string; full_name: string; email: string; is_platform_admin: boolean; avatar_url: string | null }>(
      'SELECT id, full_name, email, is_platform_admin, avatar_url FROM profiles WHERE entra_oid = $1 AND entra_tid = $2',
      [user.id, user.tid]
    );

    if (!profile) {
      // First login from this Entra identity — provision a profile row
      profile = await queryOne(
        `INSERT INTO profiles (full_name, email, entra_oid, entra_tid)
         VALUES ($1, $2, $3, $4)
         RETURNING id, full_name, email, is_platform_admin, avatar_url`,
        [user.email.split('@')[0], user.email, user.id, user.tid]
      );
    }

    const memberships = await query(
      `SELECT om.*, row_to_json(o.*) AS organization
       FROM org_memberships om
       JOIN organizations o ON o.id = om.org_id
       WHERE om.user_id = $1 AND om.status = 'active'`,
      [profile!.id]
    );

    return corsResponse(origin, 200, { profile, memberships }) as HttpResponseInit;
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message }) as HttpResponseInit;
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return corsResponse(origin, 500, { error: msg }) as HttpResponseInit;
  }
}

export default handler;
app.http('user-context', { methods: ['GET', 'POST', 'OPTIONS'], authLevel: 'anonymous', handler });
```

- [ ] **Step 2: Commit**

```bash
git add functions/user-context/
git commit -m "feat(functions): add user-context endpoint replacing useAuth fetchUserContext DB reads"
```

---

### Task 12: admin-user-actions endpoint (privilege-write safety)

**Files:**
- Create: `functions/admin-user-actions/index.ts`
- Create: `functions/admin-user-actions/index.test.ts`

- [ ] **Step 1: Write failing test**

`functions/admin-user-actions/index.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('../shared/auth', () => ({
  authenticate: () => ({ id: 'admin-uuid', email: 'admin@test.com' }),
  AuthError: class AuthError extends Error {},
}));

const mockQueryOne = vi.fn();
const mockQuery = vi.fn();
vi.mock('../shared/db', () => ({ queryOne: mockQueryOne, query: mockQuery }));

import handler from './index';

describe('admin-user-actions', () => {
  it('rejects non-admin with 403', async () => {
    mockQueryOne.mockResolvedValueOnce({ is_platform_admin: false });
    const req = {
      method: 'POST',
      headers: { get: () => 'Bearer tok' },
      json: async () => ({ type: 'toggle-platform-admin', targetUserId: 'x', value: true }),
    };
    const res = await handler(req as any, {} as any);
    expect(res.status).toBe(403);
  });

  it('toggles is_platform_admin for admin', async () => {
    mockQueryOne.mockResolvedValueOnce({ is_platform_admin: true }); // requesting user check
    mockQuery.mockResolvedValueOnce([]); // update
    const req = {
      method: 'POST',
      headers: { get: () => 'Bearer tok' },
      json: async () => ({ type: 'toggle-platform-admin', targetUserId: 'target-uuid', value: true }),
    };
    const res = await handler(req as any, {} as any);
    expect(res.status).toBe(200);
    expect(mockQuery.mock.calls[0][0]).toContain('is_platform_admin');
  });
});
```

- [ ] **Step 2: Implement**

`functions/admin-user-actions/index.ts`:
```ts
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { query, queryOne } from '../shared/db';
import { corsPreflightResponse, corsResponse } from '../shared/cors';

type ActionBody =
  | { type: 'toggle-platform-admin'; targetUserId: string; value: boolean }
  | { type: 'update-member-role'; membershipId: string; role: string }
  | { type: 'remove-membership'; membershipId: string }
  | { type: 'add-membership'; targetUserId: string; orgId: string; role: string };

async function handler(req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin) as HttpResponseInit;

  try {
    const user = authenticate(req);
    const isAdmin = await queryOne<{ is_platform_admin: boolean }>(
      'SELECT is_platform_admin FROM profiles WHERE id = $1', [user.id]
    );
    if (!isAdmin?.is_platform_admin) return corsResponse(origin, 403, { error: 'Platform admin required' }) as HttpResponseInit;

    const body = await req.json() as ActionBody;

    switch (body.type) {
      case 'toggle-platform-admin':
        await query('UPDATE profiles SET is_platform_admin = $1 WHERE id = $2', [body.value, body.targetUserId]);
        break;
      case 'update-member-role':
        await query('UPDATE org_memberships SET role = $1 WHERE id = $2', [body.role, body.membershipId]);
        break;
      case 'remove-membership':
        await query('DELETE FROM org_memberships WHERE id = $1', [body.membershipId]);
        break;
      case 'add-membership':
        await query(
          'INSERT INTO org_memberships (org_id, user_id, role, status) VALUES ($1, $2, $3, $4)',
          [body.orgId, body.targetUserId, body.role, 'active']
        );
        break;
      default:
        return corsResponse(origin, 400, { error: 'Unknown action type' }) as HttpResponseInit;
    }

    return corsResponse(origin, 200, { success: true }) as HttpResponseInit;
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message }) as HttpResponseInit;
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return corsResponse(origin, 500, { error: msg }) as HttpResponseInit;
  }
}

export default handler;
app.http('admin-user-actions', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
```

- [ ] **Step 3: Verify tests pass**

```bash
cd functions && npm test -- admin-user-actions
```

- [ ] **Step 4: Commit**

```bash
git add functions/admin-user-actions/
git commit -m "feat(functions): add admin-user-actions endpoint (replaces direct DB writes in UserDetailDialog)"
```

---

### Task 13: course-player-data endpoint

**Files:**
- Create: `functions/course-player-data/index.ts`

- [ ] **Step 1: Implement**

`functions/course-player-data/index.ts`:
```ts
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { query, queryOne } from '../shared/db';
import { corsPreflightResponse, corsResponse } from '../shared/cors';

async function handler(req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin) as HttpResponseInit;

  try {
    const user = authenticate(req);
    const { courseId, orgId } = await req.json() as { courseId: string; orgId: string };

    const course = await queryOne('SELECT * FROM courses WHERE id = $1', [courseId]);
    if (!course) return corsResponse(origin, 404, { error: 'Course not found' }) as HttpResponseInit;

    const modules = await query('SELECT * FROM course_modules WHERE course_id = $1 ORDER BY sort_order', [courseId]);
    const modulesWithLessons = await Promise.all(
      modules.map(async (m: Record<string, unknown>) => {
        const lessons = await query('SELECT * FROM lessons WHERE module_id = $1 ORDER BY sort_order', [m.id]);
        return { ...m, lessons };
      })
    );

    const progressRows = await query<{ lesson_id: string; status: string; completed_at: string }>(
      'SELECT lesson_id, status, completed_at FROM lesson_progress WHERE user_id = $1 AND org_id = $2',
      [user.id, orgId]
    );
    const progressMap = Object.fromEntries(progressRows.map(p => [p.lesson_id, p]));

    const review = await queryOne(
      'SELECT id, rating, comment FROM course_reviews WHERE user_id = $1 AND org_id = $2 AND course_id = $3',
      [user.id, orgId, courseId]
    );

    return corsResponse(origin, 200, { course, modules: modulesWithLessons, progressMap, review: review ?? null }) as HttpResponseInit;
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message }) as HttpResponseInit;
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return corsResponse(origin, 500, { error: msg }) as HttpResponseInit;
  }
}

export default handler;
app.http('course-player-data', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
```

- [ ] **Step 2: Commit**

```bash
git add functions/course-player-data/
git commit -m "feat(functions): add course-player-data endpoint (replaces 8 supabase.from reads in CoursePlayer)"
```

---

### Task 14: lesson-progress, enrollment-complete, quiz-options endpoints

**Files:**
- Create: `functions/lesson-progress/index.ts`
- Create: `functions/enrollment-complete/index.ts`
- Create: `functions/quiz-options/index.ts`
- Create: `functions/quiz-options-admin/index.ts`

- [ ] **Step 1: Implement lesson-progress**

`functions/lesson-progress/index.ts`:
```ts
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { query } from '../shared/db';
import { corsPreflightResponse, corsResponse } from '../shared/cors';

async function handler(req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin) as HttpResponseInit;
  try {
    const user = authenticate(req);
    const { orgId, lessonId, status } = await req.json() as { orgId: string; lessonId: string; status: string };
    await query(
      `INSERT INTO lesson_progress (org_id, user_id, lesson_id, status, completed_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (org_id, user_id, lesson_id) DO UPDATE SET status = $4, completed_at = NOW()`,
      [orgId, user.id, lessonId, status]
    );
    return corsResponse(origin, 200, { success: true }) as HttpResponseInit;
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message }) as HttpResponseInit;
    return corsResponse(origin, 500, { error: err instanceof Error ? err.message : 'error' }) as HttpResponseInit;
  }
}

export default handler;
app.http('lesson-progress', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
```

- [ ] **Step 2: Implement enrollment-complete**

`functions/enrollment-complete/index.ts`:
```ts
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { query } from '../shared/db';
import { corsPreflightResponse, corsResponse } from '../shared/cors';

async function handler(req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin) as HttpResponseInit;
  try {
    const user = authenticate(req);
    const { orgId, courseId } = await req.json() as { orgId: string; courseId: string };
    await query(
      `UPDATE enrollments SET status = 'completed', completed_at = NOW()
       WHERE user_id = $1 AND org_id = $2 AND course_id = $3`,
      [user.id, orgId, courseId]
    );
    return corsResponse(origin, 200, { success: true }) as HttpResponseInit;
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message }) as HttpResponseInit;
    return corsResponse(origin, 500, { error: err instanceof Error ? err.message : 'error' }) as HttpResponseInit;
  }
}

export default handler;
app.http('enrollment-complete', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
```

- [ ] **Step 3: Implement quiz-options (learner — no is_correct)**

`functions/quiz-options/index.ts`:
```ts
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { query } from '../shared/db';
import { corsPreflightResponse, corsResponse } from '../shared/cors';

async function handler(req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin) as HttpResponseInit;
  try {
    authenticate(req); // auth required, role not checked — access checked via course-player-data
    const { questionId } = await req.json() as { questionId: string };
    // Explicitly exclude is_correct — never expose to learner
    const options = await query(
      'SELECT id, option_text, sort_order FROM quiz_options WHERE question_id = $1 ORDER BY sort_order',
      [questionId]
    );
    return corsResponse(origin, 200, options) as HttpResponseInit;
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message }) as HttpResponseInit;
    return corsResponse(origin, 500, { error: err instanceof Error ? err.message : 'error' }) as HttpResponseInit;
  }
}

export default handler;
app.http('quiz-options', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
```

- [ ] **Step 4: Implement quiz-options-admin (platform admin — includes is_correct)**

`functions/quiz-options-admin/index.ts`:
```ts
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { query, queryOne } from '../shared/db';
import { corsPreflightResponse, corsResponse } from '../shared/cors';

async function handler(req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin) as HttpResponseInit;
  try {
    const user = authenticate(req);
    const isAdmin = await queryOne<{ is_platform_admin: boolean }>(
      'SELECT is_platform_admin FROM profiles WHERE id = $1', [user.id]
    );
    if (!isAdmin?.is_platform_admin) return corsResponse(origin, 403, { error: 'Forbidden' }) as HttpResponseInit;

    const { quizId } = await req.json() as { quizId: string };
    // is_correct exposed only to platform admin
    const options = await query(
      `SELECT qo.id, qo.option_text, qo.is_correct, qo.sort_order, qo.question_id
       FROM quiz_options qo
       JOIN quiz_questions qq ON qq.id = qo.question_id
       WHERE qq.quiz_id = $1 ORDER BY qq.sort_order, qo.sort_order`,
      [quizId]
    );
    return corsResponse(origin, 200, options) as HttpResponseInit;
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message }) as HttpResponseInit;
    return corsResponse(origin, 500, { error: err instanceof Error ? err.message : 'error' }) as HttpResponseInit;
  }
}

export default handler;
app.http('quiz-options-admin', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
```

- [ ] **Step 5: Build and test**

```bash
cd functions && npm run build
```
Expected: no TypeScript errors

- [ ] **Step 6: Commit**

```bash
git add functions/lesson-progress/ functions/enrollment-complete/ functions/quiz-options/ functions/quiz-options-admin/
git commit -m "feat(functions): add lesson-progress, enrollment-complete, quiz-options endpoints"
```

---

### Task 15: org-analytics-data and invitation-link

**Files:**
- Create: `functions/org-analytics-data/index.ts`
- Create: `functions/invitation-link/index.ts`

- [ ] **Step 1: Implement org-analytics-data**

`functions/org-analytics-data/index.ts`:
```ts
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { query, queryOne } from '../shared/db';
import { corsPreflightResponse, corsResponse } from '../shared/cors';

async function handler(req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin) as HttpResponseInit;
  try {
    const user = authenticate(req);
    const { orgId } = await req.json() as { orgId: string };

    // Auth check: platform admin OR org admin for this org
    const authCheck = await queryOne<{ can_access: boolean }>(
      `SELECT (
        EXISTS(SELECT 1 FROM profiles WHERE id = $1 AND is_platform_admin = TRUE)
        OR EXISTS(SELECT 1 FROM org_memberships WHERE user_id = $1 AND org_id = $2 AND role = 'org_admin' AND status = 'active')
      ) AS can_access`,
      [user.id, orgId]
    );
    if (!authCheck?.can_access) return corsResponse(origin, 403, { error: 'Forbidden' }) as HttpResponseInit;

    const [members, enrollments, quizAttempts, org] = await Promise.all([
      query('SELECT om.*, p.full_name, p.email FROM org_memberships om JOIN profiles p ON p.id = om.user_id WHERE om.org_id = $1 AND om.status = $2', [orgId, 'active']),
      query('SELECT * FROM enrollments WHERE org_id = $1', [orgId]),
      query('SELECT * FROM quiz_attempts qa JOIN enrollments e ON e.user_id = qa.user_id AND e.org_id = $1 WHERE e.org_id = $1', [orgId]),
      queryOne('SELECT * FROM organizations WHERE id = $1', [orgId]),
    ]);

    return corsResponse(origin, 200, { members, enrollments, quizAttempts, org }) as HttpResponseInit;
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message }) as HttpResponseInit;
    return corsResponse(origin, 500, { error: err instanceof Error ? err.message : 'error' }) as HttpResponseInit;
  }
}

export default handler;
app.http('org-analytics-data', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
```

- [ ] **Step 2: Implement invitation-link**

`functions/invitation-link/index.ts`:
```ts
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { queryOne } from '../shared/db';
import { corsPreflightResponse, corsResponse } from '../shared/cors';

async function handler(req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin) as HttpResponseInit;
  try {
    const user = authenticate(req);
    const isAdmin = await queryOne<{ is_platform_admin: boolean }>(
      'SELECT is_platform_admin FROM profiles WHERE id = $1', [user.id]
    );
    if (!isAdmin?.is_platform_admin) return corsResponse(origin, 403, { error: 'Forbidden' }) as HttpResponseInit;

    const { orgId } = await req.json() as { orgId: string };
    // get_invitation_link_id equivalent — fetch or generate a link record
    const link = await queryOne<{ id: string }>(
      'SELECT id FROM invitation_links WHERE org_id = $1 AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1',
      [orgId]
    );
    return corsResponse(origin, 200, { linkId: link?.id ?? null }) as HttpResponseInit;
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message }) as HttpResponseInit;
    return corsResponse(origin, 500, { error: err instanceof Error ? err.message : 'error' }) as HttpResponseInit;
  }
}

export default handler;
app.http('invitation-link', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
```

- [ ] **Step 3: Commit**

```bash
git add functions/org-analytics-data/ functions/invitation-link/
git commit -m "feat(functions): add org-analytics-data and invitation-link endpoints"
```

---

### Task 16: Remaining business logic functions

Functions 16a–16e follow the same pattern as grade-quiz. Full source is in `supabase/functions/*/index.ts` — port by replacing Deno-specific APIs and `createClient` with `shared/` utilities.

**For each function:**
- Replace `Deno.serve` with Azure Functions `app.http`
- Replace `createClient` auth with `authenticate(req)` from `shared/auth`
- Replace `supabase.from(...)` with `query()`/`queryOne()` from `shared/db`
- Replace Lovable CORS origins with `shared/cors`
- Replace `Deno.connectTls`/`Deno.connect` with `node:net`/`node:tls` (test-smtp only)
- Preserve exact response shapes (status codes, headers, binary for PDFs)

- [ ] **Step 1: Implement generate-certificate**

`functions/generate-certificate/index.ts` — copy the `generateCertificatePDF()` function body verbatim from `supabase/functions/generate-certificate/index.ts` (lines 31–300, pure TypeScript PDF generation, no Deno APIs used). Replace the `Deno.serve` handler:

```ts
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { queryOne } from '../shared/db';
import { corsPreflightResponse, getCorsHeaders } from '../shared/cors';

// [paste generateCertificatePDF function here — it uses only TextEncoder and string ops, works unchanged in Node.js]

async function handler(req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin) as HttpResponseInit;
  try {
    const user = authenticate(req);
    const { enrollmentId } = await req.json() as { enrollmentId: string };

    const enrollment = await queryOne<{ user_id: string; status: string; course_id: string }>(
      'SELECT user_id, status, course_id FROM enrollments WHERE id = $1', [enrollmentId]
    );
    if (!enrollment || enrollment.user_id !== user.id) {
      return { status: 403, headers: getCorsHeaders(origin), body: JSON.stringify({ error: 'Access denied' }) };
    }
    if (enrollment.status !== 'completed') {
      return { status: 400, headers: getCorsHeaders(origin), body: JSON.stringify({ error: 'Course not completed' }) };
    }

    const [profile, course, org] = await Promise.all([
      queryOne<{ full_name: string }>('SELECT full_name FROM profiles WHERE id = $1', [user.id]),
      queryOne<{ title: string; organization_id: string }>('SELECT title FROM courses WHERE id = $1', [enrollment.course_id]),
      queryOne<{ name: string }>('SELECT o.name FROM organizations o JOIN org_memberships om ON om.org_id = o.id WHERE om.user_id = $1 AND om.status = $2 LIMIT 1', [user.id, 'active']),
    ]);

    const pdfBytes = generateCertificatePDF(
      profile?.full_name ?? 'Unknown',
      course?.title ?? 'Course',
      new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
      org?.name ?? 'Organization',
      enrollmentId
    );

    return {
      status: 200,
      headers: {
        ...getCorsHeaders(origin),
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="certificate-${(course?.title ?? 'course').replace(/[^a-zA-Z0-9]/g, '-')}.pdf"`,
      },
      body: Buffer.from(pdfBytes).toString('binary'),
    };
  } catch (err: unknown) {
    if (err instanceof AuthError) return { status: 401, headers: getCorsHeaders(origin), body: JSON.stringify({ error: err.message }) };
    return { status: 500, headers: getCorsHeaders(origin), body: JSON.stringify({ error: err instanceof Error ? err.message : 'error' }) };
  }
}

export default handler;
app.http('generate-certificate', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
```

- [ ] **Step 2: Implement test-smtp-connection (add auth gate, replace Deno TCP)**

`functions/test-smtp-connection/index.ts`:
```ts
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { queryOne } from '../shared/db';
import { corsPreflightResponse, corsResponse } from '../shared/cors';
import { createConnection } from 'node:net';
import { connect as tlsConnect } from 'node:tls';

async function testConnection(host: string, port: number, useTls: boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Connection timeout after 8 seconds')), 8000);
    const onConnect = () => { clearTimeout(timeout); sock.destroy(); resolve(`Connected to ${host}:${port}`); };
    const onError = (e: Error) => { clearTimeout(timeout); reject(e); };
    const sock = useTls
      ? tlsConnect({ host, port, rejectUnauthorized: false }, onConnect)
      : createConnection({ host, port }, onConnect);
    sock.on('error', onError);
  });
}

async function handler(req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin) as HttpResponseInit;
  try {
    // Auth gate — current Supabase function has NONE; this is the security fix
    const user = authenticate(req);
    const isAdmin = await queryOne<{ is_platform_admin: boolean }>(
      'SELECT is_platform_admin FROM profiles WHERE id = $1', [user.id]
    );
    if (!isAdmin?.is_platform_admin) return corsResponse(origin, 403, { error: 'Platform admin required' }) as HttpResponseInit;

    const { host, port, encryption } = await req.json() as { host: string; port: number; encryption: 'none' | 'ssl_tls' | 'starttls' };
    const useTls = encryption === 'ssl_tls';
    const message = await testConnection(host, port, useTls);
    return corsResponse(origin, 200, { success: true, message }) as HttpResponseInit;
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message }) as HttpResponseInit;
    const msg = err instanceof Error ? err.message : 'Connection failed';
    return corsResponse(origin, 200, { success: false, error: msg }) as HttpResponseInit;
  }
}

export default handler;
app.http('test-smtp-connection', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
```

- [ ] **Step 3: Implement delete-user, send-invitation-email, generate-compliance-report**

Follow the same pattern: copy DB queries from Supabase source, replace Supabase client with `query()`/`queryOne()`, replace CORS with `shared/cors`, keep exact response shapes. Key points:

- `delete-user`: Replace `supabaseAdmin.auth.admin.deleteUser(userId)` with deletion from both the new auth provider's user store AND `DELETE FROM profiles WHERE id = $1`. Add self-deletion guard (`userId === user.id → 400`).
- `send-invitation-email`: Remove Lovable invite domains. Logo URL: replace `cairuxpyfshugwjrrqha.supabase.co/storage/...` with `${process.env.STATIC_ASSETS_BASE_URL}/logo-light.png` (add `STATIC_ASSETS_BASE_URL` to Function App settings pointing to SWA URL).
- `generate-compliance-report`: Copy `generateComplianceReportPDF` function body verbatim; replace DB queries; preserve binary PDF response.

- [ ] **Step 4: Build and test all functions**

```bash
cd functions && npm run build && npm test
```
Expected: all tests pass, no build errors.

- [ ] **Step 5: Commit**

```bash
git add functions/
git commit -m "feat(functions): implement remaining 3 business logic Azure Functions"
```

---

## Phase 5: Frontend Migration

### Task 17: Create src/lib/msal-config.ts and src/lib/api-client.ts

**Files:**
- Create: `src/lib/msal-config.ts`
- Create: `src/lib/api-client.ts`

- [ ] **Step 1: Add frontend deps**

```bash
npm install @azure/msal-browser @azure/msal-react
```

- [ ] **Step 2: Create msal-config.ts**

`src/lib/msal-config.ts`:
```ts
import { PublicClientApplication, type Configuration } from '@azure/msal-browser';

const msalConfig: Configuration = {
  auth: {
    clientId: import.meta.env.VITE_ENTRA_CLIENT_ID as string,
    // 'common' authority allows any Entra tenant (multi-tenant)
    authority: 'https://login.microsoftonline.com/common',
    redirectUri: import.meta.env.VITE_REDIRECT_URI as string ?? window.location.origin,
  },
  cache: {
    cacheLocation: 'sessionStorage',
    storeAuthStateInCookie: false,
  },
};

// Exported singleton — import this wherever MSAL is needed
export const msalInstance = new PublicClientApplication(msalConfig);

// Scope exposed via App Registration → Expose an API → access_as_user
export const apiScopes = [`api://${import.meta.env.VITE_ENTRA_CLIENT_ID}/access_as_user`];
```

- [ ] **Step 3: Create api-client.ts**

`src/lib/api-client.ts`:
```ts
import { msalInstance, apiScopes } from './msal-config';

const API_BASE = import.meta.env.VITE_API_BASE_URL as string;

async function getAccessToken(): Promise<string> {
  const account = msalInstance.getActiveAccount() ?? msalInstance.getAllAccounts()[0];
  if (!account) throw new Error('Not authenticated');
  const result = await msalInstance.acquireTokenSilent({ scopes: apiScopes, account });
  return result.accessToken;
}

export async function callApi<T = unknown>(path: string, body: unknown): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error ?? `API error ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function callApiRaw(path: string, body: unknown): Promise<Response> {
  const token = await getAccessToken();
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res;
}
```

- [ ] **Step 4: Wrap app in MsalProvider in src/main.tsx**

```ts
// src/main.tsx — add these imports and initialization
import { MsalProvider } from '@azure/msal-react';
import { msalInstance } from '@/lib/msal-config';

// Initialize before render (handles redirect response)
await msalInstance.initialize();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MsalProvider instance={msalInstance}>
      <App />
    </MsalProvider>
  </React.StrictMode>
);
```

- [ ] **Step 5: Update .env**

```diff
-VITE_SUPABASE_PROJECT_ID=cairuxpyfshugwjrrqha
-VITE_SUPABASE_PUBLISHABLE_KEY=[anon key]
-VITE_SUPABASE_URL=https://cairuxpyfshugwjrrqha.supabase.co
+VITE_ENTRA_CLIENT_ID=<from Task 8.5 Step 1>
+VITE_ENTRA_SCOPE=api://<client-id>/access_as_user
+VITE_API_BASE_URL=https://func-ai-education-migration-c0fgeqdnfvd6h0cf.swedencentral-01.azurewebsites.net
+VITE_STORAGE_BASE_URL=https://staieducationmigration.blob.core.windows.net
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/msal-config.ts src/lib/api-client.ts src/main.tsx .env
git commit -m "feat(frontend): add MSAL config singleton and api-client.ts with Entra token acquisition"
```

---

### Task 18: Replace useAuth.tsx with MSAL-based implementation

**Files:**
- Modify: `src/hooks/useAuth.tsx`

Replace the file entirely. The new implementation uses `useMsal()` from `@azure/msal-react`. There is no email/password sign-in — users sign in via Microsoft SSO (`loginRedirect`). First-login profile provisioning is handled server-side in the `user-context` endpoint (Task 11).

- [ ] **Step 1: Replace src/hooks/useAuth.tsx entirely**

```ts
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useMsal, useAccount } from '@azure/msal-react';
import { InteractionStatus } from '@azure/msal-browser';
import { apiScopes } from '@/lib/msal-config';
import { callApi } from '@/lib/api-client';
import type { Profile, OrgMembership, Organization } from '@/lib/types';

export interface AppUser { id: string; tid: string; email: string; name: string; }
export type ViewMode = 'learner' | 'org_admin' | 'platform_admin';

interface AuthContextType {
  user: AppUser | null;
  profile: Profile | null;
  memberships: OrgMembership[];
  currentOrg: Organization | null;
  isPlatformAdmin: boolean;
  isOrgAdmin: boolean;
  isLoading: boolean;
  signIn: () => void;
  signOut: () => void;
  refreshUserContext: () => Promise<void>;
  setCurrentOrg: (org: Organization) => void;
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  effectiveIsPlatformAdmin: boolean;
  effectiveIsOrgAdmin: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { instance, accounts, inProgress } = useMsal();
  // useAccount tracks the active account reactively
  const account = useAccount(accounts[0] ?? null);

  const [profile, setProfile] = useState<Profile | null>(null);
  const [memberships, setMemberships] = useState<OrgMembership[]>([]);
  const [currentOrg, setCurrentOrg] = useState<Organization | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('platform_admin');

  // isLoading is true while MSAL is processing a redirect or popup interaction
  const isLoading = inProgress !== InteractionStatus.None;

  const user: AppUser | null = account
    ? {
        id: (account.idTokenClaims?.oid as string) ?? account.localAccountId,
        tid: account.tenantId,
        email: account.username,
        name: account.name ?? '',
      }
    : null;

  const isPlatformAdmin = profile?.is_platform_admin ?? false;
  const isOrgAdmin = memberships.some(m => m.role === 'org_admin' && m.status === 'active');
  const effectiveIsPlatformAdmin = isPlatformAdmin && viewMode === 'platform_admin';
  const effectiveIsOrgAdmin = isPlatformAdmin
    ? viewMode === 'org_admin' || viewMode === 'platform_admin'
    : isOrgAdmin;

  const fetchUserContext = async () => {
    if (!account) return;
    try {
      const { profile: p, memberships: m } = await callApi<{ profile: Profile; memberships: OrgMembership[] }>('/api/user-context', {});
      setProfile(p);
      setMemberships(m);
      if (m.length > 0 && !currentOrg && !p?.is_platform_admin) {
        setCurrentOrg((m[0] as any).organization ?? null);
      }
    } catch {
      setProfile(null);
      setMemberships([]);
    }
  };

  // Fetch profile whenever account changes or MSAL finishes an interaction
  useEffect(() => {
    if (account && inProgress === InteractionStatus.None) {
      fetchUserContext();
    }
    if (!account && inProgress === InteractionStatus.None) {
      setProfile(null);
      setMemberships([]);
      setCurrentOrg(null);
    }
  }, [account?.localAccountId, inProgress]);

  // loginRedirect sends user to Microsoft login page; MSAL handles the redirect back
  const signIn = () => {
    instance.loginRedirect({ scopes: apiScopes });
  };

  const signOut = () => {
    setProfile(null);
    setMemberships([]);
    setCurrentOrg(null);
    instance.logoutRedirect();
  };

  return (
    <AuthContext.Provider value={{
      user, profile, memberships, currentOrg,
      isPlatformAdmin, isOrgAdmin, isLoading,
      signIn, signOut, refreshUserContext: fetchUserContext,
      setCurrentOrg, viewMode, setViewMode,
      effectiveIsPlatformAdmin, effectiveIsOrgAdmin,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useAuth.tsx
git commit -m "feat(frontend): replace useAuth with MSAL-based Entra ID SSO implementation"
```

---

### Task 19: Update all 12 function.invoke / raw-fetch call sites

**Files:** See §5–13 in `migration/lovable-supabase-removal/06-proposed-code-changes.md` for exact before/after for each line.

- [ ] **Step 1: Apply all 12 call site changes in one commit**

Files to modify:
- `src/lib/sendInvitationEmail.ts:24` → `callApi('/api/send-invitation-email', ...)`
- `src/pages/learner/CoursePlayer.tsx:208` → `callApi('/api/azure-view-url', ...)`
- `src/pages/learner/CoursePlayer.tsx:233` → `callApi('/api/azure-view-url', ...)`
- `src/pages/learner/CoursePlayer.tsx:335` → `callApi('/api/grade-quiz', ...)`
- `src/pages/learner/Dashboard.tsx:147` → `callApiRaw('/api/generate-certificate', ...)` + `response.blob()`
- `src/components/platform-admin/UserDetailDialog.tsx:186` → `callApi('/api/delete-user', ...)`
- `src/pages/org-admin/OrgAnalytics.tsx:275` → `callApiRaw('/api/generate-compliance-report', ...)` + `response.blob()`
- `src/components/ui/azure-video-upload.tsx:38` → `callApi('/api/azure-view-url', ...)`
- `src/components/ui/azure-video-upload.tsx:75` → `callApi('/api/azure-upload-url', ...)`
- `src/pages/platform-admin/CourseEditor.tsx:262` → `callApi('/api/azure-delete-blob', ...)`
- `src/components/ui/azure-document-upload.tsx:65` → `callApi('/api/azure-document-upload-url', ...)`
- `src/pages/platform-admin/PlatformSettings.tsx:151` → `callApi('/api/test-smtp-connection', ...)`

For each: add `import { callApi, callApiRaw } from '@/lib/api-client'`, remove `supabase.functions.invoke` import, replace `{ data, error }` destructuring with try/catch.

- [ ] **Step 2: Commit**

```bash
git add src/
git commit -m "feat(frontend): replace all 12 supabase.functions.invoke call sites with callApi"
```

---

### Task 20: Replace CoursePlayer.tsx DB reads/writes and RPC

**Files:**
- Modify: `src/pages/learner/CoursePlayer.tsx`

- [ ] **Step 1: Replace fetchData (lines 63–123)**

```ts
// BEFORE: 8 separate supabase.from() calls in fetchData()
// AFTER:
const fetchData = async () => {
  if (!user || !currentOrg || !courseId) return;
  const data = await callApi<{
    course: Course;
    modules: Array<Module & { lessons: Lesson[] }>;
    progressMap: Record<string, { status: string; completed_at: string }>;
    review: { id: string; rating: number; comment: string } | null;
  }>('/api/course-player-data', { courseId, orgId: currentOrg.id });
  setCourse(data.course);
  setModules(data.modules as any);
  setProgress(data.progressMap as any);
  setExistingReview(data.review as any);
  setLoading(false);
};
```

- [ ] **Step 2: Replace quiz options RPC (lines 172–179)**

```ts
// BEFORE:
const { data: options } = await supabase.rpc('get_quiz_options_for_learner', { p_question_id: q.id });
// AFTER:
const options = await callApi<QuizOption[]>('/api/quiz-options', { questionId: q.id });
```

- [ ] **Step 3: Replace lesson_progress upsert (line 276)**

```ts
// BEFORE:
const { error } = await supabase.from('lesson_progress').upsert({ ... });
// AFTER:
await callApi('/api/lesson-progress', { orgId: currentOrg.id, lessonId: currentLesson.id, status: 'completed' });
```

- [ ] **Step 4: Replace enrollment update (line 310)**

```ts
// BEFORE:
await supabase.from('enrollments').update({ status: 'completed', completed_at: ... }).eq(...);
// AFTER:
await callApi('/api/enrollment-complete', { orgId: currentOrg.id, courseId });
```

- [ ] **Step 5: Remove quiz_attempts.insert (line 357)**

Delete lines 357–364 entirely. grade-quiz Azure Function now inserts quiz_attempts server-side.

- [ ] **Step 6: Update course_reviews refresh callback (line 782)**

```ts
// BEFORE:
supabase.from('course_reviews').select('*').eq(...).then(...)
// AFTER:
callApi<{ course: Course; modules: any; progressMap: any; review: any } | null>(
  '/api/course-player-data', { courseId: course.id, orgId: currentOrg.id }
).then(data => { if (data?.review) setExistingReview(data.review as any); });
```

- [ ] **Step 7: Remove supabase import from CoursePlayer.tsx**

```ts
// Remove:
import { supabase } from '@/integrations/supabase/client';
```

- [ ] **Step 8: Commit**

```bash
git add src/pages/learner/CoursePlayer.tsx
git commit -m "feat(frontend): replace all 15 supabase calls in CoursePlayer with API endpoints"
```

---

### Task 21: Update remaining frontend files

**Files:** 9 remaining files with direct `supabase.*` calls beyond the covered ones.

- [ ] **Step 1: Update UserDetailDialog.tsx (lines 81, 105, 129, 153, 186)**

Replace all 4 direct DB writes and the delete-user raw fetch with `callApi`:
```ts
// line 81: toggle platform admin
await callApi('/api/admin/user-actions', { type: 'toggle-platform-admin', targetUserId: user.id, value: newValue });

// line 105: update member role
await callApi('/api/admin/user-actions', { type: 'update-member-role', membershipId, role: newRole });

// line 129: remove membership
await callApi('/api/admin/user-actions', { type: 'remove-membership', membershipId });

// line 153: add membership
await callApi('/api/admin/user-actions', { type: 'add-membership', targetUserId: user.id, orgId: newOrgId, role });
```

Replace try/catch around delete-user from raw fetch to `callApi`. Remove `supabase.auth.getSession()` at line 183 — auth token comes from `localStorage.getItem('auth_token')` via `callApi`.

- [ ] **Step 2: Update OrgAnalytics.tsx (lines 70–200, 268, 275, 315)**

Replace analytics reads with `callApi('/api/org-analytics-data', { orgId })`. Replace generate-compliance-report raw fetch with `callApiRaw`. Replace `supabase.storage.getPublicUrl` with:
```ts
const publicUrl = `${import.meta.env.VITE_STORAGE_BASE_URL}/org-assets/logos/${orgId}.png`;
```

- [ ] **Step 3: Update QuizEditorDialog.tsx:100**

```ts
// BEFORE:
const { data } = await supabase.rpc('get_quiz_options_with_answers', { p_quiz_id: quizId });
// AFTER:
const data = await callApi<QuizOptionWithAnswer[]>('/api/quiz-options-admin', { quizId });
```

- [ ] **Step 4: Update OrganizationDetail.tsx — get_invitation_link_id**

```ts
// BEFORE:
const { data } = await supabase.rpc('get_invitation_link_id', { p_org_id: orgId });
// AFTER:
const data = await callApi<{ linkId: string }>('/api/invitation-link', { orgId });
```

- [ ] **Step 5: Update Login.tsx, Signup.tsx, ForgotPassword.tsx, ResetPassword.tsx, Settings.tsx**

**Auth is now entirely delegated to Microsoft Entra ID — no email/password forms remain in the app.**

`Login.tsx` — replace the form body with a single button:
```tsx
import { useAuth } from '@/hooks/useAuth';
export default function Login() {
  const { signIn } = useAuth();
  return (
    <div className="flex min-h-screen items-center justify-center">
      <button onClick={signIn} className="btn-primary">
        Sign in with Microsoft
      </button>
    </div>
  );
}
```

`Signup.tsx` — new accounts are created in Entra ID (by IT admin or self-service if tenant allows). Redirect to login:
```tsx
import { Navigate } from 'react-router-dom';
export default function Signup() { return <Navigate to="/login" replace />; }
```

`ForgotPassword.tsx` and `ResetPassword.tsx` — password management is in Entra ID. Replace with a redirect and message:
```tsx
export default function ForgotPassword() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <p>Password reset is managed by your organization's IT administrator via Microsoft Entra ID.</p>
    </div>
  );
}
```

`Settings.tsx` — remove the "Change password" section entirely. Password changes happen in Entra ID. Keep all other settings (name, avatar, org preferences) using `callApi('/api/user-context', ...)` for profile updates if applicable.

- [ ] **Step 6: Update src/lib/storage.ts and file-upload.tsx**

`src/lib/storage.ts` wraps `supabase.storage`. Replace with Azure Blob Storage calls using the SAS endpoints (azure-upload-url, azure-view-url). Consult the existing `azure-video-upload.tsx` pattern.

- [ ] **Step 7: Commit**

```bash
git add src/
git commit -m "feat(frontend): replace all remaining direct supabase.from/auth/storage/rpc calls"
```

---

## Phase 5.5: Scope Correction (post-audit, 2026-06-03)

### Task 21.1: Re-audit remaining frontend files

**Context:** Task 21 was scoped against an undercount. A `grep "supabase\."` audit missed multi-line chained calls (`await supabase\n  .from(...)`), which is the dominant pattern in this codebase. The corrected audit found 27 files (not 9–13) and 166 total call sites. This task records the corrected scope so subsequent tasks can be planned.

- [ ] **Step 1: Run the corrected audit**

```bash
for f in $(grep -rl "integrations/supabase" src/ --include="*.ts" --include="*.tsx" | grep -v "^src/integrations/" | sort); do
  total=$(grep -c "\bsupabase\b" "$f")
  imports=$(grep -c "^import.*supabase" "$f")
  echo "$((total - imports))  $f"
done | sort -rn
```

Expected current output (refresh as work progresses):

| Calls | File | Covered by task |
|------:|------|-----------------|
| 22 | `src/lib/community-api.ts` | 21.13 |
| 21 | `src/lib/ideas-api.ts` | 21.13 |
| 13 | `src/pages/platform-admin/OrganizationDetail.tsx` | 21.5 |
| 12 | `src/pages/platform-admin/CourseEditor.tsx` | 21.8 |
| 12 | `src/pages/org-admin/OrgUsers.tsx` | 21.5 |
| 12 | `src/components/org-admin/OrgMembersTab.tsx` | 21.5 |
| 10 | `src/pages/platform-admin/CoursesManager.tsx` | 21.7 |
| 9 | `src/components/platform-admin/QuizEditorDialog.tsx` | 21.8 |
| 8 | `src/pages/platform-admin/OrganizationsManager.tsx` | 21.10 |
| 5 | `src/pages/learner/Courses.tsx` | 21.3 |
| 5 | `src/lib/resources-api.ts` | 21.14 |
| 5 | `src/components/org-admin/UserProgressDialog.tsx` | 21.6 |
| 4 | `src/pages/platform-admin/PlatformCommunityModeration.tsx` | 21.12 |
| 4 | `src/pages/org-admin/OrgCommunityModeration.tsx` | 21.12 |
| 4 | `src/pages/learner/Dashboard.tsx` | 21.3 |
| 4 | `src/components/org-admin/EnrollUserDialog.tsx` | 21.6 |
| 3 | `src/components/org-admin/analytics/CourseProgressTab.tsx` | 21.11 |
| 2 | `src/pages/platform-admin/PlatformSettings.tsx` | 21.2 |
| 2 | `src/pages/org-admin/OrgAnalytics.tsx` | 21.11 |
| 2 | `src/pages/learner/CoursePlayer.tsx` | 21.4 |
| 2 | `src/hooks/usePlatformSettings.tsx` | 21.2 |
| 2 | `src/components/org-admin/BulkInviteDialog.tsx` | 21.6 |
| 1 | `src/pages/org-admin/OrgSettings.tsx` | 21.2 |
| 1 | `src/lib/storage.ts` | 21.15 (deferred) |
| 1 | `src/components/OrgSelector.tsx` | 21.14 |
| 1 | `src/components/course/CourseReviewDialog.tsx` | 21.3 |
| 1 | `src/components/community/AIChampionsList.tsx` | 21.14 |

- [ ] **Step 2: Commit the corrected audit**

```bash
git add docs/superpowers/plans/2026-05-17-lovable-supabase-migration.md
git commit -m "docs(plan): correct Task 21 scope after re-audit (27 files, 166 calls)"
```

---

### Task 21.2: platform-settings endpoint + settings frontend

**Files:**
- Create: `functions/platform-settings/index.ts`, `functions/platform-settings/index.test.ts`
- Modify: `src/hooks/usePlatformSettings.tsx`, `src/pages/org-admin/OrgSettings.tsx`, `src/pages/platform-admin/PlatformSettings.tsx`

- [ ] **Step 1: Write failing test**

`functions/platform-settings/index.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockQuery, mockQueryOne } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockQueryOne: vi.fn(),
}));
vi.mock('../shared/auth', () => ({
  authenticate: async () => ({ id: 'entra-oid', tid: 'entra-tid', email: 'u@test.com' }),
  AuthError: class AuthError extends Error {},
}));
vi.mock('../shared/db', () => ({ query: mockQuery, queryOne: mockQueryOne }));

import handler from './index';

const req = (body: unknown) => ({
  method: 'POST',
  headers: { get: () => 'Bearer tok' },
  json: async () => body,
}) as any;

describe('platform-settings', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns platform + org features for member', async () => {
    mockQuery.mockResolvedValueOnce([{ key: 'platform_name', value: 'X' }]);
    mockQueryOne.mockResolvedValueOnce({ features: { community: true } });
    const res = await handler(req({ action: 'get', orgId: 'org-1' }), {} as any);
    expect(res.status).toBe(200);
    expect(res.jsonBody.platform.platform_name).toBe('X');
    expect(res.jsonBody.org.features.community).toBe(true);
  });

  it('rejects non-admin platform update with 403', async () => {
    mockQueryOne.mockResolvedValueOnce({ is_platform_admin: false });
    const res = await handler(req({ action: 'update-platform', updates: { x: 1 } }), {} as any);
    expect(res.status).toBe(403);
  });

  it('rejects org_settings write without org_admin role', async () => {
    mockQueryOne.mockResolvedValueOnce({ can_write: false });
    const res = await handler(req({ action: 'update-org', orgId: 'org-1', features: {} }), {} as any);
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Implement**

`functions/platform-settings/index.ts`:
```ts
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { query, queryOne } from '../shared/db';
import { corsPreflightResponse, corsResponse } from '../shared/cors';

type Body =
  | { action: 'get'; orgId?: string }
  | { action: 'update-platform'; updates: Record<string, unknown> }
  | { action: 'update-org'; orgId: string; features: Record<string, unknown> };

async function handler(req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin) as HttpResponseInit;

  try {
    const user = await authenticate(req);
    const body = await req.json() as Body;

    if (body.action === 'get') {
      const platform = await query<{ key: string; value: unknown }>(
        'SELECT key, value FROM platform_settings', []
      );
      const platformMap = Object.fromEntries(platform.map(r => [r.key, r.value]));
      let org: { features: Record<string, unknown> } | null = null;
      if (body.orgId) {
        org = await queryOne<{ features: Record<string, unknown> }>(
          'SELECT features FROM org_settings WHERE org_id = $1', [body.orgId]
        );
      }
      return corsResponse(origin, 200, { platform: platformMap, org }) as HttpResponseInit;
    }

    if (body.action === 'update-platform') {
      const isAdmin = await queryOne<{ is_platform_admin: boolean }>(
        'SELECT is_platform_admin FROM profiles WHERE entra_oid = $1', [user.id]
      );
      if (!isAdmin?.is_platform_admin) {
        return corsResponse(origin, 403, { error: 'Platform admin required' }) as HttpResponseInit;
      }
      for (const [key, value] of Object.entries(body.updates)) {
        await query(
          `INSERT INTO platform_settings (key, value) VALUES ($1, $2)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
          [key, value]
        );
      }
      return corsResponse(origin, 200, { success: true }) as HttpResponseInit;
    }

    // update-org
    const can = await queryOne<{ can_write: boolean }>(
      `SELECT (
        EXISTS(SELECT 1 FROM profiles WHERE entra_oid = $1 AND is_platform_admin = TRUE)
        OR EXISTS(
          SELECT 1 FROM org_memberships om
          JOIN profiles p ON p.id = om.user_id
          WHERE p.entra_oid = $1 AND om.org_id = $2 AND om.role = 'org_admin' AND om.status = 'active'
        )
      ) AS can_write`,
      [user.id, body.orgId]
    );
    if (!can?.can_write) return corsResponse(origin, 403, { error: 'Forbidden' }) as HttpResponseInit;
    await query(
      `INSERT INTO org_settings (org_id, features) VALUES ($1, $2)
       ON CONFLICT (org_id) DO UPDATE SET features = EXCLUDED.features`,
      [body.orgId, body.features]
    );
    return corsResponse(origin, 200, { success: true }) as HttpResponseInit;
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message }) as HttpResponseInit;
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return corsResponse(origin, 500, { error: msg }) as HttpResponseInit;
  }
}

export default handler;
app.http('platform-settings', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
```

- [ ] **Step 3: Verify tests pass**

```bash
cd functions && npm test -- platform-settings
```

- [ ] **Step 4: Migrate `src/hooks/usePlatformSettings.tsx`**

```ts
// BEFORE:
const [platformRes, orgRes] = await Promise.all([
  supabase.from('platform_settings').select('key, value'),
  currentOrg ? supabase.from('org_settings').select('features').eq('org_id', currentOrg.id).maybeSingle() : Promise.resolve({ data: null }),
]);
// AFTER:
const data = await callApi<{ platform: Record<string, unknown>; org: { features: Record<string, unknown> } | null }>(
  '/api/platform-settings', { action: 'get', orgId: currentOrg?.id }
);
```

- [ ] **Step 5: Migrate `src/pages/org-admin/OrgSettings.tsx`**

```ts
// BEFORE:
const { error } = await supabase.from('org_settings').upsert({ org_id, features });
// AFTER:
await callApi('/api/platform-settings', { action: 'update-org', orgId: org_id, features });
```

- [ ] **Step 6: Migrate `src/pages/platform-admin/PlatformSettings.tsx` reads + writes**

Replace the two remaining `supabase.from('platform_settings')` calls with the `get` / `update-platform` actions on `/api/platform-settings`.

- [ ] **Step 7: Remove the now-unused supabase import from each file**

Verify with `grep -c "\bsupabase\b" <file>` — should equal `grep -c "^import.*supabase" <file>` before the import line is removed, and 0 after.

- [ ] **Step 8: Commit**

```bash
git add functions/platform-settings/ src/hooks/usePlatformSettings.tsx src/pages/org-admin/OrgSettings.tsx src/pages/platform-admin/PlatformSettings.tsx
git commit -m "feat: platform-settings endpoint + migrate 3 frontend settings call sites"
```

---

### Task 21.3: learner-data endpoint + Courses/Dashboard/Review migrations

**Files:**
- Create: `functions/learner-data/index.ts`, `functions/learner-data/index.test.ts`
- Create: `functions/submit-review/index.ts`, `functions/submit-review/index.test.ts`
- Modify: `src/pages/learner/Courses.tsx`, `src/pages/learner/Dashboard.tsx`, `src/components/course/CourseReviewDialog.tsx`

- [ ] **Step 1: Write failing test for learner-data**

Pattern as in Task 12 (`vi.hoisted()`, `beforeEach(vi.clearAllMocks)`). Cover three actions:
- `{ action: 'enrolled-courses', orgId }` → returns enrollments with course data + computed progress
- `{ action: 'available-courses', orgId }` → returns courses the user has org access to but is not yet enrolled in
- `{ action: 'dashboard', orgId }` → returns enrollments grouped (in-progress vs completed) + course thumbnails

Test cases:
- happy path returns expected shape
- enrolled-courses excludes courses not in `org_course_access`
- 401 if profile not found by `entra_oid`

- [ ] **Step 2: Implement learner-data**

`functions/learner-data/index.ts`:
```ts
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { query, queryOne } from '../shared/db';
import { corsPreflightResponse, corsResponse } from '../shared/cors';

type Body =
  | { action: 'enrolled-courses'; orgId: string }
  | { action: 'available-courses'; orgId: string }
  | { action: 'dashboard'; orgId: string };

async function handler(req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin) as HttpResponseInit;
  try {
    const user = await authenticate(req);
    const profile = await queryOne<{ id: string }>(
      'SELECT id FROM profiles WHERE entra_oid = $1', [user.id]
    );
    if (!profile) return corsResponse(origin, 401, { error: 'Profile not found' }) as HttpResponseInit;
    const body = await req.json() as Body;

    if (body.action === 'enrolled-courses' || body.action === 'dashboard') {
      const enrollments = await query<any>(
        `SELECT e.*, c.* FROM enrollments e JOIN courses c ON c.id = e.course_id
         WHERE e.user_id = $1 AND e.org_id = $2`,
        [profile.id, body.orgId]
      );
      // Compute progress per course (total lessons + completed)
      const courseIds = enrollments.map(e => e.course_id);
      const progressMap: Record<string, { total: number; completed: number }> = {};
      if (courseIds.length > 0) {
        const counts = await query<{ course_id: string; total: number; completed: number }>(
          `SELECT cm.course_id,
                  COUNT(l.id)::int AS total,
                  COUNT(lp.lesson_id)::int FILTER (WHERE lp.status = 'completed') AS completed
           FROM course_modules cm
           JOIN lessons l ON l.module_id = cm.id
           LEFT JOIN lesson_progress lp ON lp.lesson_id = l.id AND lp.user_id = $1 AND lp.org_id = $2
           WHERE cm.course_id = ANY($3)
           GROUP BY cm.course_id`,
          [profile.id, body.orgId, courseIds]
        );
        for (const c of counts) progressMap[c.course_id] = { total: c.total, completed: c.completed };
      }
      return corsResponse(origin, 200, { enrollments, progressMap }) as HttpResponseInit;
    }

    // available-courses
    const courses = await query(
      `SELECT c.* FROM courses c
       JOIN org_course_access oca ON oca.course_id = c.id
       WHERE oca.org_id = $1 AND c.is_published = TRUE
         AND NOT EXISTS (
           SELECT 1 FROM enrollments e
           WHERE e.user_id = $2 AND e.course_id = c.id AND e.org_id = $1
         )`,
      [body.orgId, profile.id]
    );
    return corsResponse(origin, 200, { courses }) as HttpResponseInit;
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message }) as HttpResponseInit;
    return corsResponse(origin, 500, { error: err instanceof Error ? err.message : 'error' }) as HttpResponseInit;
  }
}

export default handler;
app.http('learner-data', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
```

- [ ] **Step 3: Implement submit-review (same TDD pattern)**

Pattern: action `{ courseId, orgId, rating, comment }`. Auth: user must have an active enrollment in `(courseId, orgId)`. UPSERT into `course_reviews` on `(course_id, user_id, org_id)`.

- [ ] **Step 4: Migrate `Dashboard.tsx`**

Replace the 4 supabase reads (enrollments, modules, lessons, lesson_progress) with `callApi<{ enrollments, progressMap }>('/api/learner-data', { action: 'dashboard', orgId })`.

- [ ] **Step 5: Migrate `Courses.tsx`**

Replace the 5 supabase reads with two calls: `enrolled-courses` and `available-courses`. The enrollment-insert call (line 107) becomes `callApi('/api/enroll', { courseId, orgId })` — endpoint added in Task 21.6.

- [ ] **Step 6: Migrate `CourseReviewDialog.tsx`**

Replace the single `supabase.from('course_reviews').upsert(...)` with `callApi('/api/submit-review', { courseId, orgId, rating, comment })`.

- [ ] **Step 7: Commit**

```bash
git add functions/learner-data/ functions/submit-review/ src/pages/learner/Dashboard.tsx src/pages/learner/Courses.tsx src/components/course/CourseReviewDialog.tsx
git commit -m "feat: learner-data + submit-review endpoints, migrate 10 learner call sites"
```

---

### Task 21.4: Extend course-player-data with quiz fixtures + CoursePlayer cleanup

**Context:** Task 20 left two `supabase.from` reads in CoursePlayer.tsx for `quizzes` and `quiz_questions`. The `course-player-data` endpoint did not return quiz fixtures. Extend it.

**Files:**
- Modify: `functions/course-player-data/index.ts` + its test
- Modify: `src/pages/learner/CoursePlayer.tsx`

- [ ] **Step 1: Extend the endpoint test**

Add a case asserting the response now includes `quizzes: Array<{ id, lesson_id, passing_score, ... }>` and `quizQuestions: Array<{ id, quiz_id, sort_order, prompt }>` (NO `is_correct` — that stays in `quiz-options` only).

- [ ] **Step 2: Extend the implementation**

Add to the Promise.all:
```ts
query('SELECT q.* FROM quizzes q JOIN lessons l ON l.id = q.lesson_id JOIN course_modules cm ON cm.id = l.module_id WHERE cm.course_id = $1', [courseId]),
query('SELECT qq.id, qq.quiz_id, qq.sort_order, qq.prompt FROM quiz_questions qq JOIN quizzes q ON q.id = qq.quiz_id JOIN lessons l ON l.id = q.lesson_id JOIN course_modules cm ON cm.id = l.module_id WHERE cm.course_id = $1', [courseId]),
```

Return them in the response body.

- [ ] **Step 3: Migrate CoursePlayer.tsx**

Remove the `loadQuiz` effect's two `supabase.from('quizzes')` / `supabase.from('quiz_questions')` reads. Read from the new fields on `course-player-data` response (cached in component state from `fetchData`). Filter by `lesson_id` client-side.

- [ ] **Step 4: Remove supabase import from CoursePlayer.tsx**

```ts
// Delete this line:
import { supabase } from '@/integrations/supabase/client';
```

Verify: `grep -c "\bsupabase\b" src/pages/learner/CoursePlayer.tsx` returns 0.

- [ ] **Step 5: Commit**

```bash
git add functions/course-player-data/ src/pages/learner/CoursePlayer.tsx
git commit -m "feat: extend course-player-data with quiz fixtures, remove supabase from CoursePlayer"
```

---

### Task 21.5: org-members endpoint + member-admin frontend migrations

**Files:**
- Create: `functions/org-members/index.ts`, `functions/org-members/index.test.ts`
- Modify: `src/components/org-admin/OrgMembersTab.tsx`, `src/pages/org-admin/OrgUsers.tsx`, `src/pages/platform-admin/OrganizationDetail.tsx`

**Endpoint shape:** action-discriminated POST. Actions:
- `{ action: 'list', orgId, includeInactive?: boolean }` → members with profiles
- `{ action: 'lookup-by-name', name }` → `{ id, full_name, email } | null`
- `{ action: 'set-status', membershipId, status }` → active/inactive (already-disabled members can be reactivated)
- `{ action: 'create-invitation', orgId, email, role, firstName?, lastName?, department? }` → returns `{ invitationId, linkId }` for the email send

**Auth:** all actions require platform admin OR `org_admin` of the targeted org. The `lookup-by-name` action additionally requires that the looked-up user share at least one org with the requester.

- [ ] **Step 1: Write failing tests** (same pattern as Task 12; cover one happy path per action plus the 403 case)

- [ ] **Step 2: Implement** — pattern as in `admin-user-actions` (Task 12). Use the profile-lookup boilerplate from §3 of the Self-Review.

- [ ] **Step 3: Migrate `OrgMembersTab.tsx`** — 12 calls collapse to ~4 `callApi` calls:
  - member list → `{ action: 'list', orgId }`
  - profile lookup by name → `{ action: 'lookup-by-name', name }`
  - status changes (enable/disable) → `{ action: 'set-status', membershipId, status }`
  - invite creation → `{ action: 'create-invitation', ... }` then call `sendInvitationEmail`

- [ ] **Step 4: Migrate `OrgUsers.tsx`** — same 12 calls, same shape (the two files share UI patterns).

- [ ] **Step 5: Migrate `OrganizationDetail.tsx`** — 13 calls. The platform-admin-only invitation-create still flows through this endpoint. The `supabase.storage.getPublicUrl` on line 1009 becomes the same `VITE_STORAGE_BASE_URL`-based pattern used in `OrgAnalytics.tsx`.

- [ ] **Step 6: Remove supabase import from each file**

- [ ] **Step 7: Commit**

```bash
git add functions/org-members/ src/components/org-admin/OrgMembersTab.tsx src/pages/org-admin/OrgUsers.tsx src/pages/platform-admin/OrganizationDetail.tsx
git commit -m "feat: org-members endpoint + migrate 37 member-admin call sites"
```

---

### Task 21.6: user-progress + enroll endpoints + dialog migrations

**Files:**
- Create: `functions/user-progress/index.ts`, `functions/user-progress/index.test.ts`
- Create: `functions/enroll/index.ts`, `functions/enroll/index.test.ts`
- Modify: `src/components/org-admin/UserProgressDialog.tsx`, `src/components/org-admin/EnrollUserDialog.tsx`, `src/components/org-admin/BulkInviteDialog.tsx`

**`user-progress` endpoint:** body `{ targetUserId, orgId }`. Returns the target user's enrollments + lesson_progress + quiz_attempts for the org. Auth: platform admin OR org_admin of `orgId`.

**`enroll` endpoint:** body `{ targetUserId?, courseId, orgId }`. If `targetUserId` omitted, enrolls the requesting user (learner self-enroll). If provided, admin enrollment — requires platform admin OR org_admin of `orgId`. Inserts into `enrollments` with `status = 'enrolled'`. Idempotent on `(user_id, course_id, org_id)`.

- [ ] **Step 1: TDD both endpoints** (same pattern)

- [ ] **Step 2: Migrate `UserProgressDialog.tsx`** — 5 calls → 1 `callApi('/api/user-progress', { targetUserId, orgId })`

- [ ] **Step 3: Migrate `EnrollUserDialog.tsx`** — 4 calls. The reads (which users + which courses are eligible) reuse `/api/org-members` and `/api/learner-data`; the enrollment insert (line 138) → `callApi('/api/enroll', { targetUserId, courseId, orgId })`.

- [ ] **Step 4: Migrate `BulkInviteDialog.tsx`** — 2 calls → `callApi('/api/org-members', { action: 'create-invitation', ... })` in a loop. Email sends remain via existing `sendInvitationEmail`.

- [ ] **Step 5: Commit**

```bash
git add functions/user-progress/ functions/enroll/ src/components/org-admin/UserProgressDialog.tsx src/components/org-admin/EnrollUserDialog.tsx src/components/org-admin/BulkInviteDialog.tsx
git commit -m "feat: user-progress + enroll endpoints, migrate 11 dialog call sites"
```

---

### Task 21.7: admin-courses endpoint + CoursesManager migration

**Files:**
- Create: `functions/admin-courses/index.ts`, `functions/admin-courses/index.test.ts`
- Modify: `src/pages/platform-admin/CoursesManager.tsx`

**Endpoint shape:** all actions require platform admin.
- `{ action: 'list' }` → returns courses + organizations + org_course_access in one payload (matches the current CoursesManager fetch)
- `{ action: 'create', course: { title, description, level, ... } }` → returns new row
- `{ action: 'toggle-published', courseId }` → flips `is_published`
- `{ action: 'delete', courseId }` → cascade-deletes course
- `{ action: 'set-org-access', courseId, orgIds: string[] }` → replaces `org_course_access` rows for the course

- [ ] **Step 1: TDD** (one test per action; cover 403 for non-platform-admin)
- [ ] **Step 2: Implement** — pattern as in Task 12. Use `is_platform_admin` gate at the top.
- [ ] **Step 3: Migrate `CoursesManager.tsx`** — 10 calls → 5 `callApi` calls (one per action).
- [ ] **Step 4: Remove supabase import**
- [ ] **Step 5: Commit**

```bash
git add functions/admin-courses/ src/pages/platform-admin/CoursesManager.tsx
git commit -m "feat: admin-courses endpoint + migrate CoursesManager (10 calls)"
```

---

### Task 21.8: admin-course-editor endpoints + CourseEditor/QuizEditor migrations

**Files:**
- Create: `functions/admin-course-editor/index.ts`, `functions/admin-course-editor/index.test.ts`
- Modify: `src/pages/platform-admin/CourseEditor.tsx`, `src/components/platform-admin/QuizEditorDialog.tsx`

**Endpoint shape:** single action-discriminated endpoint to keep the surface small. All actions require platform admin.

- `{ action: 'get-course', courseId }` → course + modules + lessons (admin view: includes unpublished fields)
- `{ action: 'update-course', courseId, updates }`
- `{ action: 'save-module', module: { id?, course_id, title, sort_order } }` → upsert
- `{ action: 'delete-module', moduleId }`
- `{ action: 'save-lesson', lesson: { id?, module_id, ... } }` → upsert
- `{ action: 'delete-lesson', lessonId }` — note: video deletion via existing `/api/azure-delete-blob` happens client-side first, then this endpoint handles the row delete
- `{ action: 'save-quiz', quiz: { id?, lesson_id, passing_score, questions: [...] } }` → full transactional upsert: quiz + questions + options (replace-all semantics)
- `{ action: 'delete-course', courseId }`

- [ ] **Step 1: TDD each action** — at least 8 happy-path tests + the 403 case + one transactional rollback test for `save-quiz`
- [ ] **Step 2: Implement** — use `pg` transactions (`BEGIN`/`COMMIT`/`ROLLBACK`) for `save-quiz`
- [ ] **Step 3: Migrate `CourseEditor.tsx`** — 12 calls → ~7 `callApi` calls
- [ ] **Step 4: Migrate `QuizEditorDialog.tsx`** — 9 remaining calls collapse into one `save-quiz` call + one `get-course` for the read path
- [ ] **Step 5: Remove supabase import from both files**
- [ ] **Step 6: Commit**

```bash
git add functions/admin-course-editor/ src/pages/platform-admin/CourseEditor.tsx src/components/platform-admin/QuizEditorDialog.tsx
git commit -m "feat: admin-course-editor endpoint + migrate CourseEditor + QuizEditorDialog (21 calls)"
```

---

### Task 21.9: admin-organizations endpoint + OrganizationsManager migration

**Files:**
- Create: `functions/admin-organizations/index.ts`, `functions/admin-organizations/index.test.ts`
- Modify: `src/pages/platform-admin/OrganizationsManager.tsx`

**Endpoint shape:** platform-admin only.
- `{ action: 'list' }` → all organizations
- `{ action: 'create', org: { name, slug, ... }, initialOwnerUserId? }` → inserts org + first `org_memberships` row (owner = `org_admin`)
- `{ action: 'update', orgId, updates }` → updates org metadata (incl. `logo_url`)

The `supabase.storage.getPublicUrl` on line 258 becomes the same `VITE_STORAGE_BASE_URL`-based pattern.

- [ ] **Steps 1–5:** TDD → implement → migrate → remove import → commit (~8 calls → 3 `callApi` calls)

```bash
git commit -m "feat: admin-organizations endpoint + migrate OrganizationsManager (8 calls)"
```

---

### Task 21.10: course-progress-analytics endpoint + analytics migrations

**Files:**
- Create: `functions/course-progress-analytics/index.ts`, `functions/course-progress-analytics/index.test.ts`
- Modify: `src/components/org-admin/analytics/CourseProgressTab.tsx`, `src/pages/org-admin/OrgAnalytics.tsx`

**Endpoint shape:**
- `{ action: 'org-courses-progress', orgId }` → per-course completion stats for the org
- `{ action: 'lesson-progress-breakdown', orgId, courseId }` → per-lesson completion stats

This unblocks the active-users-7/30 counters that `OrgAnalytics.tsx` currently has stubbed at 0. Add `recent-activity` action returning `{ activeUsers7Days, activeUsers30Days }` derived from `lesson_progress.completed_at`.

- [ ] **Steps 1–5** — same shape as Task 21.7. `OrgAnalytics.tsx`'s remaining 2 calls (`organizations` list + `org logo_url update`) become `callApi('/api/admin-organizations', { action: 'list' })` and `callApi('/api/admin-organizations', { action: 'update', ... })` respectively (reusing Task 21.9's endpoint).

```bash
git commit -m "feat: course-progress-analytics endpoint + finish OrgAnalytics migration"
```

---

### Task 21.11: moderation endpoint + community moderation pages

**Files:**
- Create: `functions/community-moderation/index.ts`, `functions/community-moderation/index.test.ts`
- Modify: `src/pages/platform-admin/PlatformCommunityModeration.tsx`, `src/pages/org-admin/OrgCommunityModeration.tsx`

**Endpoint shape:**
- `{ action: 'list-flagged', scope: 'platform' | 'org', orgId? }`
- `{ action: 'approve', postId }`
- `{ action: 'remove', postId, reason? }`
- `{ action: 'restore', postId }`

Auth: platform scope requires platform admin; org scope requires platform admin OR `org_admin` of `orgId`.

- [ ] **Steps 1–5** — TDD → implement → migrate both pages (4 calls each) → remove imports → commit

```bash
git commit -m "feat: community-moderation endpoint + migrate 8 moderation call sites"
```

**Note:** This task migrates only the *moderation* pages. The community *posting/voting* features in `ideas-api.ts` and `community-api.ts` are deferred to Task 21.12 (decision required).

---

### Task 21.12: Community/Ideas feature — decision and migration

**Status:** Decision required from product owner before implementation.

**The three live options:**

#### Option A: Full migration

Build endpoints for:
- `/api/ideas` (list, create, vote, comment, delete) — replaces 21 calls in `ideas-api.ts`
- `/api/community-posts` (list, create, react, comment, delete) — replaces 22 calls in `community-api.ts`
- `/api/champions` (list AI champions) — 1 call in `AIChampionsList.tsx`

Estimated 8–12 endpoint actions across 3 endpoints. Each requires the standard TDD cycle. The user-id-from-MSAL pattern below applies to every call site.

#### Option B: Feature-flag off

Wrap all routes that mount these pages behind `features.community_enabled` (already in `org_settings`). When the flag is off, the components do not mount and the supabase code never executes. Add a TODO and ship without removing the code.

The supabase imports still need to resolve for the build to succeed — `storage.ts` keeps the supabase client alive in the bundle until Task 21.15.

#### Option C: Delete the feature

`git rm src/lib/ideas-api.ts src/lib/community-api.ts src/components/community/ src/pages/*/OrgCommunityModeration.tsx src/pages/*/PlatformCommunityModeration.tsx` plus the route entries. Zero-cost cleanup. Recoverable from git history if reinstated later.

- [ ] **Step 1: Owner decision recorded in ADR** (`docs/adr/`) — `ADR-XXXX: Community/Ideas feature direction in Azure migration`

- [ ] **Step 2 (Option A only): Implement endpoints**

For each `supabase.auth.getUser()` call (4 in community-api, 4 in ideas-api), replace with the MSAL-derived user id at the call site:
```ts
// BEFORE:
const { data: user } = await supabase.auth.getUser();
const userId = user?.user?.id;
// AFTER:
import { msalInstance } from '@/lib/msal-config';
const userId = msalInstance.getActiveAccount()?.localAccountId; // Entra oid
```

For DB reads/writes, replace each `supabase.from(...)` chain with a `callApi` to the relevant new endpoint.

- [ ] **Step 2 (Option B only): Add feature-flag gates**

In `App.tsx` or the router, wrap community routes:
```tsx
{features.community_enabled && <Route path="/app/community" element={<CommunityPage />} />}
```

Verify `grep -r "community" src/App.tsx` shows only gated mounts.

- [ ] **Step 2 (Option C only): Delete the files and routes**

```bash
git rm src/lib/ideas-api.ts src/lib/community-api.ts
git rm -r src/components/community/
git rm src/pages/platform-admin/PlatformCommunityModeration.tsx
git rm src/pages/org-admin/OrgCommunityModeration.tsx
# remove route entries from App.tsx
```

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(community): <chosen option> — community/ideas migration"
```

---

### Task 21.13: Remaining loose ends — OrgSelector, AIChampionsList, resources-api

**Files:**
- Modify: `src/components/OrgSelector.tsx`, `src/components/community/AIChampionsList.tsx` (only if Task 21.12 chose Option A or B), `src/lib/resources-api.ts`

- [ ] **Step 1: OrgSelector.tsx (1 call)**

The single read fetches the user's available orgs. Already returned by `/api/user-context`. Replace:
```ts
// BEFORE:
const { data } = await supabase.from('organizations').select('*').in('id', orgIds);
// AFTER:
const { memberships } = await callApi<UserContext>('/api/user-context', {});
const orgs = memberships.map(m => m.organization);
```

- [ ] **Step 2: AIChampionsList.tsx**

If Task 21.12 chose Option C, skip (already deleted). Otherwise migrate the single read to `/api/champions` or fold into community endpoints.

- [ ] **Step 3: resources-api.ts (5 calls)**

Create `functions/resources/index.ts` with the standard pattern (list, create, update, delete). Same TDD cycle. Migrate the 5 call sites.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat: migrate OrgSelector + resources-api + AIChampions (7 calls)"
```

---

### Task 21.14: Verify supabase usage is fully drained (except storage.ts)

- [ ] **Step 1: Re-run the audit**

```bash
for f in $(grep -rl "integrations/supabase" src/ --include="*.ts" --include="*.tsx" | grep -v "^src/integrations/" | sort); do
  total=$(grep -c "\bsupabase\b" "$f")
  imports=$(grep -c "^import.*supabase" "$f")
  echo "$((total - imports))  $f"
done
```

Expected: only `src/lib/storage.ts` remains, with 1 call. Every other file should show 0 calls and the supabase import should have been removed.

- [ ] **Step 2: Build to verify no broken imports**

```bash
npm run build
```
Expected: build succeeds.

- [ ] **Step 3: Run the full test suite**

```bash
cd functions && npm test
npm test  # if any frontend tests exist
```

- [ ] **Step 4: Commit checkpoint (no code change, just CI sanity)**

If any of the above failed, fix in a new commit before continuing to Task 21.15.

---

### Task 21.15: Content migration prerequisite for storage.ts

**Context:** `src/lib/storage.ts` calls `supabase.storage.createSignedUrl` to serve thumbnails and legacy video/document content that is physically stored in Supabase Storage (`lms-assets` bucket). It cannot be removed until the content is moved to Azure Blob Storage. This task is the data migration, not a code change.

**Files:**
- Create: `scripts/migrate-lms-assets-to-azure.ts` (one-time script)
- Modify: `src/lib/storage.ts` (after migration completes)

- [ ] **Step 1: Inventory Supabase Storage contents**

```bash
# Run once to capture the current file list
npx supabase storage ls lms-assets -r > lms-assets-inventory.txt
```

- [ ] **Step 2: Write the migration script**

`scripts/migrate-lms-assets-to-azure.ts`:
- Stream each blob from Supabase Storage
- Upload to Azure Blob (`lms-assets` container, same key path)
- Verify byte length matches
- Write the new Azure URL into `courses.thumbnail_url` / `lessons.video_storage_path` / `lessons.document_storage_path` (replacing the Supabase path)

Pattern: use `@supabase/supabase-js` storage client + `@azure/storage-blob` SDK in a Node script (not in the Function App).

- [ ] **Step 3: Run the migration in a dry-run mode first**

```bash
node scripts/migrate-lms-assets-to-azure.ts --dry-run > migration.log
# Review migration.log: file count, total bytes, any errors
```

- [ ] **Step 4: Run the migration for real**

```bash
node scripts/migrate-lms-assets-to-azure.ts
```

- [ ] **Step 5: Update `storage.ts` to call `/api/azure-view-url`**

```ts
// BEFORE:
export async function getSignedUrl(bucket: string, path: string, expiresIn = 3600) {
  const { data } = await supabase.storage.from(bucket).createSignedUrl(path, expiresIn);
  return data?.signedUrl ?? null;
}
// AFTER:
export async function getSignedUrl(_bucket: string, path: string) {
  const { viewUrl } = await callApi<{ viewUrl: string }>('/api/azure-view-url', { blobPath: path });
  return viewUrl ?? null;
}
```

- [ ] **Step 6: Remove the supabase import from `storage.ts`**

- [ ] **Step 7: Commit**

```bash
git add scripts/migrate-lms-assets-to-azure.ts src/lib/storage.ts
git commit -m "feat: migrate lms-assets content to Azure Blob + remove supabase from storage.ts"
```

After this commit, `grep -r "integrations/supabase" src/ --include="*.ts" --include="*.tsx"` returns no matches. Task 22 (remove package) is now unblocked.

---

### Task 22: Remove @supabase/supabase-js from root package.json

Only after ALL frontend files no longer import from `@/integrations/supabase/` or `@supabase/supabase-js`.

- [ ] **Step 1: Verify no remaining supabase imports**

```bash
grep -r "@supabase/supabase-js\|integrations/supabase" src/ --include="*.ts" --include="*.tsx"
```
Expected: no output

- [ ] **Step 2: Remove package and delete integration files**

```bash
npm uninstall @supabase/supabase-js
rm -rf src/integrations/supabase/
```

- [ ] **Step 3: Build to verify no broken imports**

```bash
npm run build
```
Expected: build succeeds

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git rm -r src/integrations/supabase/
git commit -m "chore: remove @supabase/supabase-js and delete src/integrations/supabase/"
```

---

## Phase 6: Database Schema Migration

### Task 23: Migrate schema to Azure PostgreSQL

- [ ] **Step 1: Export Supabase schema**

```bash
# Run from a machine with access to Supabase project
pg_dump --schema-only --no-owner --no-acl \
  "postgresql://postgres:[password]@db.cairuxpyfshugwjrrqha.supabase.co:5432/postgres" \
  > supabase-schema-export.sql
```

- [ ] **Step 2: Remove Supabase-specific constructs**

Edit `supabase-schema-export.sql`:
- Remove all `auth.uid()` references (replace with `$1` parameter in app-layer queries)
- Remove all `auth.users` FK references (replace with `profiles.id` which is the same UUID)
- Remove all `CREATE POLICY ... USING (auth.uid() = ...)` lines (RLS replaced by app-layer auth)
- Remove `is_platform_admin()` and `current_org_ids_for_user()` functions — these are now inline in Azure Functions
- Keep `can_user_access_lms_asset` and `user_can_access_quiz` as helper functions (they reference `profiles` not `auth.uid()` in the final version)

- [ ] **Step 2b: Add Entra ID identity columns to profiles**

The `profiles` table needs two columns to support multi-tenant Entra ID. User identity is `(entra_oid, entra_tid)` — both are required for uniqueness across tenants.

Add to `supabase-schema-export.sql` immediately after the `CREATE TABLE profiles (...)` statement:

```sql
-- Entra ID identity columns (multi-tenant: oid is unique per tenant, not globally)
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS entra_oid TEXT,
  ADD COLUMN IF NOT EXISTS entra_tid TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_entra_identity
  ON profiles (entra_oid, entra_tid)
  WHERE entra_oid IS NOT NULL AND entra_tid IS NOT NULL;

-- First-login provisioning: profiles.id is now a server-generated UUID, not tied to auth.users.id
-- The user-context function does: SELECT by (entra_oid, entra_tid); INSERT if not found.
```

**Existing user migration** (run once after schema apply, before cutover):
```sql
-- Existing profiles from Supabase have no entra_oid — they must re-login via Entra
-- to link their Entra identity. If you want to pre-link by email:
-- UPDATE profiles SET entra_oid = '<known-oid>', entra_tid = '<known-tid>'
-- WHERE email = '<email>';
-- Otherwise: users log in via Microsoft SSO, user-context creates a new profile row.
-- Pre-existing org_memberships and progress data are associated with the old profile UUID.
-- Run a one-time script to merge old profile UUID → new Entra-linked profile UUID if required.
```

- [ ] **Step 3: Apply schema to Azure PostgreSQL**

```bash
# Run from a machine with VNet access to psql-ai-education-migration
PGPASSWORD=[password] psql \
  -h psql-ai-education-migration.postgres.database.azure.com \
  -U [admin_user] \
  -d [database_name] \
  -f supabase-schema-export.sql
```

- [ ] **Step 4: Migrate data**

```bash
pg_dump --data-only --no-owner \
  "postgresql://postgres:[password]@db.cairuxpyfshugwjrrqha.supabase.co:5432/postgres" \
  | PGPASSWORD=[password] psql \
      -h psql-ai-education-migration.postgres.database.azure.com \
      -U [admin_user] -d [database_name]
```

- [ ] **Step 5: Verify row counts match**

```sql
-- Run on both source and target, verify counts match:
SELECT table_name, n_live_tup FROM pg_stat_user_tables ORDER BY table_name;
```

- [ ] **Step 6: Commit schema export (no credentials)**

```bash
git add supabase-schema-export.sql
git commit -m "chore(db): add cleaned schema export for Azure PostgreSQL migration"
```

---

## Phase 7: Cleanup

### Task 24: Remove supabase/ directory and .lovable/ (already done in Task 2)

- [ ] **Step 1: Archive migrations before deletion**

```bash
cp -r supabase/migrations/ archived-migrations/
git add archived-migrations/
git commit -m "chore: archive Supabase migrations before removal"
```

- [ ] **Step 2: Remove supabase directory**

```bash
rm -rf supabase/
git add -A supabase/
git commit -m "chore: remove supabase/ directory (edge functions + migrations migrated)"
```

### Task 25: Update documentation

- [ ] **Step 1: Update README.md** — remove lovable.dev links, update setup instructions to reference Azure Functions + Azure PostgreSQL.
- [ ] **Step 2: Update AZURE_DEPLOYMENT_GUIDE.md** — remove `supabase/functions/` deploy commands, Supabase CLI setup, VITE_SUPABASE_* secrets. Add `functions/` deploy path.
- [ ] **Step 3: Update QUICK_START.md** — remove `supabase/migrations/*.sql` references.
- [ ] **Step 4: Commit**

```bash
git add README.md AZURE_DEPLOYMENT_GUIDE.md QUICK_START.md
git commit -m "docs: update all docs removing Supabase/Lovable references"
```

---

## Self-Review

### 1. Spec coverage

| Gap from review | Task covering it |
|-----------------|-----------------|
| `pg` in wrong package.json | Task 4 (functions/package.json) |
| `quiz_attempts.insert` client-side | Task 10 (grade-quiz server-side insert) |
| CoursePlayer 12 uncovered calls | Tasks 13, 14, 20, 21.4 (quiz fixtures) |
| UserDetailDialog privilege writes | Task 12 (admin-user-actions) |
| `get_quiz_options_for_learner` no replacement | Task 14 (quiz-options endpoint) |
| `useAuth.tsx` DB reads in fetchUserContext | Task 11 (user-context endpoint), Task 18 |
| OrgAnalytics DB reads | Task 15 (org-analytics-data endpoint), Task 21.10 (active-users + remaining 2 calls) |
| `profiles.is_platform_admin` direct write | Task 12 (admin-user-actions with server-side guard) |
| `supabase.storage.getPublicUrl` | Task 21 (OrgAnalytics) + Task 21.5 (OrganizationDetail) + Task 21.9 (OrganizationsManager) |
| test-smtp-connection no auth | Task 16 (auth gate added) |
| Platform/org settings reads + writes | Task 21.2 (platform-settings endpoint) |
| Learner Courses + Dashboard supabase reads | Task 21.3 (learner-data endpoint) |
| Org member admin (12+12+13 calls) | Task 21.5 (org-members endpoint) |
| User progress dialog + enroll + bulk-invite | Task 21.6 (user-progress + enroll endpoints) |
| Platform-admin course CRUD (10 calls) | Task 21.7 (admin-courses) |
| Course/module/lesson/quiz CRUD (21 calls) | Task 21.8 (admin-course-editor) |
| Organizations CRUD (8 calls) | Task 21.9 (admin-organizations) |
| Course-progress analytics + active users | Task 21.10 |
| Community moderation (8 calls) | Task 21.11 (community-moderation) |
| Community/Ideas posting features (44 calls) | Task 21.12 (decision required) |
| OrgSelector / resources-api / AIChampions | Task 21.13 |
| `storage.ts` Supabase content | Task 21.15 (content migration prerequisite) |

### 2. Placeholder scan

- Task 16 Step 3 says "follow the same pattern" for delete-user, send-invitation-email, generate-compliance-report — these require reading source from `supabase/functions/` to extract the DB query logic. Not a placeholder: the instruction is exact and the pattern is demonstrated in the same task. The functions' SQL and email template are available in the existing Supabase source.

### 3. Type consistency

- `AppUser` defined in Task 18 (`useAuth.tsx`) — fields: `{ id, tid, email, name }` (Entra claims)
- `callApi` / `callApiRaw` defined in Task 17 — acquire Entra access token via MSAL before each call
- `corsResponse` / `corsPreflightResponse` defined in Task 5 — used in all function tasks
- `authenticate` defined in Task 9 — `async`, returns `Promise<AuthUser>` — all callers from Task 10 onward must `await authenticate(req)`
- `query` / `queryOne` defined in Task 7 — used in all function tasks from Task 10 onward
- `AuthUser.id` = Entra `oid` claim. All function DB queries that previously used `user.id` as `profiles.id` now look up profile via `(entra_oid, entra_tid)` or use the internal `profiles.id` returned from that lookup. The `user-context` endpoint (Task 11) is the authoritative source of `profiles.id` for all per-user DB operations.
- Profile lookup pattern in functions that need `profiles.id`:
  ```ts
  const profile = await queryOne<{ id: string }>(
    'SELECT id FROM profiles WHERE entra_oid = $1 AND entra_tid = $2',
    [user.id, user.tid]
  );
  if (!profile) return corsResponse(origin, 401, { error: 'Profile not found — sign in again' });
  // use profile.id for all subsequent queries
  ```
  Functions that only need auth (not the internal profile UUID) can use `user.id` and `user.tid` directly.

### 4. VNet / infrastructure (confirmed via Azure MCP)

- **PostgreSQL** (`psql-ai-education-migration`): `publicNetworkAccess: Enabled`, firewall rule `AllowAllAzureServicesAndResourcesWithinAzureIps` allows function app connectivity without VNet integration.
- **Function App** (`func-ai-education-migration`): VNet integration = NOT configured. Not required given public postgres access. S1 Standard plan — VNet integration can be added later if postgres is locked down.
- **App Service Plan**: S1 Standard (`ASP-AIEducation-bfca`, `swedencentral`) — always-on, no cold starts.
- **Security note:** `AllowAllAzureServicesAndResourcesWithinAzureIps` permits any Azure resource in any subscription to attempt connection. After migration is stable, replace with function app's specific outbound IP allowlist.

### 5. Discovered gotchas (post-implementation, 2026-06-03)

These are issues found during Task 19–21 execution that the plan as originally written did not flag. Subsequent tasks (21.1–21.15) account for them.

- **Multi-line supabase chains are invisible to `grep "supabase\."`** The codebase uses `await supabase\n  .from(...)` extensively. The dot is on the next line, so naive grep undercounts call sites. Use this audit pattern instead:
  ```bash
  for f in $(grep -rl "integrations/supabase" src/ --include="*.ts" --include="*.tsx" | grep -v "^src/integrations/"); do
    total=$(grep -c "\bsupabase\b" "$f"); imports=$(grep -c "^import.*supabase" "$f"); echo "$((total - imports))  $f"
  done | sort -rn
  ```
  This bug caused the original Task 21 scope to be set at ~9 files when the reality was 27.

- **Top-level await is not available in Vite's default target.** Task 17's pattern `await msalInstance.initialize();` at module scope causes `vite build` to fail with: *"Top-level await is not available in the configured target environment (\"chrome87\", \"edge88\", \"es2020\", \"firefox78\", \"safari14\")"*. Wrap in `.then()` or bump `build.target` in `vite.config.ts`. The plan's `main.tsx` example must be:
  ```ts
  msalInstance.initialize().then(() => {
    createRoot(document.getElementById('root')!).render(
      <MsalProvider instance={msalInstance}>
        <App />
      </MsalProvider>
    );
  });
  ```

- **Plan's `profiles WHERE id = $1` pattern is wrong with Entra OID.** Several task code samples (notably Task 12, 13, 15, 16) use `'SELECT ... FROM profiles WHERE id = $1', [user.id]` where `user.id` is the Entra `oid`. This silently returns no rows because `profiles.id` is a UUID, not the OID. The correct pattern is documented in §3 above (lookup by `entra_oid`). Every endpoint implementation has been corrected; new endpoints (21.2–21.15) must follow §3.

- **`authenticate(req)` is async — always `await`.** The plan's Task 9 declares `authenticate` as `async`. Several task code samples (Task 12, 13, 14, etc.) wrote `const user = authenticate(req);` without `await`. This produces an unhandled Promise that the function rejects when the JSON parser tries to use `user.id`. All implementations have been corrected.

- **`vi.hoisted()` is mandatory for vitest mock variables.** Patterns like `const mockQuery = vi.fn(); vi.mock(...)` fail with "Cannot access before initialization" because `vi.mock` hoists above the const. Use:
  ```ts
  const { mockQuery, mockQueryOne } = vi.hoisted(() => ({ mockQuery: vi.fn(), mockQueryOne: vi.fn() }));
  vi.mock('../shared/db', () => ({ query: mockQuery, queryOne: mockQueryOne }));
  beforeEach(() => vi.clearAllMocks());
  ```
  Without `beforeEach(vi.clearAllMocks)`, mock call history leaks across tests and produces false positives.

- **`get_invitation_link_id` RPC takes `invitation_id`, not `org_id`.** Plan Task 21 Step 4 shows `supabase.rpc('get_invitation_link_id', { p_org_id: orgId })`. The actual codebase call is `{ invitation_id: invitation.id }`. The new `/api/invitation-link` endpoint takes `{ orgId }` and returns the org's *active* invitation link, which is the semantically correct replacement (links are org-wide). Migration is unaffected — just don't be misled by the wrong signature in the BEFORE block.

- **`@import url(...)` ordering warning in CSS.** Vite warns about Google Fonts `@import` appearing after the file header comment. Non-blocking, but worth fixing in a small follow-up by moving the `@import` to the top of `index.css`.

### 6. Task ordering hints

- Tasks 21.2 → 21.6 can be done in any order; none depend on each other.
- Task 21.7 should run after 21.6 (admin-course-editor uses the same auth pattern that 21.6's tests exercise).
- Task 21.4 (CoursePlayer quiz fixtures) requires Task 13's endpoint already exists — it extends, not creates.
- Task 21.10 reuses Task 21.9's admin-organizations endpoint — do 21.9 first.
- Task 21.12 is the single highest-leverage decision: deferring 21.12-A or choosing 21.12-B/C removes ~44 calls from the remaining scope.
- Task 21.14 is a CI checkpoint — run it twice: once after 21.13 (expect: only `storage.ts` remains), and once after 21.15 (expect: zero supabase usage anywhere in `src/`).
- Task 22 cannot start until 21.14 passes cleanly twice.
