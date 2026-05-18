# 10 — Open Questions

Questions remaining after exhaustive repository and Azure verification. Each includes why it matters and the safest next step.

---

## Q1 — AUTH PROVIDER: What replaces Supabase Auth? ✅ RESOLVED

**Decision:** Multi-tenant Microsoft Entra ID (standard enterprise Entra ID, NOT Azure AD B2C).

**Why multi-tenant:** Future use cases require users from external organizations (other Azure subscriptions/tenants) to sign in. Multi-tenant Entra ID handles this natively — no per-tenant configuration required. Users from any Entra tenant can sign in to the app registration.

**Implementation:**
- Frontend: `@azure/msal-browser` + `@azure/msal-react`, `loginRedirect` flow, authority `https://login.microsoftonline.com/common`
- Backend: `jwks-rsa` + `jsonwebtoken`, RS256 validation, issuer validated by regex pattern (multi-tenant issuers vary by tenant)
- User identity: `oid` (object ID) + `tid` (tenant ID) — both required for global uniqueness
- Profile storage: `profiles` table gains `entra_oid` + `entra_tid` columns with unique constraint; `profiles.id` remains an internal UUID
- First-login: `user-context` endpoint provisions a profile row on first sign-in
- No custom password endpoints needed

**No password migration needed:** Existing Supabase users re-authenticate via Microsoft SSO. If they need their existing data (course progress, memberships) linked, a one-time email-based identity merge script can match old `profiles.email` to new Entra `preferred_username`.

---

## Q2 — DATABASE MIGRATION: How does the Supabase PostgreSQL schema migrate to Azure PostgreSQL? ⚠️ BLOCKER FOR TASK 23 ONLY

**Findings from repo analysis (42 migrations, PostgreSQL 15 target):**

| Item | Count | Disposition |
|------|-------|-------------|
| Total migration files | 42 | Export all via pg_dump |
| RLS / `auth.uid()` references | 190 lines | **Drop all** — replaced by app-layer auth in Azure Functions |
| `CREATE POLICY` statements | 30+ | **Drop all** |
| Custom SQL functions | 25 | See table below |
| `CREATE EXTENSION` statements | **0** | None declared; Supabase provides extensions by default |
| `gen_random_uuid()` usages | many | **Safe** — native in PostgreSQL 13+, no extension needed |
| `profiles.id REFERENCES auth.users(id)` | 1 | Change to plain `UUID PRIMARY KEY DEFAULT gen_random_uuid()` |
| `AFTER INSERT ON auth.users` trigger | 1 | **Drop** — replaced by user-context first-login provisioning |
| Storage policies (`auth.role()`) | 2 | **Drop** — Azure Blob uses SAS |

**Functions to drop** (all use `auth.uid()` internally):
- `handle_new_user()` + `on_auth_user_created` trigger
- `is_platform_admin()`, `is_org_admin()`, `is_org_member()`, `current_org_ids_for_user()`
- `can_access_lms_asset(file_path TEXT)` (old single-arg version using `auth.role()`)

**Functions to keep** (parameterized, no `auth.uid()`):
- `can_user_access_lms_asset(p_user_id, file_path)` — used in azure-view-url function
- `user_can_access_quiz(p_quiz_id)` — verify body doesn't call `auth.uid()` before keeping
- `get_quiz_options_for_learner`, `get_quiz_options_with_answers`, `get_invitation_link_id`, `get_invitation_by_token`, `accept_invitation`, `hash_invitation_token`, `get_org_invitations_safe`, `get_platform_invitations_safe`, `get_post_org_id`

**Not a blocker for Tasks 1–22.** Task 23 (schema apply) requires pg_dump + cleanup + apply to Azure. Estimated effort: 4–6 hours including testing.

**Still unknown:** row counts (data volume), PostgreSQL admin credentials, staging DB availability. These are needed for Task 23 execution, not planning.

---

## Q3 — KEY VAULT SECRETS: What secrets already exist in `ai-education-migration` Key Vault? ✅ RESOLVED

**Secrets confirmed in vault:**

| Secret name | Status | Migration relevance |
|-------------|--------|-------------------|
| `storage-account-key` | ✅ Enabled | Already exists — reference in functions as `@Microsoft.KeyVault(...)` |
| `postgresql-admin-password` | ✅ Enabled | Already exists — use to construct `DATABASE-URL` |
| `acr-password` | ✅ Enabled | Container Registry — not migration-relevant |

**Secrets that must be ADDED before function deployment:**

| Secret name | Value source |
|-------------|-------------|
| `database-url` | Construct: `postgresql://AIUadmin:<postgresql-admin-password>@psql-ai-education-migration.postgres.database.azure.com:5432/<db-name>?sslmode=require` |
| `resend-api-key` | Get from Resend dashboard |

**Note:** `ENTRA-CLIENT-ID` is not a secret — put it in the Function App application settings directly (not Key Vault), alongside `ENTRA_CLIENT_ID=<app-registration-client-id>`.

**Additional findings:**
- PostgreSQL admin user: `AIUadmin`
- Storage containers already in `staieducationmigration`: `lms-videos`, `lms-documents`, `azure-webjobs-hosts`, `azure-webjobs-secrets`
- `email-assets` container does NOT exist yet — must be created for Q10
- Function app outbound IPs (19 IPs) for postgres firewall hardening: `135.225.240.98`, `135.225.240.152`, `135.225.240.223`, `135.225.241.23`, `135.225.241.104`, `135.225.241.111`, `135.225.247.217`, `135.225.246.3`, `135.225.247.92`, `135.225.247.93`, `74.241.232.142`, `74.241.232.146`, `74.241.233.57`, `74.241.233.85`, `74.241.233.206`, `74.241.234.45`, `74.241.234.242`, `74.241.235.114`, `51.12.31.10`

---

## Q4 — STATIC WEB APP APP SETTINGS: Are any `VITE_SUPABASE_*` variables currently configured in Azure SWA? ✅ RESOLVED

**Finding:** `properties: {}` — no app settings configured at all in the SWA. The build uses `.env` file only.

**Impact:** Nothing to remove. When deploying the migration, add new settings here:
- `VITE_ENTRA_CLIENT_ID`
- `VITE_API_BASE_URL`
- `VITE_STORAGE_BASE_URL`
- `VITE_ENTRA_SCOPE`

These go in Azure Portal → stapp-ai-education-migration → Configuration, or via:
```bash
az staticwebapp appsettings set --name stapp-ai-education-migration --resource-group AI-Education \
  --setting-names VITE_ENTRA_CLIENT_ID=<value> VITE_API_BASE_URL=<value> VITE_STORAGE_BASE_URL=<value>
```

---

## Q5 — STORAGE CORS: Are Lovable domains in the Azure Storage Account CORS rules? ✅ RESOLVED

**Finding:** `[]` — no CORS rules configured on `staieducationmigration` blob service. No Lovable domains present.

**Impact:** Nothing to remove. SAS-based blob access (the pattern used by azure-upload-url/azure-view-url functions) does not require CORS rules on the storage account — the browser posts to the Azure Function, not directly to blob storage. If direct browser-to-blob uploads are ever needed (presigned PUT), CORS rules will need to be added at that point.

---

## Q6 — FUNCTION APP VNet INTEGRATION: Is `func-ai-education-migration` integrated with the VNet? ✅ RESOLVED

**Finding:** VNet integration is NOT configured (`az webapp vnet-integration list` returns `[]`). However, this is not a blocker.

**Why not a blocker:** Azure PostgreSQL Flexible Server `psql-ai-education-migration` has `publicNetworkAccess: Enabled` with firewall rule `AllowAllAzureServicesAndResourcesWithinAzureIps` (0.0.0.0/0.0.0.0). The function app connects to PostgreSQL over the Azure backbone without VNet integration.

**Security note:** The `AllowAllAzureServicesAndResourcesWithinAzureIps` rule permits any Azure resource in any subscription to attempt to connect. After the migration is stable, harden by replacing with the function app's specific outbound IP allowlist:
```bash
az postgres flexible-server firewall-rule create \
  --name func-outbound-1 --resource-group AI-Education \
  --server-name psql-ai-education-migration \
  --start-ip-address <outbound-ip> --end-ip-address <outbound-ip>
```
Then remove the `AllowAllAzureServicesAndResourcesWithinAzureIps` rule.

---

## Q7 — CUSTOM DOMAIN: Is `ai-uddannelse.dk` linked to the Static Web App in Azure? ⚠️ NOT LINKED

**Finding:** `customDomains: []` — domain not configured. App only reachable at `black-forest-0d7f96c03.7.azurestaticapps.net`.

**Impact:** Invitation links generated by `send-invitation-email` use `PLATFORM_BASE_URL = 'https://ai-uddannelse.dk'` — these links are currently broken in production. This is a pre-existing issue independent of the migration.

**Also impacts:** Entra ID app registration redirect URIs must include the custom domain (Task 8.5 Step 2). If domain is not linked when users try to log in, the MSAL redirect will fail because `ai-uddannelse.dk` won't resolve to the SWA.

**Action required before cutover:**
1. Azure Portal → stapp-ai-education-migration → Custom Domains → Add
2. Create DNS CNAME: `ai-uddannelse.dk` → `black-forest-0d7f96c03.7.azurestaticapps.net`
3. Azure verifies domain ownership (TXT record)
4. Confirm redirect URI `https://ai-uddannelse.dk` is in Entra app registration (Task 8.5 Step 2 already includes this)

---

## Q8 — SUPABASE AUTH USERS: How many users exist and what is the data migration approach? ⚠️ NEEDS COUNT

**Auth migration approach decided (no password migration needed):** With Entra ID, users re-authenticate via Microsoft SSO. No password export, no reset emails.

**The real problem:** Existing `profiles` rows have UUIDs from Supabase `auth.users`. After cutover, Entra users get new profile rows (provisioned by user-context endpoint). Their old data — course progress, org memberships, quiz attempts — is linked to old profile UUIDs and becomes orphaned.

**Mitigation plan:**
1. Before cutover: export `profiles` table with `(id, email)` pairs
2. After users first log in via Entra: run one-time merge script:
   ```sql
   -- Match old profile to new by email, reassign FK references
   UPDATE org_memberships SET user_id = new.id
   FROM profiles old, profiles new
   WHERE old.email = new.entra_oid_email  -- use email as bridge
     AND old.entra_oid IS NULL            -- old Supabase profile
     AND new.entra_oid IS NOT NULL;       -- new Entra profile
   -- Repeat for lesson_progress, quiz_attempts, course_reviews, etc.
   ```

**Still needed:** User count from Supabase Dashboard → Authentication → Users. If under ~50 users, merge can be done manually or skipped (users just re-enroll). If hundreds+, the automated merge script becomes essential.

**Not a blocker** for code tasks. Blocker only for production cutover timing decision.

---

## Q9 — SEED-MOCK-USERS FUNCTION: Is `seed-mock-users` a security risk? ⚠️ SECURITY RISK IF DEPLOYED

**Findings:**
- `CORS: '*'` — any origin can call it
- No auth gate whatsoever
- Uses `SUPABASE_SERVICE_ROLE_KEY` + `supabase.auth.admin.createUser`
- Hardcoded test user emails + passwords visible in source (`Test1234!`)
- **Not referenced in any CI/CD YAML or deployment config** — likely dev-only

**Risk:** If deployed to the production Supabase project (`cairuxpyfshugwjrrqha`), anyone who knows the function URL can create arbitrary users with known passwords in your production auth system.

**Action — do this now, not at migration time:**
1. Supabase Dashboard → Edge Functions → check if `seed-mock-users` is listed
2. If deployed: `supabase functions delete seed-mock-users --project-ref cairuxpyfshugwjrrqha`
3. Remove from `supabase/functions/` in the repo cleanup (Task 24)

**Not a migration blocker** — but should be verified and deleted before any production traffic.

---

## Q10 — EMAIL LOGO: Where does the `send-invitation-email` logo move to? ✅ DECISION MADE

**Finding:** `supabase/functions/send-invitation-email/index.ts` contains:
```
https://cairuxpyfshugwjrrqha.supabase.co/storage/v1/object/public/email-assets/logo-light.png
```
`public/logo-light.png` exists in the repo.

**Decision:** Upload to `staieducationmigration` blob storage in a new public container `email-assets`.

New URL: `https://staieducationmigration.blob.core.windows.net/email-assets/logo-light.png`

**Confirmed:** `email-assets` container does NOT yet exist in `staieducationmigration` (existing containers: `lms-videos`, `lms-documents`, `azure-webjobs-hosts`, `azure-webjobs-secrets`). Must be created.

**Steps (part of Task 16):**
```bash
# Create public container (blobs readable without auth — logo must be public for email clients)
az storage container create \
  --name email-assets \
  --account-name staieducationmigration \
  --public-access blob \
  --auth-mode login

# Upload logo
az storage blob upload \
  --account-name staieducationmigration \
  --container-name email-assets \
  --name logo-light.png \
  --file public/logo-light.png \
  --auth-mode login
```

Update the hardcoded URL in `functions/send-invitation-email/index.ts` to the new URL. This is a one-line change already tracked in Task 16.
