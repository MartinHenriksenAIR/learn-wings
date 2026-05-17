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

## Q2 — DATABASE MIGRATION: How does the Supabase PostgreSQL schema migrate to Azure PostgreSQL? ⚠️ CRITICAL BLOCKER

**Why it matters:** The Supabase PostgreSQL has 30+ migrations, Supabase-specific SQL functions (`auth.uid()`, Supabase storage hooks), and Row Level Security policies that use `auth.uid()`. Azure PostgreSQL Flexible Server does not have `auth.uid()`. All RLS policies must be translated to application-layer authorization. The `can_user_access_lms_asset` and `user_can_access_quiz` RPCs must be recreated.

**Sub-questions:**
- Are there Supabase-specific PostgreSQL extensions in use (e.g., `pgcrypto`, `uuid-ossp`, Supabase-specific functions)?
- How many rows are in each table (data migration volume)?
- Is there a staging Azure PostgreSQL available for schema testing?
- Which PostgreSQL user/role will application functions use on Azure?

**Safest next step:** Run `pg_dump --schema-only` from Supabase and review for Supabase-specific constructs. Test schema import against Azure PostgreSQL in a dev environment.

---

## Q3 — KEY VAULT SECRETS: What secrets already exist in `ai-education-migration` Key Vault?

**Why it matters:** If `AZURE_STORAGE_ACCOUNT_KEY`, `RESEND_API_KEY`, or other migration-relevant secrets are already stored in the Key Vault, the proposed-iac commands to add them would conflict. If they are absent, they must be added before deploying replacement functions.

**Limitation:** Key Vault is behind a private endpoint. Secret names were unreachable from the local machine (`Network unreachable` error).

**Safest next step:** Access Key Vault via Azure Portal from a machine on the VNet (or via Azure Bastion/VPN), or via:
```bash
az keyvault secret list --vault-name ai-education-migration
```
from within the VNet.

---

## Q4 — STATIC WEB APP APP SETTINGS: Are any `VITE_SUPABASE_*` variables currently configured in Azure SWA?

**Why it matters:** If Supabase env vars are configured in the Static Web App's Azure settings (in addition to the `.env` file), they will override the `.env` during CI/CD builds and must be explicitly removed from Azure.

**Limitation:** `az staticwebapp appsettings list` was not attempted (could not confirm credentials scope for this resource).

**Safest next step:**
```bash
az staticwebapp appsettings list --name stapp-ai-education-migration --resource-group AI-Education
```

---

## Q5 — STORAGE CORS: Are Lovable domains in the Azure Storage Account CORS rules?

**Why it matters:** If `learn-wings.lovable.app` or other Lovable domains are in the blob service CORS allowlist, they could allow Lovable to directly access blobs. These must be removed.

**Limitation:** Storage blob CORS API was unreachable from local machine.

**Safest next step:** From Azure Portal → `staieducationmigration` → Settings → Resource Sharing (CORS), inspect and update blob CORS rules. Or use the Azure CLI from within the VNet.

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

## Q7 — CUSTOM DOMAIN: Is `ai-uddannelse.dk` linked to the Static Web App in Azure?

**Why it matters:** `src/lib/config.ts` defines `PLATFORM_BASE_URL = 'https://ai-uddannelse.dk'` as the production domain. Invite links use this domain. If the domain is not linked in Azure, the links will not resolve.

**Finding:** `stapp-ai-education-migration` has `customDomains: []` — no custom domain is currently configured.

**Safest next step:** Add the custom domain in Azure Portal → stapp-ai-education-migration → Custom Domains, then update DNS CNAME to point to `black-forest-0d7f96c03.7.azurestaticapps.net`.

---

## Q8 — SUPABASE AUTH USERS: How many users exist in Supabase Auth and what migration approach?

**Why it matters:** Migrating users from Supabase Auth to a new provider requires either:
- Exporting user emails + hashed passwords (Supabase format may differ from new provider)
- Forcing password reset emails to all users
- OAuth token migration if OAuth providers are in use

**Safest next step:** Export user list from Supabase Dashboard → Authentication → Users. Count users and identify OAuth providers. Plan migration with minimal user disruption (e.g., send password reset emails to all users when new auth is live).

---

## Q9 — SEED-MOCK-USERS FUNCTION: Is `seed-mock-users` a blocker?

**Why it matters:** The 11th function (`supabase/functions/seed-mock-users/index.ts`) is not in the main 10 but uses `SUPABASE_SERVICE_ROLE_KEY` and `supabase.auth.admin.createUser`. It has no CORS restriction and no auth gate.

**Assessment:** This is a dev/test seeding tool, not a production function. It should be removed entirely (not migrated). However, if it is exposed on the Supabase hosted endpoint, it represents a security risk.

**Safest next step:** Verify this function is only deployed to development Supabase environments and not production. Remove it from `supabase/functions/` as part of the cleanup phase.

---

## Q10 — EMAIL LOGO: Where does the `send-invitation-email` logo move to?

**Why it matters:** The email HTML contains a hardcoded URL to `cairuxpyfshugwjrrqha.supabase.co/storage/v1/object/public/email-assets/logo-light.png`. After Supabase is removed, this URL will return 404 and the logo will break in invitation emails.

**Safest next step:** Upload `public/logo-light.png` (already in the repo) to either:
- Azure Blob Storage public container on `staieducationmigration`
- The Static Web App's static assets path (e.g., `https://black-forest-0d7f96c03.7.azurestaticapps.net/logo-light.png` or the custom domain equivalent)

Update the `send-invitation-email` replacement function to use the new URL.
