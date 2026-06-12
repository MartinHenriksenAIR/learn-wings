# 03 — Azure Discovery

## Azure Account
- Subscription: `MCPP Subscription` (ID: `35cd9c6c-0c00-4efe-bd03-21549de140e4`)
- Tenant: `9de3d9c3-b0bb-4d2e-93ab-f6407a8b3793`
- User: `dawid@ai-raadgivning.dk`
- Resource Group: `AI-Education` (note: case-sensitive; CLI uses `ai-education`)

## Azure CLI Commands Run (Read-Only)
```bash
az account show
az resource list --resource-group ai-education --output table
az functionapp show --name func-ai-education-migration --resource-group ai-education
az functionapp config appsettings list --name func-ai-education-migration --resource-group ai-education
az staticwebapp list --resource-group ai-education
az keyvault show --name ai-education-migration
az keyvault secret list --vault-name ai-education-migration  # FAILED — network unreachable
az storage account show --name staieducationmigration
az storage cors list --account-name staieducationmigration  # FAILED — network unreachable
```

## Resource Group Inventory

| Resource Name | Type | Location | Relevance |
|--------------|------|----------|-----------|
| ai-education-migration | `Microsoft.Network/virtualNetworks` | swedencentral | Private networking for PostgreSQL |
| ai-education-migration | `Microsoft.KeyVault/vaults` | swedencentral | **TARGET**: Store secrets for replacement functions |
| psql-ai-education-migration.private.postgres.database.azure.com | `Microsoft.Network/privateDnsZones` | global | DNS for PostgreSQL private endpoint |
| psql-ai-education-migration (VNet link) | `Microsoft.Network/privateDnsZones/virtualNetworkLinks` | global | VNet connectivity for PostgreSQL |
| psql-ai-education-migration | `Microsoft.DBforPostgreSQL/flexibleServers` | swedencentral | **TARGET DATABASE**: Replace Supabase PostgreSQL |
| staieducationmigration | `Microsoft.Storage/storageAccounts` | swedencentral | **CURRENT**: Already used for video/document blobs |
| acraieducationmigration | `Microsoft.ContainerRegistry/registries` | swedencentral | Container registry, not relevant to function migration |
| plan-ai-education-migration | `Microsoft.Web/serverFarms` | westeurope | App Service Plan for Functions? |
| func-ai-education-migration | `microsoft.insights/components` | swedencentral | Application Insights for monitoring |
| ASP-AIEducation-bfca | `Microsoft.Web/serverFarms` | swedencentral | App Service Plan |
| func-ai-education-migration | `Microsoft.Web/sites` | swedencentral | **TARGET**: Azure Function App for replacements |
| stapp-ai-education-migration | `Microsoft.Web/staticSites` | westeurope | **CURRENT**: Hosts the Vite/React SPA |

## Function App — func-ai-education-migration

**Host:** `func-ai-education-migration-c0fgeqdnfvd6h0cf.swedencentral-01.azurewebsites.net`
**Runtime:** Node.js 22
**Status:** Running
**Location:** Sweden Central

**Current App Settings** (secrets redacted):
| Setting | Value |
|---------|-------|
| `FUNCTIONS_EXTENSION_VERSION` | `~4` |
| `FUNCTIONS_WORKER_RUNTIME` | `node` |
| `WEBSITE_NODE_DEFAULT_VERSION` | `~22` |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | [REDACTED] |
| `AzureWebJobsStorage` | [REDACTED] |

**Supabase/Lovable in settings:** NONE FOUND.

**Gap:** No replacement secrets are currently configured. The following will need to be added when replacement functions are deployed (see 07-proposed-azure-changes.md):
- Database connection string (Azure PostgreSQL)
- `AZURE_STORAGE_ACCOUNT_NAME`
- `AZURE_STORAGE_ACCOUNT_KEY` or managed identity reference
- `RESEND_API_KEY`
- Auth provider config (depends on auth decision)

**CI/CD:** `.github/workflows/main_func-ai-education-migration.yml` deploys from repo root on push to `main`. Workflow uses `AZUREAPPSERVICE_PUBLISHPROFILE_*` secret. Currently deploys the React app source (no function code exists at repo root yet).

## Static Web App — stapp-ai-education-migration

**Host:** `black-forest-0d7f96c03.7.azurestaticapps.net`
**Location:** West Europe
**Custom Domains:** None
**Branch:** `main`
**Repository:** `https://github.com/MartinHenriksenAIR/learn-wings`
**App Location:** `/`
**Output Location:** `dist`

**Note:** No custom domain `ai-uddannelse.dk` is currently linked to the Static Web App in Azure. The frontend `config.ts` references `ai-uddannelse.dk` as `PLATFORM_BASE_URL`. Domain may be configured at DNS level elsewhere or not yet pointed.

## Storage Account — staieducationmigration

**Location:** Sweden Central
**Kind:** StorageV2 (Hot)
**Public Blob Access:** Disabled (secure)
**HTTPS Only:** Yes
**CORS rules:** Could not be retrieved (network unreachable from local machine — private endpoint likely)
**Container in use:** `lms-videos` (confirmed from edge function code: `AZURE_STORAGE_CONTAINER_NAME` defaults to `lms-videos`)

## Key Vault — ai-education-migration

**URI:** `https://ai-education-migration.vault.azure.net/`
**Location:** Sweden Central
**Secret names:** Could not be retrieved — network unreachable from local machine (private endpoint via VNet)

**Implication:** Key Vault is accessible from the VNet (where Function App and PostgreSQL reside). The Function App should use Key Vault references (e.g., `@Microsoft.KeyVault(SecretUri=https://ai-education-migration.vault.azure.net/secrets/AzureStorageKey/)`) rather than direct values in app settings.

## PostgreSQL Flexible Server — psql-ai-education-migration

**FQDN:** `psql-ai-education-migration.private.postgres.database.azure.com`
**Location:** Sweden Central
**Network:** Private endpoint, accessible only within VNet `ai-education-migration`
**Status:** Succeeded (running)

**Migration role:** This is the target database. Supabase PostgreSQL schema, data, and RPCs must be migrated here. RLS policies must be translated to application-layer authorization in Azure Functions (PostgreSQL Flexible Server supports RLS but configuration is different from Supabase's model).

## Supabase/Lovable References in Azure

| Area | Finding | Blocker |
|------|---------|---------|
| Function App app settings | No Supabase or Lovable references | No — clean start |
| Static Web App settings | Not inspectable from CLI | Possible gap |
| Key Vault secrets | Not accessible (private network) | Possible gap — need VPN/bastion access |
| Storage CORS | Not accessible (private network) | Possible gap |
| All resource names/tags | No Supabase or Lovable in names | No |

## Existing Backend That Can Absorb Replacement Logic
**Yes: `func-ai-education-migration`** is a running Node.js 22 Azure Function App with Application Insights and AzureWebJobsStorage already configured. It is the confirmed target for all 10 replacement function implementations.

## Gaps Requiring Human Action
1. **Key Vault secrets**: Cannot enumerate from local machine. Must verify via Azure Portal or from within VNet. If `AZURE_STORAGE_ACCOUNT_KEY`, `RESEND_API_KEY`, etc. are already stored here, they can be referenced directly.
2. **Static Web App app settings**: Cannot inspect via CLI in this context. Verify no Supabase vars are configured there.
3. **Storage CORS**: Cannot inspect. Must verify that `ai-uddannelse.dk` and the replacement Function App origin are in the allowed CORS list, and that Lovable domains are not present.
4. **Custom domain**: `ai-uddannelse.dk` not confirmed linked to SWA in Azure. Verify DNS/domain configuration.
