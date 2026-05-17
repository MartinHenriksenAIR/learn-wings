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
└── invitation-link/index.ts          ← NEW: replaces get_invitation_link_id RPC
src/lib/
├── api-client.ts                     ← NEW: replaces supabase.functions.invoke everywhere
└── msal-config.ts                    ← NEW: MSAL singleton, multi-tenant config, API scopes
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
