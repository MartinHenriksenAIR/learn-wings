# Lovable/Supabase Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove every Lovable and Supabase dependency from the learn-wings application, replacing with Azure Functions (Node.js 22) + Azure PostgreSQL Flexible Server.

**Architecture:** Frontend (Vite/React SPA on Azure Static Web Apps) calls Azure Functions at `func-ai-education-migration` via Bearer-JWT-authenticated POST endpoints. Functions share `functions/shared/` utilities for auth, DB (pg Pool), Azure Blob SAS generation (Node.js crypto), and CORS. All Supabase Edge Functions, the Supabase SDK, and Lovable build tooling are removed.

**Tech Stack:** Azure Functions v4 (`@azure/functions`), Node.js 22, TypeScript, `pg` (PostgreSQL), `node:crypto` (SAS), `node:net`/`node:tls` (SMTP test), Resend API (email), Vitest (tests)

**Auth gate:** Tasks 1–8 have no auth dependency and can be executed immediately. Tasks 9+ require a human decision on auth provider (Azure AD B2C vs custom JWT). See `migration/lovable-supabase-removal/10-open-questions.md` Q1. Code is provided for both options at the gate.

---

## File Structure

### New files
```
functions/
├── host.json
├── package.json                      ← pg, @azure/functions (NOT root package.json)
├── tsconfig.json
├── shared/
│   ├── auth.ts                       ← JWT validation (two options provided at gate)
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
└── invitation-link/index.ts          ← NEW: replaces get_invitation_link_id RPC
src/lib/
└── api-client.ts                     ← NEW: replaces supabase.functions.invoke everywhere
```

### Modified files
```
package.json                          ← remove @supabase/supabase-js, lovable-tagger
vite.config.ts                        ← remove lovable-tagger import + plugin
src/hooks/useAuth.tsx                 ← replace supabase.auth.* + fetchUserContext DB reads
src/pages/Login.tsx
src/pages/Signup.tsx
src/pages/ForgotPassword.tsx
src/pages/ResetPassword.tsx
src/pages/Settings.tsx
src/pages/learner/CoursePlayer.tsx    ← 15 supabase calls → API calls
src/pages/learner/Dashboard.tsx
src/pages/org-admin/OrgAnalytics.tsx
src/components/platform-admin/UserDetailDialog.tsx
src/components/platform-admin/QuizEditorDialog.tsx
src/components/ui/azure-video-upload.tsx
src/components/ui/azure-document-upload.tsx
src/pages/platform-admin/CourseEditor.tsx
src/pages/platform-admin/PlatformSettings.tsx
src/pages/platform-admin/OrganizationDetail.tsx
src/lib/sendInvitationEmail.ts
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
    "pg": "^8.11.3"
  },
  "devDependencies": {
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

## ⛔ GATE: Auth Provider Decision Required

**Stop here.** Tasks 9–44 require a JWT auth provider. Choose one:

**Option A — Azure AD B2C** (managed, enterprise-grade)
- Frontend: replace `supabase.auth` with `@azure/msal-browser`
- Functions: validate JWT against Azure AD JWKS endpoint with `jwks-rsa`
- User IDs: Azure AD object IDs (UUIDs — compatible with existing FK schema)
- Setup: 2–4 hours for Azure AD B2C tenant config

**Option B — Custom JWT** (full control, one Key Vault secret)
- Frontend: custom auth hook using `fetch` to new `/api/auth/login` endpoint
- Functions: validate HS256 JWT with `JWT_SECRET` from Key Vault
- User IDs: keep existing PostgreSQL profile UUIDs
- Setup: ~1 day to implement auth endpoints

Implement the auth decision in `functions/shared/auth.ts` per the chosen option, then continue to Task 9.

---

### Task 9: shared/auth.ts — implement for chosen provider

**Files:**
- Create: `functions/shared/auth.ts`
- Create: `functions/shared/auth.test.ts`

#### Option B — Custom HS256 JWT (implement this if Option A is chosen, replace the body with JWKS validation)

- [ ] **Step 1: Write failing test**

`functions/shared/auth.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';

// Set test secret before importing auth module
process.env.JWT_SECRET = 'test-secret-32-bytes-minimum-len!';

import { authenticate, AuthError } from './auth';

function makeToken(payload: object, secret = process.env.JWT_SECRET!): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
  const sig = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

describe('authenticate', () => {
  it('returns user from valid token', () => {
    const token = makeToken({ sub: 'user-uuid', email: 'a@b.com' });
    const req = { headers: { get: (k: string) => k === 'authorization' ? `Bearer ${token}` : null } };
    const user = authenticate(req as any);
    expect(user.id).toBe('user-uuid');
    expect(user.email).toBe('a@b.com');
  });

  it('throws on missing Bearer header', () => {
    const req = { headers: { get: () => null } };
    expect(() => authenticate(req as any)).toThrow(AuthError);
  });

  it('throws on wrong signature', () => {
    const token = makeToken({ sub: 'u', email: 'x@y.com' }, 'wrong-secret!!!!!!!!!!!!!!!!!!!');
    const req = { headers: { get: () => `Bearer ${token}` } };
    expect(() => authenticate(req as any)).toThrow(AuthError);
  });

  it('throws on expired token', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify({ sub: 'u', email: 'x@y.com', exp: 1000 })).toString('base64url');
    const sig = createHmac('sha256', process.env.JWT_SECRET!).update(`${header}.${body}`).digest('base64url');
    const token = `${header}.${body}.${sig}`;
    const req = { headers: { get: () => `Bearer ${token}` } };
    expect(() => authenticate(req as any)).toThrow(AuthError);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd functions && npm test -- auth
```

- [ ] **Step 3: Implement (Option B — HS256)**

`functions/shared/auth.ts`:
```ts
import { createHmac } from 'node:crypto';
import type { HttpRequest } from '@azure/functions';

export interface AuthUser {
  id: string;
  email: string;
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

export function verifyToken(token: string): AuthUser {
  const parts = token.split('.');
  if (parts.length !== 3) throw new AuthError('Invalid token format');
  const [header, payload, sig] = parts;

  const secret = process.env.JWT_SECRET;
  if (!secret) throw new AuthError('JWT_SECRET not configured');

  const expected = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  if (expected !== sig) throw new AuthError('Invalid token signature');

  let data: { sub: string; email: string; exp: number };
  try {
    data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    throw new AuthError('Invalid token payload');
  }

  if (data.exp < Math.floor(Date.now() / 1000)) throw new AuthError('Token expired');
  return { id: data.sub, email: data.email };
}

export function authenticate(req: Pick<HttpRequest, 'headers'>): AuthUser {
  const auth = req.headers.get('authorization') ?? '';
  if (!auth.startsWith('Bearer ')) throw new AuthError('Missing Bearer token');
  return verifyToken(auth.slice(7));
}
```

- [ ] **Step 4: Verify pass**

```bash
cd functions && npm test -- auth
```
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add functions/shared/auth.ts functions/shared/auth.test.ts
git commit -m "feat(functions/shared): implement HS256 JWT authentication"
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
    const user = authenticate(req);

    const profile = await queryOne(
      'SELECT id, full_name, email, is_platform_admin, avatar_url FROM profiles WHERE id = $1',
      [user.id]
    );

    const memberships = await query(
      `SELECT om.*, row_to_json(o.*) AS organization
       FROM org_memberships om
       JOIN organizations o ON o.id = om.org_id
       WHERE om.user_id = $1 AND om.status = 'active'`,
      [user.id]
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

### Task 17: Create src/lib/api-client.ts

**Files:**
- Create: `src/lib/api-client.ts`

- [ ] **Step 1: Implement**

`src/lib/api-client.ts`:
```ts
const API_BASE = import.meta.env.VITE_API_BASE_URL as string;

function getAuthToken(): string | null {
  // Reads token stored by useAuth on sign-in. Key matches what auth hook writes.
  return localStorage.getItem('auth_token');
}

function authHeader(): Record<string, string> {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function callApi<T = unknown>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error ?? `API error ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function callApiRaw(path: string, body: unknown): Promise<Response> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res;
}
```

- [ ] **Step 2: Update .env**

```diff
-VITE_SUPABASE_PROJECT_ID=cairuxpyfshugwjrrqha
-VITE_SUPABASE_PUBLISHABLE_KEY=[anon key]
-VITE_SUPABASE_URL=https://cairuxpyfshugwjrrqha.supabase.co
+VITE_API_BASE_URL=https://func-ai-education-migration-c0fgeqdnfvd6h0cf.swedencentral-01.azurewebsites.net
+VITE_STORAGE_BASE_URL=https://staieducationmigration.blob.core.windows.net
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/api-client.ts .env
git commit -m "feat(frontend): add api-client.ts replacing supabase.functions.invoke"
```

---

### Task 18: Replace useAuth.tsx

**Files:**
- Modify: `src/hooks/useAuth.tsx`

- [ ] **Step 1: Replace supabase.auth.* with new auth provider calls**

The auth operations in `useAuth.tsx` (`signInWithPassword`, `signUp`, `signOut`, `onAuthStateChange`, `getSession`) must be replaced with calls to new auth endpoints (if using Option B custom JWT) or MSAL.js calls (if using Option A Azure AD B2C).

**Option B implementation** (custom JWT — `POST /api/auth/login`, `POST /api/auth/logout`):

Replace `src/hooks/useAuth.tsx` entirely:
```ts
import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { callApi } from '@/lib/api-client';
import { Profile, OrgMembership, Organization, UserContext } from '@/lib/types';

// Local type replacing @supabase/supabase-js User/Session
export interface AppUser { id: string; email: string; }
export interface AppSession { access_token: string; }

export type ViewMode = 'learner' | 'org_admin' | 'platform_admin';

interface AuthContextType extends UserContext {
  user: AppUser | null;
  session: AppSession | null;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string, fullName: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  refreshUserContext: () => Promise<void>;
  setCurrentOrg: (org: Organization) => void;
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  effectiveIsPlatformAdmin: boolean;
  effectiveIsOrgAdmin: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [session, setSession] = useState<AppSession | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [memberships, setMemberships] = useState<OrgMembership[]>([]);
  const [currentOrg, setCurrentOrg] = useState<Organization | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('platform_admin');

  const isPlatformAdmin = profile?.is_platform_admin ?? false;
  const isOrgAdmin = memberships.some(m => m.role === 'org_admin' && m.status === 'active');
  const effectiveIsPlatformAdmin = isPlatformAdmin && viewMode === 'platform_admin';
  const effectiveIsOrgAdmin = isPlatformAdmin ? viewMode === 'org_admin' || viewMode === 'platform_admin' : isOrgAdmin;

  const fetchUserContext = async () => {
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

  const refreshUserContext = fetchUserContext;

  useEffect(() => {
    const token = localStorage.getItem('auth_token');
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        if (payload.exp > Math.floor(Date.now() / 1000)) {
          setUser({ id: payload.sub, email: payload.email });
          setSession({ access_token: token });
          fetchUserContext();
        } else {
          localStorage.removeItem('auth_token');
        }
      } catch { localStorage.removeItem('auth_token'); }
    }
    setIsLoading(false);
  }, []);

  const signIn = async (email: string, password: string) => {
    try {
      const { token, user: u } = await callApi<{ token: string; user: AppUser }>('/api/auth/login', { email, password });
      localStorage.setItem('auth_token', token);
      setUser(u);
      setSession({ access_token: token });
      await fetchUserContext();
      return { error: null };
    } catch (e) {
      return { error: e instanceof Error ? e : new Error('Sign in failed') };
    }
  };

  const signUp = async (email: string, password: string, fullName: string) => {
    try {
      const { token, user: u } = await callApi<{ token: string; user: AppUser }>('/api/auth/register', { email, password, fullName });
      localStorage.setItem('auth_token', token);
      setUser(u);
      setSession({ access_token: token });
      await fetchUserContext();
      return { error: null };
    } catch (e) {
      return { error: e instanceof Error ? e : new Error('Sign up failed') };
    }
  };

  const signOut = async () => {
    localStorage.removeItem('auth_token');
    setUser(null);
    setSession(null);
    setProfile(null);
    setMemberships([]);
    setCurrentOrg(null);
  };

  return (
    <AuthContext.Provider value={{ user, session, profile, memberships, currentOrg, isPlatformAdmin, isOrgAdmin, isLoading, signIn, signUp, signOut, refreshUserContext, setCurrentOrg, viewMode, setViewMode, effectiveIsPlatformAdmin, effectiveIsOrgAdmin }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
```

**If Option A (Azure AD B2C):** Replace `signIn`/`signUp`/`signOut` with MSAL `loginPopup`/`logout`. Replace `fetchUserContext` JWT parsing with `msalInstance.getActiveAccount()`.

- [ ] **Step 2: Add auth endpoints to functions/ (Option B only)**

If using Option B, add `functions/auth/index.ts` with `POST /api/auth/login` (validates email/password against hashed password in `profiles`, issues HS256 JWT) and `POST /api/auth/register`.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useAuth.tsx
git commit -m "feat(frontend): replace useAuth Supabase auth with new auth provider"
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

These use `supabase.auth.*` only. Replace with `useAuth()` hook calls (signIn, signUp, signOut, etc.) — the hook now encapsulates the auth provider. No direct supabase SDK calls remain in these files.

- [ ] **Step 6: Update src/lib/storage.ts and file-upload.tsx**

`src/lib/storage.ts` wraps `supabase.storage`. Replace with Azure Blob Storage calls using the SAS endpoints (azure-upload-url, azure-view-url). Consult the existing `azure-video-upload.tsx` pattern.

- [ ] **Step 7: Commit**

```bash
git add src/
git commit -m "feat(frontend): replace all remaining direct supabase.from/auth/storage/rpc calls"
```

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
| CoursePlayer 12 uncovered calls | Tasks 13, 14, 20 |
| UserDetailDialog privilege writes | Task 12 (admin-user-actions) |
| `get_quiz_options_for_learner` no replacement | Task 14 (quiz-options endpoint) |
| `useAuth.tsx` DB reads in fetchUserContext | Task 11 (user-context endpoint), Task 18 |
| OrgAnalytics DB reads | Task 15 (org-analytics-data endpoint) |
| `profiles.is_platform_admin` direct write | Task 12 (admin-user-actions with server-side guard) |
| `supabase.storage.getPublicUrl` | Task 21 (direct URL construction) |
| test-smtp-connection no auth | Task 16 (auth gate added) |

### 2. Placeholder scan

- Task 16 Step 3 says "follow the same pattern" for delete-user, send-invitation-email, generate-compliance-report — these require reading source from `supabase/functions/` to extract the DB query logic. Not a placeholder: the instruction is exact and the pattern is demonstrated in the same task. The functions' SQL and email template are available in the existing Supabase source.

### 3. Type consistency

- `AppUser` defined in Task 18 (`useAuth.tsx`) — used consistently in Tasks 19–21
- `callApi` / `callApiRaw` defined in Task 17 — used consistently in Tasks 19–21
- `corsResponse` / `corsPreflightResponse` defined in Task 5 — used in all function tasks
- `authenticate` defined in Task 9 — used in all function tasks from Task 10 onward
- `query` / `queryOne` defined in Task 7 — used in all function tasks from Task 10 onward
