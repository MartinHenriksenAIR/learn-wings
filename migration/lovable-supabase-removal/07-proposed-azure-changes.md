# 07 — Proposed Azure Changes

**DRAFT ONLY. No Azure resources were modified. All changes require human review and execution.**

---

## Function App: func-ai-education-migration

### App Settings to REMOVE
None currently present that reference Supabase/Lovable.

### App Settings to ADD

| Setting | Value / Reference | Purpose |
|---------|-----------------|---------|
| `AZURE_STORAGE_ACCOUNT_NAME` | `staieducationmigration` | Blob SAS generation |
| `AZURE_STORAGE_ACCOUNT_KEY` | `@Microsoft.KeyVault(SecretUri=https://ai-education-migration.vault.azure.net/secrets/StorageAccountKey/)` | SAS signing key (Key Vault ref) |
| `AZURE_STORAGE_CONTAINER_NAME` | `lms-videos` | Default container |
| `RESEND_API_KEY` | `@Microsoft.KeyVault(SecretUri=https://ai-education-migration.vault.azure.net/secrets/ResendApiKey/)` | Email sending |
| `DATABASE_URL` | `@Microsoft.KeyVault(SecretUri=https://ai-education-migration.vault.azure.net/secrets/PostgresConnectionString/)` | Azure PostgreSQL connection |
| `JWT_SECRET` | `@Microsoft.KeyVault(SecretUri=https://ai-education-migration.vault.azure.net/secrets/JwtSecret/)` | JWT validation (if custom auth) |
| `ALLOWED_ORIGINS` | `https://ai-uddannelse.dk,https://black-forest-0d7f96c03.7.azurestaticapps.net` | CORS configuration |

**Note:** Key Vault reference names are proposals. Verify actual secret names after KV access is restored.

### CORS Origins to SET
```
https://ai-uddannelse.dk
https://black-forest-0d7f96c03.7.azurestaticapps.net
```
No Lovable domains. No wildcard.

### Managed Identity (Recommended Alternative to Storage Key)
Instead of `AZURE_STORAGE_ACCOUNT_KEY`, assign a Managed Identity to `func-ai-education-migration` and grant it `Storage Blob Data Contributor` on `staieducationmigration`. Update SAS generation to use `@azure/identity` with `DefaultAzureCredential` and Azure SDK `BlobSASSignatureValues`. This eliminates the account key secret entirely.

---

## Key Vault: ai-education-migration

### Secrets to ADD

| Secret Name (proposed) | Contains | Used By |
|------------------------|---------|--------|
| `PostgresConnectionString` | Azure PostgreSQL connection string with credentials | All DB-querying functions |
| `ResendApiKey` | Resend API key | send-invitation-email function |
| `StorageAccountKey` | Azure Storage Account key (or omit if using Managed Identity) | azure-* SAS functions |
| `JwtSecret` | JWT signing key (if using custom auth Option B) | Auth validation in all functions |

### Secrets to VERIFY (may already exist — KV not accessible from local)
- Any existing secret containing `SUPABASE` or `LOVABLE` in its name — must be removed once migration complete
- `AZURE_STORAGE_ACCOUNT_KEY` or similar — may already be stored

---

## Static Web App: stapp-ai-education-migration

### App Settings to REMOVE
- Any `VITE_SUPABASE_*` environment variables (verify via Azure Portal — CLI inspection was limited)

### App Settings to ADD / UPDATE
| Setting | Value |
|---------|-------|
| `VITE_API_BASE_URL` | `https://func-ai-education-migration-c0fgeqdnfvd6h0cf.swedencentral-01.azurewebsites.net` |

### Custom Domain
- Verify `ai-uddannelse.dk` is linked to `stapp-ai-education-migration`
- If not, add via Azure Portal: Static Web Apps → Custom Domains → Add
- Update DNS CNAME record to point `ai-uddannelse.dk` → `black-forest-0d7f96c03.7.azurestaticapps.net`

---

## Storage Account: staieducationmigration

### CORS Rules to SET (blob service)
Remove any existing Lovable domain entries. Set:
```json
[
  {
    "allowedOrigins": ["https://ai-uddannelse.dk", "https://black-forest-0d7f96c03.7.azurestaticapps.net"],
    "allowedMethods": ["GET", "PUT", "DELETE", "OPTIONS"],
    "allowedHeaders": ["*"],
    "exposedHeaders": ["*"],
    "maxAgeInSeconds": 3600
  }
]
```
**Note:** CORS on Blob Storage affects direct browser-to-blob operations. SAS URLs are used for blob access, so CORS may only matter for preflight.

### Access Control
- Confirm `func-ai-education-migration` Managed Identity has `Storage Blob Data Contributor` role on this account (if using Managed Identity approach)

---

## PostgreSQL Flexible Server: psql-ai-education-migration

### Schema Migration Required
1. Run all 30+ migration SQL files from `supabase/migrations/` against Azure PostgreSQL
2. Handle Supabase-specific extensions/syntax differences:
   - `auth.uid()` function → not available; replace with application-passed user ID
   - `auth.users` table → create equivalent `users` table or use profiles
   - Supabase RLS syntax may need adjustment
3. Recreate RPCs:
   - `can_user_access_lms_asset(p_user_id, file_path)` → PostgreSQL function
   - `user_can_access_quiz(p_quiz_id)` → PostgreSQL function (but needs user context; may become app-layer query)
   - `get_quiz_options_for_learner` → PostgreSQL function (returns options without is_correct)
   - `get_quiz_options_with_answers` → PostgreSQL function (returns options with is_correct, admin only)
4. Data migration: export from Supabase → import to Azure PostgreSQL

### Network Access
- `func-ai-education-migration` must be VNet-integrated to reach the private PostgreSQL endpoint
- Verify VNet integration is configured on the Function App (check if already done)

---

## Monitoring / Logging

### Application Insights — func-ai-education-migration
Already connected (`APPLICATIONINSIGHTS_CONNECTION_STRING` is set). No changes needed.

### Supabase-specific logs
After migration, Supabase function logs will no longer be relevant. Remove any log alerts or monitoring configured against Supabase endpoints.

---

## Domain / Callback / Redirect

### Supabase Auth Redirects
If Supabase Auth is used for OAuth or magic link flows, there may be redirect URLs configured in the Supabase dashboard pointing to `learn-wings.lovable.app` or `ai-uddannelse.dk`. These are in the Supabase project settings (not accessible via CLI). After auth migration:
- Remove all redirect URLs from Supabase project
- Decommission the Supabase project

---

## Actions NOT to Take (Destructive — Human Decision Required)
- Do NOT delete the Supabase project until migration is complete and verified in production
- Do NOT delete `staieducationmigration` container contents
- Do NOT revoke Supabase service role key until all functions migrated and verified
- Do NOT delete Azure PostgreSQL server during migration testing
