# 05 — Replacement Architecture

## Confirmed Current Stack
- **Frontend**: Vite + React 18 + TypeScript, hosted on Azure Static Web App (`stapp-ai-education-migration`)
- **Auth**: Supabase Auth (JWT issuer: `cairuxpyfshugwjrrqha.supabase.co`)
- **Database**: Supabase PostgreSQL (project: `cairuxpyfshugwjrrqha.supabase.co`) with RLS
- **Server-side logic**: Supabase Deno Edge Functions (10 functions)
- **Blob storage**: Azure Storage Account `staieducationmigration` (container: `lms-videos`)
- **Email**: Resend API via `RESEND_API_KEY` (sender: `no-reply@ai-uddannelse.dk`)
- **CI/CD**: GitHub Actions → Azure Static Web Apps + Azure Function App

## Proposed Replacement Ownership

### Authentication (CRITICAL DECISION)
**Current**: Supabase Auth issues JWTs. All 10 functions verify via `supabase.auth.getUser()`.

**Recommended Replacement**: Azure AD B2C or a custom JWT service in the Azure Function App backed by PostgreSQL.

**Option A — Azure AD B2C**
- Issue JWTs signed with Azure AD public key
- Update all 10 functions to validate with `jwks-rsa` or Azure AD JWKS endpoint
- Frontend uses MSAL.js instead of supabase client for auth
- Pros: Managed identity, MFA, enterprise-grade
- Cons: More complex setup, Azure AD B2C pricing

**Option B — Custom JWT on Azure Functions + PostgreSQL**
- Store hashed passwords in Azure PostgreSQL `profiles` table
- Issue JWTs signed with a private key (stored in Key Vault)
- Implement `/api/auth/login`, `/api/auth/refresh`, `/api/auth/logout` endpoints
- Frontend uses fetch + localStorage instead of supabase client
- Pros: Full control, no external dependency
- Cons: More implementation work, security responsibility

**Decision gate**: See `10-open-questions.md`. This is a blocking human decision.

### Database
- **Target**: `psql-ai-education-migration` (Azure PostgreSQL Flexible Server)
- **Connection**: Private endpoint — Azure Function App connects via VNet integration
- **Schema migration**: Run Supabase SQL migrations against Azure PostgreSQL (mostly compatible; Supabase-specific extensions may need adjustment)
- **RLS replacement**: Supabase RLS policies → application-layer auth checks in Azure Functions
- **RPC migration**: `can_user_access_lms_asset` and `user_can_access_quiz` → PostgreSQL stored procedures on Azure PostgreSQL OR inline Node.js query logic

### Backend Functions — All in `func-ai-education-migration`

**Shared utilities** (new Node.js modules):
```
src/functions/
├── shared/
│   ├── auth.ts          # JWT validation, user extraction
│   ├── db.ts            # PostgreSQL connection pool (pg or @azure/identity + pg)
│   ├── sas.ts           # Azure Blob SAS generation (port from Deno Web Crypto to Node.js crypto)
│   └── cors.ts          # CORS header builder (production domain only)
├── grade-quiz/          # index.ts
├── generate-certificate/
├── delete-user/
├── send-invitation-email/
├── azure-upload-url/
├── azure-view-url/
├── azure-delete-blob/
├── generate-compliance-report/
├── azure-document-upload-url/
└── test-smtp-connection/
```

**CORS Policy — replacement functions**: Allow only:
- `https://ai-uddannelse.dk`
- `https://black-forest-0d7f96c03.7.azurestaticapps.net` (until custom domain active)

**No Lovable domains. No wildcard. Production domain only.**

### PDF Generation
- **Current**: Custom TypeScript PDF generation (no external library)
- **Replacement**: Port same TypeScript logic to Node.js. No new library needed.
- **Functions affected**: `generate-certificate`, `generate-compliance-report`
- **Binary response semantics preserved**: `application/pdf`, `Content-Disposition: attachment`

### Email / SMTP
- **Resend API** via `RESEND_API_KEY` (stored in Key Vault) — no change in provider
- **Invite domain allowlist**: Remove Lovable domains. Allow only `ai-uddannelse.dk`.
- **Email logo URL**: Move from `cairuxpyfshugwjrrqha.supabase.co/storage/...` to Azure Blob public container or SWA static path
- **SMTP connection test**: Replace `Deno.connect`/`Deno.connectTls` with Node.js `net.createConnection`/`tls.connect`. Add platform_admin auth gate.

### Azure Blob Storage
- **Account**: `staieducationmigration` (already in use — no change)
- **Container**: `lms-videos` (already in use — no change)
- **SAS generation**: Port HMAC-SHA256 Web Crypto API code to Node.js `crypto.createHmac('sha256', key).update(message).digest('base64')`
- **Secret handling**: `AZURE_STORAGE_ACCOUNT_KEY` → Key Vault reference in Function App settings, OR use Managed Identity with Azure RBAC (preferred)
- **Alternative**: Assign `func-ai-education-migration` Managed Identity with `Storage Blob Data Contributor` role on `staieducationmigration` → eliminates account key entirely

### Frontend Auth Client
- Remove `@supabase/supabase-js` from `package.json`
- Remove `src/integrations/supabase/client.ts` and `src/integrations/supabase/types.ts`
- Replace `supabase.functions.invoke(...)` with `fetch('/api/...')` calls using `Authorization: Bearer <jwt>` header
- Replace Supabase Auth session management with new auth provider SDK or custom auth hook
- Replace Supabase DB queries (used in frontend for non-privileged data) with direct API calls to Azure Functions

### Why No Client-Side Implementation for Privileged Operations
The following operations MUST remain server-side. Reasoning is not preference but security requirement:

| Operation | Why Server-Side Only |
|-----------|---------------------|
| grade-quiz | `quiz_options.is_correct` exposure in browser bundle = answer leak |
| generate-certificate | PDF generation requires DB access + potentially signing keys |
| delete-user | Auth admin API keys must never reach browser |
| send-invitation-email | `RESEND_API_KEY` must never reach browser |
| azure-upload-url | `AZURE_STORAGE_ACCOUNT_KEY` or managed identity must never reach browser; SAS grants write access |
| azure-view-url | Authorization check must precede SAS issuance; moving to browser allows SAS generation without auth |
| azure-delete-blob | Delete authority must be admin-gated; browser cannot validate admin status |
| generate-compliance-report | Service-role DB access + PII data aggregation |
| azure-document-upload-url | Same as azure-upload-url |
| test-smtp-connection | Raw TCP socket; browser cannot open TCP connections to arbitrary hosts |
