# Proposed Azure CLI Commands

**DRAFT ONLY — DO NOT RUN WITHOUT REVIEW**

These commands implement the Azure changes described in `07-proposed-azure-changes.md`.
Execute only after: auth/DB migration decisions made, replacement functions deployed and tested.

All commands assume:
- Resource group: `AI-Education`
- Subscription: `35cd9c6c-0c00-4efe-bd03-21549de140e4`
- Key Vault name: `ai-education-migration`

---

## Phase 1: Key Vault Secrets (after deciding values)

```bash
# DO NOT RUN — Add PostgreSQL connection string to KV
az keyvault secret set \
  --vault-name ai-education-migration \
  --name PostgresConnectionString \
  --value "postgresql://[USER]:[PASS]@psql-ai-education-migration.private.postgres.database.azure.com:5432/[DBNAME]?sslmode=require"

# DO NOT RUN — Add Resend API key to KV
az keyvault secret set \
  --vault-name ai-education-migration \
  --name ResendApiKey \
  --value "[RESEND_API_KEY_VALUE]"

# DO NOT RUN — Add storage account key (if not using Managed Identity)
az keyvault secret set \
  --vault-name ai-education-migration \
  --name StorageAccountKey \
  --value "[STORAGE_ACCOUNT_KEY_VALUE]"

# DO NOT RUN — Add JWT secret (if using custom auth)
az keyvault secret set \
  --vault-name ai-education-migration \
  --name JwtSecret \
  --value "[JWT_SIGNING_SECRET_VALUE]"
```

---

## Phase 2: Managed Identity for Function App (Recommended)

```bash
# DO NOT RUN — Enable system-assigned managed identity
az functionapp identity assign \
  --name func-ai-education-migration \
  --resource-group AI-Education

# DO NOT RUN — Get the principal ID of the managed identity
PRINCIPAL_ID=$(az functionapp identity show \
  --name func-ai-education-migration \
  --resource-group AI-Education \
  --query principalId -o tsv)

# DO NOT RUN — Grant Storage Blob Data Contributor on storage account
az role assignment create \
  --role "Storage Blob Data Contributor" \
  --assignee $PRINCIPAL_ID \
  --scope "/subscriptions/35cd9c6c-0c00-4efe-bd03-21549de140e4/resourceGroups/AI-Education/providers/Microsoft.Storage/storageAccounts/staieducationmigration"

# DO NOT RUN — Grant Key Vault Secrets User to function app
az keyvault set-policy \
  --name ai-education-migration \
  --object-id $PRINCIPAL_ID \
  --secret-permissions get list
```

---

## Phase 3: Function App Settings

```bash
# DO NOT RUN — Set app settings (non-secret values)
az functionapp config appsettings set \
  --name func-ai-education-migration \
  --resource-group AI-Education \
  --settings \
    "AZURE_STORAGE_ACCOUNT_NAME=staieducationmigration" \
    "AZURE_STORAGE_CONTAINER_NAME=lms-videos" \
    "ALLOWED_ORIGINS=https://ai-uddannelse.dk,https://black-forest-0d7f96c03.7.azurestaticapps.net"

# DO NOT RUN — Set Key Vault reference settings
az functionapp config appsettings set \
  --name func-ai-education-migration \
  --resource-group AI-Education \
  --settings \
    "DATABASE_URL=@Microsoft.KeyVault(VaultName=ai-education-migration;SecretName=PostgresConnectionString)" \
    "RESEND_API_KEY=@Microsoft.KeyVault(VaultName=ai-education-migration;SecretName=ResendApiKey)"

# DO NOT RUN — Set storage key if NOT using Managed Identity
az functionapp config appsettings set \
  --name func-ai-education-migration \
  --resource-group AI-Education \
  --settings \
    "AZURE_STORAGE_ACCOUNT_KEY=@Microsoft.KeyVault(VaultName=ai-education-migration;SecretName=StorageAccountKey)"
```

---

## Phase 4: CORS on Function App

```bash
# DO NOT RUN — Set CORS allowed origins (replace all)
az functionapp cors add \
  --name func-ai-education-migration \
  --resource-group AI-Education \
  --allowed-origins "https://ai-uddannelse.dk" "https://black-forest-0d7f96c03.7.azurestaticapps.net"

# DO NOT RUN — Remove any wildcard if present
az functionapp cors remove \
  --name func-ai-education-migration \
  --resource-group AI-Education \
  --allowed-origins "*"
```

---

## Phase 5: Static Web App Settings

```bash
# DO NOT RUN — Verify existing SWA app settings
az staticwebapp appsettings list \
  --name stapp-ai-education-migration \
  --resource-group AI-Education

# DO NOT RUN — Remove Supabase app settings (adjust names if different)
az staticwebapp appsettings delete \
  --name stapp-ai-education-migration \
  --resource-group AI-Education \
  --setting-names VITE_SUPABASE_URL VITE_SUPABASE_PUBLISHABLE_KEY VITE_SUPABASE_PROJECT_ID

# DO NOT RUN — Add new API base URL
az staticwebapp appsettings set \
  --name stapp-ai-education-migration \
  --resource-group AI-Education \
  --setting-name VITE_API_BASE_URL \
  --value "https://func-ai-education-migration-c0fgeqdnfvd6h0cf.swedencentral-01.azurewebsites.net"
```

---

## Phase 6: Storage CORS

```bash
# DO NOT RUN — Set blob service CORS (requires account key or managed identity)
az storage cors add \
  --account-name staieducationmigration \
  --services b \
  --methods GET PUT DELETE OPTIONS \
  --origins "https://ai-uddannelse.dk" "https://black-forest-0d7f96c03.7.azurestaticapps.net" \
  --allowed-headers "*" \
  --exposed-headers "*" \
  --max-age 3600

# DO NOT RUN — Clear existing CORS rules first
az storage cors clear \
  --account-name staieducationmigration \
  --services b
```

---

## Phase 7: Cleanup (Only After Full Verification)

```bash
# DO NOT RUN UNTIL MIGRATION VERIFIED IN PRODUCTION

# Remove any Supabase/Lovable secrets from Key Vault (if they exist)
# az keyvault secret delete --vault-name ai-education-migration --name [SupabaseSecretName]
```

---

## Verification Commands (Read-Only — Safe to Run)

```bash
# Verify function app settings were applied
az functionapp config appsettings list --name func-ai-education-migration --resource-group AI-Education --output table

# Verify managed identity
az functionapp identity show --name func-ai-education-migration --resource-group AI-Education

# Verify role assignments
az role assignment list --assignee [PRINCIPAL_ID] --resource-group AI-Education

# Verify static web app settings
az staticwebapp appsettings list --name stapp-ai-education-migration --resource-group AI-Education
```
