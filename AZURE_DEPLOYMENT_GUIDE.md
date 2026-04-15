# Azure Deployment Guide for Learn-Wings LMS

**A Complete Guide to Deploying Learn-Wings Learning Management System to Microsoft Azure**

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Azure Service Mapping](#2-azure-service-mapping)
3. [Prerequisites](#3-prerequisites)
4. [Azure Resource Deployment Order](#4-azure-resource-deployment-order)
5. [Detailed Deployment Steps](#5-detailed-deployment-steps)
6. [GitHub Actions CI/CD Setup](#6-github-actions-cicd-setup)
7. [Configuration and Environment Variables](#7-configuration-and-environment-variables)
8. [Testing and Validation](#8-testing-and-validation)
9. [Monitoring and Operations](#9-monitoring-and-operations)
10. [Troubleshooting](#10-troubleshooting)
11. [Cost Optimization](#11-cost-optimization)
12. [Appendix A: Multi-Tenant EntraID Authentication with MSAL](#appendix-a-multi-tenant-entraid-authentication-with-msal)

---

## 1. Architecture Overview

### 1.1 Current Application Components

The learn-wings repository is a **multi-tenant Learning Management System (LMS)** with the following architecture:

**Frontend:**
- React 18 with TypeScript
- Vite build system
- shadcn-ui component library
- Tailwind CSS styling
- React Router for routing
- i18next for internationalization

**Backend Services:**
- Supabase for authentication and database
- Supabase Edge Functions (Deno runtime) for serverless API endpoints
- PostgreSQL database with Row-Level Security (RLS)
- Azure Blob Storage integration (already present)

**Key Features:**
- Multi-tenant organization management
- Role-based access control (Platform Admin, Org Admin, Learner)
- Course management with modules, lessons (video/document/quiz)
- User progress tracking and analytics
- Certificate generation
- Community features (posts, ideas, resources)
- File storage for videos and documents

### 1.2 Azure Target Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                          Azure Front Door                         │
│                    (Global CDN + SSL/TLS)                        │
└────────────────────────┬────────────────────────────────────────┘
                         │
            ┌────────────┴─────────────┐
            │                          │
┌───────────▼──────────┐    ┌─────────▼──────────┐
│  Azure Static Web    │    │   Azure Functions  │
│      Apps            │    │  (Deno Container)  │
│   (React Frontend)   │    │   (Edge Functions) │
└──────────────────────┘    └─────────┬──────────┘
                                      │
                         ┌────────────┴────────────┐
                         │                         │
              ┌──────────▼─────────┐    ┌─────────▼──────────┐
              │  Azure PostgreSQL  │    │  Azure Blob       │
              │  Flexible Server   │    │  Storage          │
              │  (with RLS)        │    │  (Videos/Docs)    │
              └────────────────────┘    └────────────────────┘
                         │
              ┌──────────▼─────────┐
              │   Azure Key Vault  │
              │   (Secrets Mgmt)   │
              └────────────────────┘
```

---

## 2. Azure Service Mapping

### 2.1 Component to Azure Service Mapping

| Learn-Wings Component | Azure Service | Purpose | Rationale |
|----------------------|---------------|---------|-----------|
| React Frontend | Azure Static Web Apps | Host static website | Optimized for SPA with built-in CDN, SSL, preview environments |
| Supabase Edge Functions | Azure Functions (Container) | Serverless API endpoints | Custom container support allows Deno runtime |
| PostgreSQL Database | Azure Database for PostgreSQL Flexible Server | Relational database | Managed PostgreSQL with RLS support, high availability |
| Authentication | Supabase Auth → Azure EntraID (future) | User authentication | Current: Supabase Auth; Future: EntraID multi-tenant |
| File Storage | Azure Blob Storage | Video/document storage | Already integrated, scalable object storage |
| Secrets Management | Azure Key Vault | Store sensitive credentials | Secure storage for connection strings, API keys |
| CDN/Global Distribution | Azure Front Door | Content delivery | Low latency, DDoS protection, SSL offloading |
| Monitoring | Azure Monitor + Application Insights | Observability | Performance monitoring, logging, alerts |
| CI/CD | GitHub Actions | Automated deployments | Native integration with Azure services |

### 2.2 Why These Services?

**Azure Static Web Apps:**
- Perfect for React/Vite applications
- Built-in staging environments for pull requests
- Automatic SSL certificates
- Global CDN distribution
- Seamless GitHub Actions integration

**Azure Functions with Custom Containers:**
- Allows Deno runtime (required for Supabase Edge Functions)
- Serverless scaling
- Pay-per-execution pricing
- VNet integration for secure database access

**Azure Database for PostgreSQL Flexible Server:**
- Latest recommended option (Single Server retiring 2025)
- Zone-redundant high availability
- Customizable maintenance windows
- Full VNet integration
- Supports all PostgreSQL extensions needed
- Row-Level Security (RLS) support critical for multi-tenant design

**Azure Blob Storage:**
- Already integrated in the codebase
- Hot/Cool/Archive tiers for cost optimization
- CDN integration
- SAS token support (already implemented)

---

## 3. Prerequisites

### 3.1 Required Tools

- [ ] Azure CLI (v2.50+)
- [ ] Node.js (v20+) and npm
- [ ] Docker Desktop (for building function containers)
- [ ] Git
- [ ] PostgreSQL client tools (psql)
- [ ] Text editor (VS Code recommended)

### 3.2 Azure Subscription Requirements

- [ ] Active Azure subscription with Contributor or Owner role
- [ ] Sufficient quota for:
  - Azure Static Web Apps (Standard tier)
  - Azure Functions (Premium or Dedicated plan)
  - Azure Database for PostgreSQL Flexible Server
  - Azure Blob Storage (General Purpose v2)

### 3.3 Knowledge Prerequisites

- Basic understanding of:
  - React and TypeScript
  - PostgreSQL and SQL
  - Docker containers
  - Git and GitHub
  - Azure portal navigation

### 3.4 Repository Access

- [ ] Forked or cloned learn-wings repository
- [ ] GitHub repository admin access (for secrets and Actions)

---

## 4. Azure Resource Deployment Order

### 4.1 Deployment Sequence

The following order ensures dependencies are met and reduces deployment failures:

```
1. Resource Group
   ↓
2. Azure Key Vault
   ↓
3. Azure Virtual Network (VNet) + Subnets
   ↓
4. Azure Database for PostgreSQL Flexible Server
   ↓
5. Azure Blob Storage Account
   ↓
6. Azure Functions (Container)
   ↓
7. Azure Static Web Apps
   ↓
8. Azure Front Door (optional but recommended)
   ↓
9. Azure Monitor + Application Insights
   ↓
10. Configure GitHub Actions Secrets
    ↓
11. Deploy Application via CI/CD
```

### 4.2 Why This Order?

1. **Resource Group** - Container for all resources
2. **Key Vault** - Store secrets immediately for use by other services
3. **VNet** - Required before creating services that need network integration
4. **PostgreSQL** - Database must exist before functions can connect
5. **Blob Storage** - File storage needed by the application
6. **Azure Functions** - API layer depends on database and storage
7. **Static Web Apps** - Frontend depends on API being available
8. **Front Door** - Sits in front of all services for global distribution
9. **Monitoring** - Can be added anytime but best early for visibility
10. **GitHub Secrets** - Needed before CI/CD can deploy
11. **CI/CD Pipeline** - Final step to automate future deployments

---

## 5. Detailed Deployment Steps

### 5.1 Setup Azure CLI and Login

```bash
# Install Azure CLI (if not already installed)
# macOS: brew install azure-cli
# Windows: Download from https://aka.ms/installazurecliwindows
# Linux: curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash

# Login to Azure
az login

# Set your subscription (if you have multiple)
az account list --output table
az account set --subscription "Your Subscription Name or ID"

# Verify your account
az account show
```

### 5.2 Create Resource Group

```bash
# Set variables for reuse
RESOURCE_GROUP="rg-learnwings-prod"
LOCATION="eastus"  # Choose: eastus, westeurope, etc.
ENVIRONMENT="prod"

# Create resource group
az group create \
  --name $RESOURCE_GROUP \
  --location $LOCATION \
  --tags Environment=$ENVIRONMENT Project=LearnWings
```

**Best Practice:** Use consistent naming conventions. Microsoft recommends:
- Resource Group: `rg-<app-name>-<env>`
- Resources: `<resource-type>-<app-name>-<env>`

**Reference:** [Azure Naming Conventions](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/naming-and-tagging)

### 5.3 Create Azure Key Vault

```bash
# Set variables
KEYVAULT_NAME="kv-learnwings-prod"  # Must be globally unique

# Create Key Vault
az keyvault create \
  --name $KEYVAULT_NAME \
  --resource-group $RESOURCE_GROUP \
  --location $LOCATION \
  --enable-rbac-authorization true \
  --tags Environment=$ENVIRONMENT

# Grant yourself access (for initial setup)
YOUR_USER_ID=$(az ad signed-in-user show --query id -o tsv)
az role assignment create \
  --role "Key Vault Secrets Officer" \
  --assignee $YOUR_USER_ID \
  --scope "/subscriptions/$(az account show --query id -o tsv)/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.KeyVault/vaults/$KEYVAULT_NAME"
```

**Hot Tip:** Use RBAC instead of access policies for better security and integration with Azure AD.

**Reference:** [Azure Key Vault Best Practices](https://learn.microsoft.com/en-us/azure/key-vault/general/best-practices)

### 5.4 Create Virtual Network

```bash
# Set variables
VNET_NAME="vnet-learnwings-prod"
VNET_ADDRESS_PREFIX="10.0.0.0/16"
SUBNET_DB_NAME="snet-database"
SUBNET_DB_PREFIX="10.0.1.0/24"
SUBNET_FUNC_NAME="snet-functions"
SUBNET_FUNC_PREFIX="10.0.2.0/24"

# Create VNet
az network vnet create \
  --name $VNET_NAME \
  --resource-group $RESOURCE_GROUP \
  --location $LOCATION \
  --address-prefixes $VNET_ADDRESS_PREFIX \
  --tags Environment=$ENVIRONMENT

# Create subnet for database
az network vnet subnet create \
  --name $SUBNET_DB_NAME \
  --resource-group $RESOURCE_GROUP \
  --vnet-name $VNET_NAME \
  --address-prefix $SUBNET_DB_PREFIX \
  --service-endpoints Microsoft.Storage \
  --delegations Microsoft.DBforPostgreSQL/flexibleServers

# Create subnet for Azure Functions
az network vnet subnet create \
  --name $SUBNET_FUNC_NAME \
  --resource-group $RESOURCE_GROUP \
  --vnet-name $VNET_NAME \
  --address-prefix $SUBNET_FUNC_PREFIX \
  --delegations Microsoft.Web/serverFarms
```

**Best Practice:** Delegate subnets to specific services for enhanced security and isolation.

### 5.5 Create Azure Database for PostgreSQL Flexible Server

```bash
# Set variables
DB_SERVER_NAME="psql-learnwings-prod"  # Must be globally unique
DB_ADMIN_USER="learnwingsadmin"
DB_ADMIN_PASSWORD="$(openssl rand -base64 32)"  # Generate secure password
DB_NAME="learnwings"
DB_VERSION="15"  # PostgreSQL version

# Store password in Key Vault immediately
az keyvault secret set \
  --vault-name $KEYVAULT_NAME \
  --name "postgresql-admin-password" \
  --value "$DB_ADMIN_PASSWORD"

# Create PostgreSQL server
az postgres flexible-server create \
  --name $DB_SERVER_NAME \
  --resource-group $RESOURCE_GROUP \
  --location $LOCATION \
  --admin-user $DB_ADMIN_USER \
  --admin-password "$DB_ADMIN_PASSWORD" \
  --sku-name Standard_D2ds_v4 \
  --tier GeneralPurpose \
  --version $DB_VERSION \
  --storage-size 128 \
  --backup-retention 30 \
  --vnet $VNET_NAME \
  --subnet $SUBNET_DB_NAME \
  --high-availability Enabled \
  --zone 1 \
  --standby-zone 2 \
  --tags Environment=$ENVIRONMENT

# Create database
az postgres flexible-server db create \
  --resource-group $RESOURCE_GROUP \
  --server-name $DB_SERVER_NAME \
  --database-name $DB_NAME

# Allow Azure services to connect
az postgres flexible-server firewall-rule create \
  --resource-group $RESOURCE_GROUP \
  --name $DB_SERVER_NAME \
  --rule-name "AllowAzureServices" \
  --start-ip-address 0.0.0.0 \
  --end-ip-address 0.0.0.0
```

**Hot Tip:** Enable high availability with zone redundancy for production. The cost increase is worth the 99.99% SLA.

**Best Practice:** Always store database credentials in Key Vault, never in code or environment files.

**Reference:**
- [Azure Database for PostgreSQL Flexible Server](https://learn.microsoft.com/en-us/azure/postgresql/flexible-server/)
- [High Availability](https://learn.microsoft.com/en-us/azure/postgresql/flexible-server/concepts-high-availability)

### 5.6 Run Database Migrations

```bash
# Get database connection details
DB_HOST=$(az postgres flexible-server show \
  --resource-group $RESOURCE_GROUP \
  --name $DB_SERVER_NAME \
  --query "fullyQualifiedDomainName" -o tsv)

# Build connection string
export PGHOST="$DB_HOST"
export PGUSER="$DB_ADMIN_USER"
export PGPASSWORD="$DB_ADMIN_PASSWORD"
export PGDATABASE="$DB_NAME"
export PGSSLMODE="require"

# Test connection
psql -c "SELECT version();"

# Run migrations (from your local repository)
cd /path/to/learn-wings
for migration in supabase/migrations/*.sql; do
  echo "Running migration: $migration"
  psql -f "$migration"
done

# Verify tables were created
psql -c "\dt"
```

**Alternative:** Use a migration tool like Flyway, Liquibase, or Prisma for better version control.

**Hot Tip:** Run migrations in a transaction where possible to enable rollback on failure.

### 5.7 Create Azure Blob Storage

```bash
# Set variables
STORAGE_ACCOUNT_NAME="stlearnwingsprod"  # Must be globally unique, lowercase, no hyphens
CONTAINER_NAME="lms-videos"
CONTAINER_DOCS="lms-documents"

# Create storage account
az storage account create \
  --name $STORAGE_ACCOUNT_NAME \
  --resource-group $RESOURCE_GROUP \
  --location $LOCATION \
  --sku Standard_LRS \
  --kind StorageV2 \
  --access-tier Hot \
  --https-only true \
  --min-tls-version TLS1_2 \
  --allow-blob-public-access false \
  --tags Environment=$ENVIRONMENT

# Get storage account key
STORAGE_KEY=$(az storage account keys list \
  --resource-group $RESOURCE_GROUP \
  --account-name $STORAGE_ACCOUNT_NAME \
  --query "[0].value" -o tsv)

# Store in Key Vault
az keyvault secret set \
  --vault-name $KEYVAULT_NAME \
  --name "storage-account-key" \
  --value "$STORAGE_KEY"

# Create containers
az storage container create \
  --name $CONTAINER_NAME \
  --account-name $STORAGE_ACCOUNT_NAME \
  --account-key "$STORAGE_KEY" \
  --public-access off

az storage container create \
  --name $CONTAINER_DOCS \
  --account-name $STORAGE_ACCOUNT_NAME \
  --account-key "$STORAGE_KEY" \
  --public-access off

# Enable lifecycle management for cost optimization
az storage account management-policy create \
  --account-name $STORAGE_ACCOUNT_NAME \
  --resource-group $RESOURCE_GROUP \
  --policy @- <<EOF
{
  "rules": [
    {
      "enabled": true,
      "name": "MoveToCoolAfter30Days",
      "type": "Lifecycle",
      "definition": {
        "actions": {
          "baseBlob": {
            "tierToCool": {
              "daysAfterModificationGreaterThan": 30
            }
          }
        },
        "filters": {
          "blobTypes": ["blockBlob"]
        }
      }
    }
  ]
}
EOF
```

**Best Practice:** Disable public blob access and use SAS tokens (already implemented in the code).

**Hot Tip:** Configure lifecycle management to automatically move old videos to Cool/Archive tiers for significant cost savings.

**Reference:** [Azure Blob Storage Best Practices](https://learn.microsoft.com/en-us/azure/storage/blobs/storage-best-practices)

### 5.8 Create Azure Functions for Edge Functions

#### 5.8.1 Prepare Dockerfile for Deno Functions

Create `supabase/functions/Dockerfile`:

```dockerfile
FROM denoland/deno:1.45.0

# Set working directory
WORKDIR /app

# Copy function code
COPY . .

# Cache dependencies
RUN deno cache --reload **/index.ts

# Expose port
EXPOSE 8080

# Set environment for Azure Functions
ENV AzureWebJobsScriptRoot=/app
ENV AzureFunctionsJobHost__Logging__Console__IsEnabled=true

# Start the function
CMD ["deno", "run", "--allow-net", "--allow-env", "--allow-read", "azure-upload-url/index.ts"]
```

**Note:** You'll need a separate container image per function or a router function that handles multiple endpoints.

#### 5.8.2 Build and Push Container Images

```bash
# Set variables
ACR_NAME="acrlearnwingsprod"  # Azure Container Registry
FUNCTION_APP_NAME="func-learnwings-prod"
IMAGE_TAG="latest"

# Create Azure Container Registry
az acr create \
  --resource-group $RESOURCE_GROUP \
  --name $ACR_NAME \
  --sku Basic \
  --admin-enabled true

# Get ACR credentials
ACR_USERNAME=$(az acr credential show \
  --name $ACR_NAME \
  --query "username" -o tsv)
ACR_PASSWORD=$(az acr credential show \
  --name $ACR_NAME \
  --query "passwords[0].value" -o tsv)

# Store in Key Vault
az keyvault secret set \
  --vault-name $KEYVAULT_NAME \
  --name "acr-password" \
  --value "$ACR_PASSWORD"

# Build and push container image
cd supabase/functions
az acr build \
  --registry $ACR_NAME \
  --image learnwings-functions:$IMAGE_TAG \
  --file Dockerfile .

# Note: In production, you'll want separate images per function
# or a single router function that handles all edge function endpoints
```

#### 5.8.3 Create Azure Functions App

```bash
# Create App Service Plan (Premium for VNet integration)
APP_PLAN_NAME="plan-learnwings-prod"
az appservice plan create \
  --name $APP_PLAN_NAME \
  --resource-group $RESOURCE_GROUP \
  --location $LOCATION \
  --is-linux true \
  --sku P1V3 \
  --tags Environment=$ENVIRONMENT

# Create Function App
az functionapp create \
  --name $FUNCTION_APP_NAME \
  --resource-group $RESOURCE_GROUP \
  --plan $APP_PLAN_NAME \
  --deployment-container-image-name "$ACR_NAME.azurecr.io/learnwings-functions:$IMAGE_TAG" \
  --docker-registry-server-user $ACR_USERNAME \
  --docker-registry-server-password "$ACR_PASSWORD" \
  --tags Environment=$ENVIRONMENT

# Configure VNet integration
az functionapp vnet-integration add \
  --name $FUNCTION_APP_NAME \
  --resource-group $RESOURCE_GROUP \
  --vnet $VNET_NAME \
  --subnet $SUBNET_FUNC_NAME

# Get database connection string
DB_CONN_STRING="postgresql://$DB_ADMIN_USER:$DB_ADMIN_PASSWORD@$DB_HOST:5432/$DB_NAME?sslmode=require"

# Configure environment variables
az functionapp config appsettings set \
  --name $FUNCTION_APP_NAME \
  --resource-group $RESOURCE_GROUP \
  --settings \
    "SUPABASE_URL=https://$FUNCTION_APP_NAME.azurewebsites.net" \
    "SUPABASE_SERVICE_ROLE_KEY=@Microsoft.KeyVault(SecretUri=https://$KEYVAULT_NAME.vault.azure.net/secrets/supabase-service-key/)" \
    "DATABASE_URL=@Microsoft.KeyVault(SecretUri=https://$KEYVAULT_NAME.vault.azure.net/secrets/database-connection-string/)" \
    "AZURE_STORAGE_ACCOUNT_NAME=$STORAGE_ACCOUNT_NAME" \
    "AZURE_STORAGE_ACCOUNT_KEY=@Microsoft.KeyVault(SecretUri=https://$KEYVAULT_NAME.vault.azure.net/secrets/storage-account-key/)" \
    "AZURE_STORAGE_CONTAINER_NAME=$CONTAINER_NAME"

# Enable managed identity for Key Vault access
az functionapp identity assign \
  --name $FUNCTION_APP_NAME \
  --resource-group $RESOURCE_GROUP

# Grant Function App access to Key Vault
FUNC_IDENTITY=$(az functionapp identity show \
  --name $FUNCTION_APP_NAME \
  --resource-group $RESOURCE_GROUP \
  --query principalId -o tsv)

az role assignment create \
  --role "Key Vault Secrets User" \
  --assignee $FUNC_IDENTITY \
  --scope "/subscriptions/$(az account show --query id -o tsv)/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.KeyVault/vaults/$KEYVAULT_NAME"
```

**Best Practice:** Use Managed Identity and Key Vault references for all secrets instead of plain environment variables.

**Hot Tip:** Premium plan (P1V3) is required for VNet integration but provides better cold start performance than Consumption plan.

**Reference:** [Azure Functions Custom Containers](https://learn.microsoft.com/en-us/azure/azure-functions/functions-custom-container)

### 5.9 Create Azure Static Web Apps

```bash
# Set variables
STATIC_APP_NAME="stapp-learnwings-prod"
GITHUB_REPO="your-github-username/learn-wings"
GITHUB_BRANCH="main"

# Create Static Web App
az staticwebapp create \
  --name $STATIC_APP_NAME \
  --resource-group $RESOURCE_GROUP \
  --location $LOCATION \
  --sku Standard \
  --tags Environment=$ENVIRONMENT

# Get deployment token
DEPLOYMENT_TOKEN=$(az staticwebapp secrets list \
  --name $STATIC_APP_NAME \
  --resource-group $RESOURCE_GROUP \
  --query "properties.apiKey" -o tsv)

# Store in Key Vault
az keyvault secret set \
  --vault-name $KEYVAULT_NAME \
  --name "static-web-app-token" \
  --value "$DEPLOYMENT_TOKEN"

echo "Deployment Token (add to GitHub Secrets): $DEPLOYMENT_TOKEN"
```

**Important:** You'll need to add the deployment token to your GitHub repository secrets (covered in Section 6).

**Best Practice:** Use Standard tier for production to get custom domains, higher bandwidth, and SLA.

### 5.10 Configure Static Web App Settings

Create `staticwebapp.config.json` in your repository root:

```json
{
  "navigationFallback": {
    "rewrite": "/index.html",
    "exclude": ["/api/*", "/*.{css,js,jpg,png,gif,svg,ico,woff,woff2,ttf,eot}"]
  },
  "routes": [
    {
      "route": "/api/*",
      "allowedRoles": ["authenticated"]
    }
  ],
  "responseOverrides": {
    "404": {
      "rewrite": "/index.html",
      "statusCode": 200
    }
  },
  "globalHeaders": {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-XSS-Protection": "1; mode=block",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https://*.azurewebsites.net https://*.blob.core.windows.net;"
  },
  "mimeTypes": {
    ".json": "application/json",
    ".js": "text/javascript",
    ".css": "text/css"
  },
  "platform": {
    "apiRuntime": "node:18"
  }
}
```

**Hot Tip:** Configure strict CSP headers but ensure they allow connections to your Azure Functions and Blob Storage domains.

**Reference:** [Static Web Apps Configuration](https://learn.microsoft.com/en-us/azure/static-web-apps/configuration)

### 5.11 Setup Azure Front Door (Optional but Recommended)

```bash
# Set variables
FRONTDOOR_NAME="fd-learnwings-prod"
CUSTOM_DOMAIN="app.yourdomain.com"

# Create Front Door
az afd profile create \
  --profile-name $FRONTDOOR_NAME \
  --resource-group $RESOURCE_GROUP \
  --sku Premium_AzureFrontDoor

# Get Static Web App hostname
STATIC_APP_HOSTNAME=$(az staticwebapp show \
  --name $STATIC_APP_NAME \
  --resource-group $RESOURCE_GROUP \
  --query "defaultHostname" -o tsv)

# Create endpoint
az afd endpoint create \
  --resource-group $RESOURCE_GROUP \
  --profile-name $FRONTDOOR_NAME \
  --endpoint-name "learnwings-endpoint" \
  --enabled-state Enabled

# Create origin group
az afd origin-group create \
  --resource-group $RESOURCE_GROUP \
  --profile-name $FRONTDOOR_NAME \
  --origin-group-name "static-web-app-origin" \
  --probe-request-type GET \
  --probe-protocol Https \
  --probe-interval-in-seconds 30 \
  --probe-path / \
  --sample-size 4 \
  --successful-samples-required 3 \
  --additional-latency-in-milliseconds 50

# Add origin
az afd origin create \
  --resource-group $RESOURCE_GROUP \
  --profile-name $FRONTDOOR_NAME \
  --origin-group-name "static-web-app-origin" \
  --origin-name "static-web-app" \
  --origin-host-header $STATIC_APP_HOSTNAME \
  --host-name $STATIC_APP_HOSTNAME \
  --http-port 80 \
  --https-port 443 \
  --priority 1 \
  --weight 1000 \
  --enabled-state Enabled
```

**Hot Tip:** Azure Front Door Premium tier includes Web Application Firewall (WAF) for enhanced security.

**Reference:** [Azure Front Door](https://learn.microsoft.com/en-us/azure/frontdoor/)

### 5.12 Configure Monitoring

```bash
# Create Application Insights
APPINSIGHTS_NAME="appi-learnwings-prod"
LOG_ANALYTICS_WORKSPACE="log-learnwings-prod"

# Create Log Analytics Workspace
az monitor log-analytics workspace create \
  --resource-group $RESOURCE_GROUP \
  --workspace-name $LOG_ANALYTICS_WORKSPACE \
  --location $LOCATION

# Create Application Insights
az monitor app-insights component create \
  --app $APPINSIGHTS_NAME \
  --location $LOCATION \
  --resource-group $RESOURCE_GROUP \
  --workspace $LOG_ANALYTICS_WORKSPACE \
  --application-type web

# Get instrumentation key
APPINSIGHTS_KEY=$(az monitor app-insights component show \
  --app $APPINSIGHTS_NAME \
  --resource-group $RESOURCE_GROUP \
  --query "instrumentationKey" -o tsv)

# Store in Key Vault
az keyvault secret set \
  --vault-name $KEYVAULT_NAME \
  --name "appinsights-instrumentation-key" \
  --value "$APPINSIGHTS_KEY"

# Link to Function App
az functionapp config appsettings set \
  --name $FUNCTION_APP_NAME \
  --resource-group $RESOURCE_GROUP \
  --settings \
    "APPINSIGHTS_INSTRUMENTATIONKEY=$APPINSIGHTS_KEY" \
    "APPLICATIONINSIGHTS_CONNECTION_STRING=InstrumentationKey=$APPINSIGHTS_KEY"
```

**Best Practice:** Use Log Analytics Workspace-based Application Insights for better integration and querying.

**Reference:** [Application Insights](https://learn.microsoft.com/en-us/azure/azure-monitor/app/app-insights-overview)

---

## 6. GitHub Actions CI/CD Setup

### 6.1 Add GitHub Secrets

Navigate to your GitHub repository → Settings → Secrets and variables → Actions, and add:

```
AZURE_STATIC_WEB_APPS_API_TOKEN=<from step 5.9>
AZURE_FUNCTIONAPP_PUBLISH_PROFILE=<from Azure Portal>
ACR_USERNAME=<from step 5.8.2>
ACR_PASSWORD=<from step 5.8.2>
DATABASE_CONNECTION_STRING=postgresql://...
AZURE_STORAGE_ACCOUNT_NAME=<from step 5.7>
AZURE_STORAGE_ACCOUNT_KEY=<from step 5.7>
```

**Hot Tip:** Use GitHub Environments for different deployment stages (dev, staging, prod) with environment-specific secrets.

### 6.2 Create GitHub Actions Workflow

Create `.github/workflows/azure-deploy.yml`:

```yaml
name: Azure Deployment CI/CD

on:
  push:
    branches:
      - main
  pull_request:
    types: [opened, synchronize, reopened, closed]
    branches:
      - main

env:
  AZURE_FUNCTIONAPP_NAME: func-learnwings-prod
  AZURE_FUNCTIONAPP_PACKAGE_PATH: './supabase/functions'
  ACR_NAME: acrlearnwingsprod.azurecr.io
  IMAGE_NAME: learnwings-functions

jobs:
  build_and_deploy_static_web_app:
    if: github.event_name == 'push' || (github.event_name == 'pull_request' && github.event.action != 'closed')
    runs-on: ubuntu-latest
    name: Build and Deploy Static Web App
    steps:
      - uses: actions/checkout@v4
        with:
          submodules: true

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run tests
        run: npm test

      - name: Build application
        run: npm run build
        env:
          VITE_SUPABASE_URL: ${{ secrets.VITE_SUPABASE_URL }}
          VITE_SUPABASE_PUBLISHABLE_KEY: ${{ secrets.VITE_SUPABASE_PUBLISHABLE_KEY }}

      - name: Deploy to Azure Static Web Apps
        uses: Azure/static-web-apps-deploy@v1
        with:
          azure_static_web_apps_api_token: ${{ secrets.AZURE_STATIC_WEB_APPS_API_TOKEN }}
          repo_token: ${{ secrets.GITHUB_TOKEN }}
          action: 'upload'
          app_location: '/'
          output_location: 'dist'
          skip_api_build: true

  close_pull_request:
    if: github.event_name == 'pull_request' && github.event.action == 'closed'
    runs-on: ubuntu-latest
    name: Close Pull Request
    steps:
      - name: Close Pull Request
        uses: Azure/static-web-apps-deploy@v1
        with:
          azure_static_web_apps_api_token: ${{ secrets.AZURE_STATIC_WEB_APPS_API_TOKEN }}
          action: 'close'

  build_and_deploy_functions:
    if: github.event_name == 'push'
    runs-on: ubuntu-latest
    name: Build and Deploy Azure Functions
    steps:
      - uses: actions/checkout@v4

      - name: Login to Azure Container Registry
        uses: docker/login-action@v3
        with:
          registry: ${{ env.ACR_NAME }}
          username: ${{ secrets.ACR_USERNAME }}
          password: ${{ secrets.ACR_PASSWORD }}

      - name: Build and push container image
        uses: docker/build-push-action@v5
        with:
          context: ${{ env.AZURE_FUNCTIONAPP_PACKAGE_PATH }}
          push: true
          tags: ${{ env.ACR_NAME }}/${{ env.IMAGE_NAME }}:${{ github.sha }},${{ env.ACR_NAME }}/${{ env.IMAGE_NAME }}:latest

      - name: Azure Login
        uses: azure/login@v1
        with:
          creds: ${{ secrets.AZURE_CREDENTIALS }}

      - name: Deploy to Azure Functions
        uses: azure/webapps-deploy@v2
        with:
          app-name: ${{ env.AZURE_FUNCTIONAPP_NAME }}
          images: ${{ env.ACR_NAME }}/${{ env.IMAGE_NAME }}:${{ github.sha }}

  run_database_migrations:
    if: github.event_name == 'push'
    runs-on: ubuntu-latest
    name: Run Database Migrations
    needs: [build_and_deploy_functions]
    steps:
      - uses: actions/checkout@v4

      - name: Install PostgreSQL client
        run: sudo apt-get install -y postgresql-client

      - name: Run migrations
        env:
          PGHOST: ${{ secrets.PGHOST }}
          PGUSER: ${{ secrets.PGUSER }}
          PGPASSWORD: ${{ secrets.PGPASSWORD }}
          PGDATABASE: ${{ secrets.PGDATABASE }}
          PGSSLMODE: require
        run: |
          for migration in supabase/migrations/*.sql; do
            echo "Running migration: $migration"
            psql -f "$migration" || echo "Migration $migration already applied or failed"
          done
```

**Best Practice:**
- Use pull request preview environments (automatic with Static Web Apps)
- Run tests before deployment
- Deploy functions before running migrations
- Tag container images with git commit SHA for traceability

**Hot Tip:** Add manual approval gates for production deployments using GitHub Environments.

**Reference:** [GitHub Actions for Azure](https://learn.microsoft.com/en-us/azure/developer/github/github-actions)

---

## 7. Configuration and Environment Variables

### 7.1 Update Application Configuration

Update `.env` or create `.env.production`:

```bash
# Frontend environment variables (VITE_ prefix required)
VITE_SUPABASE_URL=https://func-learnwings-prod.azurewebsites.net
VITE_SUPABASE_PUBLISHABLE_KEY=<your-anon-key>
VITE_SUPABASE_PROJECT_ID=learnwings-prod
VITE_AZURE_STORAGE_URL=https://stlearnwingsprod.blob.core.windows.net
```

### 7.2 Azure Function Environment Variables

Already configured in step 5.8.3, but verify:

```bash
az functionapp config appsettings list \
  --name $FUNCTION_APP_NAME \
  --resource-group $RESOURCE_GROUP
```

### 7.3 Update CORS Settings

```bash
# Allow Static Web App to call Functions
STATIC_APP_URL=$(az staticwebapp show \
  --name $STATIC_APP_NAME \
  --resource-group $RESOURCE_GROUP \
  --query "defaultHostname" -o tsv)

az functionapp cors add \
  --name $FUNCTION_APP_NAME \
  --resource-group $RESOURCE_GROUP \
  --allowed-origins "https://$STATIC_APP_URL"

# If using custom domain
az functionapp cors add \
  --name $FUNCTION_APP_NAME \
  --resource-group $RESOURCE_GROUP \
  --allowed-origins "https://app.yourdomain.com"
```

**Best Practice:** Never use wildcard (*) CORS in production. Specify exact origins.

---

## 8. Testing and Validation

### 8.1 Test Database Connection

```bash
# From your local machine
psql -h $DB_HOST -U $DB_ADMIN_USER -d $DB_NAME -c "SELECT count(*) FROM profiles;"
```

### 8.2 Test Blob Storage

```bash
# Upload test file
az storage blob upload \
  --account-name $STORAGE_ACCOUNT_NAME \
  --container-name $CONTAINER_NAME \
  --name "test.txt" \
  --file /path/to/test.txt \
  --auth-mode key

# Generate SAS URL
az storage blob generate-sas \
  --account-name $STORAGE_ACCOUNT_NAME \
  --container-name $CONTAINER_NAME \
  --name "test.txt" \
  --permissions r \
  --expiry "2026-12-31" \
  --auth-mode key \
  --full-uri
```

### 8.3 Test Azure Functions

```bash
# Get function URL
FUNCTION_URL=$(az functionapp show \
  --name $FUNCTION_APP_NAME \
  --resource-group $RESOURCE_GROUP \
  --query "defaultHostName" -o tsv)

# Test health endpoint
curl https://$FUNCTION_URL/api/health

# Test with authentication (replace with actual JWT token)
curl -H "Authorization: Bearer <jwt-token>" \
  https://$FUNCTION_URL/api/azure-upload-url \
  -d '{"fileName": "test.mp4", "contentType": "video/mp4"}'
```

### 8.4 Test Static Web App

```bash
# Get Static Web App URL
STATIC_URL=$(az staticwebapp show \
  --name $STATIC_APP_NAME \
  --resource-group $RESOURCE_GROUP \
  --query "defaultHostname" -o tsv)

# Open in browser
echo "Visit: https://$STATIC_URL"

# Test routing
curl -I https://$STATIC_URL/app/dashboard
```

### 8.5 End-to-End Testing Checklist

- [ ] User can sign up with email
- [ ] User can log in successfully
- [ ] User can view courses
- [ ] Video playback works (Azure Blob Storage integration)
- [ ] Document upload/download works
- [ ] Quiz functionality works
- [ ] Organization admin can invite users
- [ ] Platform admin can create courses
- [ ] Progress tracking updates correctly
- [ ] Certificate generation works
- [ ] Email notifications are sent (if configured)

---

## 9. Monitoring and Operations

### 9.1 Key Metrics to Monitor

**Application Insights Queries:**

```kusto
// Failed requests
requests
| where success == false
| summarize count() by name, resultCode
| order by count_ desc

// Slow requests (>3 seconds)
requests
| where duration > 3000
| summarize avg(duration), max(duration) by name
| order by avg_duration desc

// Exception rate
exceptions
| summarize count() by type, outerMessage
| order by count_ desc

// Database query performance
dependencies
| where type == "SQL"
| summarize avg(duration), max(duration), count() by name
| order by avg_duration desc
```

### 9.2 Setup Alerts

```bash
# Create action group for notifications
az monitor action-group create \
  --name "LearnWings-Alerts" \
  --resource-group $RESOURCE_GROUP \
  --short-name "LW-Alerts" \
  --email-receiver name="DevOps Team" email-address="devops@yourdomain.com"

# Alert on high error rate
az monitor metrics alert create \
  --name "High-Error-Rate" \
  --resource-group $RESOURCE_GROUP \
  --scopes "/subscriptions/$(az account show --query id -o tsv)/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.Web/sites/$FUNCTION_APP_NAME" \
  --condition "avg Http5xx > 10" \
  --window-size 5m \
  --evaluation-frequency 1m \
  --action "LearnWings-Alerts"

# Alert on high database CPU
az monitor metrics alert create \
  --name "High-Database-CPU" \
  --resource-group $RESOURCE_GROUP \
  --scopes "/subscriptions/$(az account show --query id -o tsv)/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.DBforPostgreSQL/flexibleServers/$DB_SERVER_NAME" \
  --condition "avg cpu_percent > 80" \
  --window-size 5m \
  --evaluation-frequency 1m \
  --action "LearnWings-Alerts"
```

**Best Practice:** Set up alerts for:
- Error rate thresholds
- Response time degradation
- Database CPU/memory usage
- Storage capacity
- SSL certificate expiration

### 9.3 Log Management

```bash
# View recent logs
az monitor log-analytics query \
  --workspace $LOG_ANALYTICS_WORKSPACE \
  --analytics-query "traces | where timestamp > ago(1h) | order by timestamp desc | take 100" \
  --output table

# Export logs for compliance
az monitor log-analytics workspace data-export create \
  --resource-group $RESOURCE_GROUP \
  --workspace-name $LOG_ANALYTICS_WORKSPACE \
  --name "ExportToStorage" \
  --destination "/subscriptions/$(az account show --query id -o tsv)/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.Storage/storageAccounts/$STORAGE_ACCOUNT_NAME" \
  --tables "AppTraces,AppRequests,AppExceptions"
```

**Hot Tip:** Configure log retention based on compliance requirements (90 days minimum for most regulations).

---

## 10. Troubleshooting

### 10.1 Common Issues

#### Static Web App Not Loading

**Symptom:** Blank page or 404 errors

**Solutions:**
```bash
# Check build output location
cat staticwebapp.config.json | grep output_location

# Verify deployment status
az staticwebapp show \
  --name $STATIC_APP_NAME \
  --resource-group $RESOURCE_GROUP \
  --query "deploymentStatus"

# Check GitHub Actions logs
# Visit: https://github.com/your-repo/actions
```

#### Azure Functions Not Responding

**Symptom:** 500 errors or timeouts

**Solutions:**
```bash
# Check function logs
az functionapp log tail \
  --name $FUNCTION_APP_NAME \
  --resource-group $RESOURCE_GROUP

# Verify environment variables
az functionapp config appsettings list \
  --name $FUNCTION_APP_NAME \
  --resource-group $RESOURCE_GROUP

# Check container image
az functionapp config container show \
  --name $FUNCTION_APP_NAME \
  --resource-group $RESOURCE_GROUP

# Restart function app
az functionapp restart \
  --name $FUNCTION_APP_NAME \
  --resource-group $RESOURCE_GROUP
```

#### Database Connection Issues

**Symptom:** "could not connect to server" errors

**Solutions:**
```bash
# Verify firewall rules
az postgres flexible-server firewall-rule list \
  --resource-group $RESOURCE_GROUP \
  --name $DB_SERVER_NAME

# Test connectivity from Azure Function
# Add temporary firewall rule for your IP
MY_IP=$(curl -s ifconfig.me)
az postgres flexible-server firewall-rule create \
  --resource-group $RESOURCE_GROUP \
  --name $DB_SERVER_NAME \
  --rule-name "TempDebug" \
  --start-ip-address $MY_IP \
  --end-ip-address $MY_IP

# Test connection
psql -h $DB_HOST -U $DB_ADMIN_USER -d $DB_NAME -c "SELECT 1;"

# Remove temporary rule when done
az postgres flexible-server firewall-rule delete \
  --resource-group $RESOURCE_GROUP \
  --name $DB_SERVER_NAME \
  --rule-name "TempDebug"
```

#### Blob Storage Upload Failures

**Symptom:** SAS token errors or 403 Forbidden

**Solutions:**
```bash
# Verify storage account key
az storage account keys list \
  --resource-group $RESOURCE_GROUP \
  --account-name $STORAGE_ACCOUNT_NAME

# Check CORS settings
az storage cors list \
  --account-name $STORAGE_ACCOUNT_NAME \
  --services b

# Test SAS token generation
# Review the edge function code in:
# supabase/functions/azure-upload-url/index.ts
```

### 10.2 Performance Optimization

#### Enable Compression

```bash
# For Static Web Apps (automatic, but verify)
az staticwebapp show \
  --name $STATIC_APP_NAME \
  --resource-group $RESOURCE_GROUP \
  --query "buildProperties"

# For Functions, enable in host.json
```

Add to `host.json` in your function app:

```json
{
  "version": "2.0",
  "extensions": {
    "http": {
      "routePrefix": "api",
      "maxOutstandingRequests": 200,
      "maxConcurrentRequests": 100,
      "dynamicThrottlesEnabled": true
    }
  },
  "functionTimeout": "00:05:00",
  "healthMonitor": {
    "enabled": true,
    "healthCheckInterval": "00:00:10",
    "healthCheckWindow": "00:02:00",
    "healthCheckThreshold": 6,
    "counterThreshold": 0.80
  }
}
```

#### Database Performance Tuning

```sql
-- Enable query performance insights
ALTER SYSTEM SET shared_preload_libraries = 'pg_stat_statements';
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- View slow queries
SELECT
  calls,
  total_exec_time::numeric(10,2) as total_time_ms,
  mean_exec_time::numeric(10,2) as mean_time_ms,
  query
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 20;

-- Create missing indexes (example)
CREATE INDEX CONCURRENTLY idx_enrollments_user_org
ON enrollments(user_id, org_id)
WHERE status = 'enrolled';
```

**Reference:** [PostgreSQL Performance Tuning](https://learn.microsoft.com/en-us/azure/postgresql/flexible-server/how-to-optimize-query-performance)

---

## 11. Cost Optimization

### 11.1 Cost Breakdown (Estimated Monthly)

Based on a medium-sized deployment:

| Service | Configuration | Est. Monthly Cost (USD) |
|---------|--------------|-------------------------|
| Azure Static Web Apps | Standard tier | $9 |
| Azure Functions | Premium P1V3 (1 instance) | $150 |
| Azure PostgreSQL Flexible Server | Standard_D2ds_v4, 128GB, HA | $300 |
| Azure Blob Storage | 500GB Hot + 1TB Cool | $45 |
| Azure Container Registry | Basic | $5 |
| Azure Key Vault | Secrets | $1 |
| Application Insights | 5GB/day | $12 |
| Azure Front Door | Premium, 1TB egress | $420 |
| **Total** | | **~$942/month** |

**Note:** Front Door is optional but adds significant cost. Use only if you need global distribution, WAF, or advanced routing.

### 11.2 Cost Optimization Strategies

#### 1. Right-size Resources

```bash
# Scale down during off-hours (e.g., nights/weekends)
# Example: Scale function app to smaller plan
az appservice plan update \
  --name $APP_PLAN_NAME \
  --resource-group $RESOURCE_GROUP \
  --sku B2  # Cheaper Basic tier for non-prod

# Scale database down for dev/test
az postgres flexible-server update \
  --resource-group $RESOURCE_GROUP \
  --name $DB_SERVER_NAME \
  --sku-name Standard_B2s  # Burstable tier
```

#### 2. Use Lifecycle Management for Storage

Already configured in step 5.7, but verify it's working:

```bash
az storage account management-policy show \
  --account-name $STORAGE_ACCOUNT_NAME \
  --resource-group $RESOURCE_GROUP
```

#### 3. Implement Autoscaling

```bash
# Autoscale for Function App
az monitor autoscale create \
  --resource-group $RESOURCE_GROUP \
  --resource $APP_PLAN_NAME \
  --resource-type "Microsoft.Web/serverFarms" \
  --name "FunctionAppAutoscale" \
  --min-count 1 \
  --max-count 5 \
  --count 1

az monitor autoscale rule create \
  --resource-group $RESOURCE_GROUP \
  --autoscale-name "FunctionAppAutoscale" \
  --condition "CpuPercentage > 70 avg 5m" \
  --scale out 1

az monitor autoscale rule create \
  --resource-group $RESOURCE_GROUP \
  --autoscale-name "FunctionAppAutoscale" \
  --condition "CpuPercentage < 30 avg 5m" \
  --scale in 1
```

#### 4. Use Azure Reservations

For predictable workloads, purchase 1-year or 3-year reserved instances:

- Azure Functions Premium: Up to 37% savings
- PostgreSQL: Up to 63% savings
- Blob Storage: Up to 38% savings

**Reference:** [Azure Reservations](https://learn.microsoft.com/en-us/azure/cost-management-billing/reservations/)

#### 5. Monitor Costs

```bash
# Setup budget alerts
az consumption budget create \
  --budget-name "LearnWings-Monthly" \
  --category "Cost" \
  --amount 1000 \
  --time-grain "Monthly" \
  --start-date "2026-04-01" \
  --notifications \
    "notification1={enabled:true,operator:GreaterThan,threshold:80,contactEmails:[devops@yourdomain.com]}" \
    "notification2={enabled:true,operator:GreaterThan,threshold:100,contactEmails:[devops@yourdomain.com]}"
```

### 11.3 Cost Optimization Checklist

- [ ] Remove Azure Front Door if not needed (saves ~$420/month)
- [ ] Use Basic tier for non-production environments
- [ ] Enable autoscaling to reduce idle capacity
- [ ] Implement storage lifecycle policies
- [ ] Review and delete unused resources weekly
- [ ] Use Spot instances for dev/test workloads
- [ ] Purchase reserved instances for production
- [ ] Set up cost alerts at 80% and 100% of budget
- [ ] Review cost analysis reports monthly

**Hot Tip:** For small teams (<100 users), you can save ~$450/month by using:
- Azure Functions Consumption plan instead of Premium
- Single-zone PostgreSQL instead of zone-redundant HA
- Skipping Azure Front Door

---

## Appendix A: Multi-Tenant EntraID Authentication with MSAL

This appendix covers integrating **Microsoft Entra ID (formerly Azure AD)** multi-tenant authentication using **MSAL (Microsoft Authentication Library)** into the learn-wings application.

### A.1 Why Add EntraID Authentication?

**Benefits:**
- Enterprise SSO (Single Sign-On) for organizations
- Multi-factor authentication (MFA) support
- Conditional Access policies
- B2B collaboration with guest users
- Centralized user management
- Compliance with enterprise security policies

**Use Case:** Organizations can use their existing Azure AD tenant to authenticate users, eliminating the need for separate credentials.

### A.2 Architecture Changes

**Before (Current State):**
```
User → Supabase Auth → PostgreSQL
```

**After (With EntraID):**
```
User → MSAL (EntraID) → Custom Auth Service (Azure Function) → PostgreSQL
         ↓
      JWT Token (validated in RLS policies)
```

### A.3 Prerequisites

- [ ] Azure AD tenant (any organization with Microsoft 365 has one)
- [ ] Global Administrator or Application Administrator role
- [ ] Understanding of OAuth 2.0 and OpenID Connect

### A.4 Step 1: Register Multi-Tenant Application in Azure AD

```bash
# Login to Azure AD
az login

# Create app registration
APP_NAME="LearnWings LMS"
APP_REPLY_URL="https://$STATIC_APP_URL/auth/callback"

az ad app create \
  --display-name "$APP_NAME" \
  --sign-in-audience "AzureADMultipleOrgs" \
  --web-redirect-uris "$APP_REPLY_URL" \
  --enable-id-token-issuance true \
  --enable-access-token-issuance true

# Get application (client) ID
CLIENT_ID=$(az ad app list --display-name "$APP_NAME" --query "[0].appId" -o tsv)
echo "Client ID: $CLIENT_ID"

# Create client secret
CLIENT_SECRET=$(az ad app credential reset \
  --id $CLIENT_ID \
  --append \
  --query "password" -o tsv)

# Store in Key Vault
az keyvault secret set \
  --vault-name $KEYVAULT_NAME \
  --name "entraid-client-secret" \
  --value "$CLIENT_SECRET"

echo "Client Secret (store securely): $CLIENT_SECRET"
```

**Important:**
- `AzureADMultipleOrgs` enables multi-tenant authentication
- Store client secret immediately - it's only shown once

**Reference:** [Register a multi-tenant app](https://learn.microsoft.com/en-us/azure/active-directory/develop/quickstart-register-app)

### A.5 Step 2: Configure API Permissions

```bash
# Add Microsoft Graph permissions
GRAPH_API_ID="00000003-0000-0000-c000-000000000000"
USER_READ_PERMISSION="e1fe6dd8-ba31-4d61-89e7-88639da4683d"  # User.Read

az ad app permission add \
  --id $CLIENT_ID \
  --api $GRAPH_API_ID \
  --api-permissions "$USER_READ_PERMISSION=Scope"

# Grant admin consent (if you're admin)
az ad app permission admin-consent --id $CLIENT_ID
```

**Note:** Organizations may require their admins to grant consent when they first use your app.

### A.6 Step 3: Install MSAL in React Application

```bash
cd /path/to/learn-wings

# Install MSAL packages
npm install @azure/msal-react @azure/msal-browser
```

### A.7 Step 4: Create MSAL Configuration

Create `src/integrations/msal/config.ts`:

```typescript
import { Configuration, LogLevel } from "@azure/msal-browser";

/**
 * MSAL configuration for multi-tenant authentication
 * Supports any Azure AD organization (AzureADMultipleOrgs)
 */
export const msalConfig: Configuration = {
  auth: {
    clientId: import.meta.env.VITE_ENTRAID_CLIENT_ID,
    authority: "https://login.microsoftonline.com/common", // Multi-tenant
    redirectUri: window.location.origin + "/auth/callback",
    postLogoutRedirectUri: window.location.origin,
    navigateToLoginRequestUrl: false,
  },
  cache: {
    cacheLocation: "localStorage", // or "sessionStorage"
    storeAuthStateInCookie: false, // Set to true for IE11 or Edge
  },
  system: {
    loggerOptions: {
      loggerCallback: (level, message, containsPii) => {
        if (containsPii) return;
        switch (level) {
          case LogLevel.Error:
            console.error(message);
            return;
          case LogLevel.Warning:
            console.warn(message);
            return;
          default:
            return;
        }
      },
    },
  },
};

/**
 * Scopes for login request
 */
export const loginRequest = {
  scopes: ["openid", "profile", "email", "User.Read"],
};

/**
 * Scopes for acquiring tokens silently
 */
export const tokenRequest = {
  scopes: ["openid", "profile", "email"],
};
```

### A.8 Step 5: Create MSAL Provider Component

Create `src/integrations/msal/MsalProvider.tsx`:

```typescript
import { MsalProvider as BaseMsalProvider } from "@azure/msal-react";
import { PublicClientApplication } from "@azure/msal-browser";
import { msalConfig } from "./config";
import { ReactNode } from "react";

// Create MSAL instance
const msalInstance = new PublicClientApplication(msalConfig);

interface MsalProviderProps {
  children: ReactNode;
}

/**
 * MSAL Provider wrapper for the application
 */
export const MsalProvider = ({ children }: MsalProviderProps) => {
  return (
    <BaseMsalProvider instance={msalInstance}>
      {children}
    </BaseMsalProvider>
  );
};

export { msalInstance };
```

### A.9 Step 6: Create Authentication Hook

Create `src/hooks/useEntraIDAuth.ts`:

```typescript
import { useMsal } from "@azure/msal-react";
import { loginRequest } from "@/integrations/msal/config";
import { useCallback } from "react";

export interface EntraIDUser {
  id: string;
  email: string;
  name: string;
  tenantId: string;
}

/**
 * Hook for EntraID authentication
 */
export const useEntraIDAuth = () => {
  const { instance, accounts, inProgress } = useMsal();

  const isAuthenticated = accounts.length > 0;
  const account = accounts[0];

  /**
   * Sign in with popup
   */
  const signIn = useCallback(async () => {
    try {
      const response = await instance.loginPopup(loginRequest);
      return response;
    } catch (error) {
      console.error("Login failed:", error);
      throw error;
    }
  }, [instance]);

  /**
   * Sign in with redirect
   */
  const signInRedirect = useCallback(async () => {
    try {
      await instance.loginRedirect(loginRequest);
    } catch (error) {
      console.error("Login failed:", error);
      throw error;
    }
  }, [instance]);

  /**
   * Sign out
   */
  const signOut = useCallback(async () => {
    try {
      await instance.logoutPopup({
        account: account,
        postLogoutRedirectUri: window.location.origin,
      });
    } catch (error) {
      console.error("Logout failed:", error);
      throw error;
    }
  }, [instance, account]);

  /**
   * Get access token silently
   */
  const getAccessToken = useCallback(async () => {
    if (!account) return null;

    try {
      const response = await instance.acquireTokenSilent({
        scopes: loginRequest.scopes,
        account: account,
      });
      return response.accessToken;
    } catch (error) {
      console.error("Silent token acquisition failed:", error);
      // Fallback to interactive
      const response = await instance.acquireTokenPopup({
        scopes: loginRequest.scopes,
        account: account,
      });
      return response.accessToken;
    }
  }, [instance, account]);

  /**
   * Get current user info
   */
  const getCurrentUser = useCallback((): EntraIDUser | null => {
    if (!account) return null;

    return {
      id: account.localAccountId,
      email: account.username,
      name: account.name || account.username,
      tenantId: account.tenantId,
    };
  }, [account]);

  return {
    isAuthenticated,
    isLoading: inProgress !== "none",
    signIn,
    signInRedirect,
    signOut,
    getAccessToken,
    getCurrentUser,
    account,
  };
};
```

### A.10 Step 7: Update App.tsx to Include MSAL Provider

Update `src/App.tsx`:

```typescript
import { MsalProvider } from "@/integrations/msal/MsalProvider";
// ... other imports

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Sonner />
      <BrowserRouter>
        <MsalProvider>  {/* Add MSAL Provider */}
          <AuthProvider>
            <PlatformSettingsProvider>
              <AppRoutes />
            </PlatformSettingsProvider>
          </AuthProvider>
        </MsalProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
```

### A.11 Step 8: Create Azure Function for Token Exchange

The Azure Function validates the EntraID token and exchanges it for a session in your database.

Create `supabase/functions/entraid-auth/index.ts`:

```typescript
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

interface TokenPayload {
  oid: string;  // Object ID (user ID in Azure AD)
  email: string;
  name: string;
  tid: string;  // Tenant ID
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*' } });
  }

  try {
    const { accessToken } = await req.json();

    // Validate token with Microsoft
    const graphResponse = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    });

    if (!graphResponse.ok) {
      return new Response(
        JSON.stringify({ error: 'Invalid token' }),
        { status: 401 }
      );
    }

    const userData = await graphResponse.json();

    // Create or update user in PostgreSQL
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Check if user exists
    const { data: existingProfile, error: profileError } = await supabase
      .from('profiles')
      .select('id')
      .eq('entraid_oid', userData.id)
      .single();

    let userId: string;

    if (existingProfile) {
      userId = existingProfile.id;
    } else {
      // Create new user in auth.users (requires service role)
      const { data: newUser, error: authError } = await supabase.auth.admin.createUser({
        email: userData.mail || userData.userPrincipalName,
        email_confirm: true,
        user_metadata: {
          full_name: userData.displayName,
          entraid_oid: userData.id,
          entraid_tenant: userData.tenantId || 'unknown',
        },
      });

      if (authError || !newUser.user) {
        throw authError;
      }

      userId = newUser.user.id;

      // Profile is auto-created via trigger, update with EntraID info
      await supabase
        .from('profiles')
        .update({
          entraid_oid: userData.id,
          entraid_tenant: userData.tenantId || 'unknown',
        })
        .eq('id', userId);
    }

    // Generate session token
    const { data: session, error: sessionError } = await supabase.auth.admin.generateLink({
      type: 'magiclink',
      email: userData.mail || userData.userPrincipalName,
    });

    if (sessionError) {
      throw sessionError;
    }

    return new Response(
      JSON.stringify({
        userId,
        session: session,
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  } catch (error) {
    console.error('EntraID auth error:', error);
    return new Response(
      JSON.stringify({ error: 'Authentication failed' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
});
```

**Security Note:** This function uses the service role key to create users. Ensure it's properly secured and only accessible to authenticated clients.

### A.12 Step 9: Update Database Schema

Add EntraID-specific columns to the profiles table:

```sql
-- Add columns for EntraID integration
ALTER TABLE public.profiles
ADD COLUMN entraid_oid TEXT UNIQUE,
ADD COLUMN entraid_tenant TEXT,
ADD COLUMN last_entraid_login TIMESTAMPTZ;

-- Create index for faster lookups
CREATE INDEX idx_profiles_entraid_oid ON public.profiles(entraid_oid);

-- Create migration file
-- supabase/migrations/20260415000000_add_entraid_support.sql
```

### A.13 Step 10: Update Environment Variables

Add to `.env`:

```bash
# EntraID Configuration
VITE_ENTRAID_CLIENT_ID=<your-client-id-from-step-A.4>
VITE_ENTRAID_ENABLED=true
```

Add to GitHub Secrets:

```
ENTRAID_CLIENT_ID=<your-client-id>
ENTRAID_CLIENT_SECRET=<your-client-secret>
```

### A.14 Step 11: Create Login Options Component

Create `src/components/auth/EntraIDLoginButton.tsx`:

```typescript
import { Button } from "@/components/ui/button";
import { useEntraIDAuth } from "@/hooks/useEntraIDAuth";
import { Loader2 } from "lucide-react";

export const EntraIDLoginButton = () => {
  const { signIn, isLoading } = useEntraIDAuth();

  const handleLogin = async () => {
    try {
      await signIn();
      // Token exchange happens in useEffect or callback
    } catch (error) {
      console.error("Login failed:", error);
    }
  };

  return (
    <Button
      onClick={handleLogin}
      disabled={isLoading}
      variant="outline"
      className="w-full"
    >
      {isLoading ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Signing in...
        </>
      ) : (
        <>
          <svg className="mr-2 h-5 w-5" viewBox="0 0 21 21">
            {/* Microsoft logo SVG */}
            <rect x="1" y="1" width="9" height="9" fill="#f25022"/>
            <rect x="11" y="1" width="9" height="9" fill="#7fba00"/>
            <rect x="1" y="11" width="9" height="9" fill="#00a4ef"/>
            <rect x="11" y="11" width="9" height="9" fill="#ffb900"/>
          </svg>
          Sign in with Microsoft
        </>
      )}
    </Button>
  );
};
```

Update `src/pages/Login.tsx` to include the EntraID option:

```typescript
import { EntraIDLoginButton } from "@/components/auth/EntraIDLoginButton";

// In your Login component JSX:
<div className="space-y-4">
  {import.meta.env.VITE_ENTRAID_ENABLED === 'true' && (
    <>
      <EntraIDLoginButton />
      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-background px-2 text-muted-foreground">
            Or continue with email
          </span>
        </div>
      </div>
    </>
  )}
  {/* Existing email/password form */}
</div>
```

### A.15 Step 12: Testing Multi-Tenant Authentication

#### Test with Personal Microsoft Account

1. Navigate to login page
2. Click "Sign in with Microsoft"
3. Use a Microsoft account (outlook.com, hotmail.com)
4. Verify user is created in database

#### Test with Organizational Account

1. Use a work/school account (@yourcompany.com)
2. Admin consent may be required on first use
3. Verify tenant ID is captured

#### Test Tenant Restrictions (Optional)

If you want to restrict to specific tenants:

```typescript
// In src/hooks/useEntraIDAuth.ts
const ALLOWED_TENANTS = [
  'tenant-id-1',
  'tenant-id-2',
  'common', // Allow all
];

const getCurrentUser = useCallback((): EntraIDUser | null => {
  if (!account) return null;

  // Check tenant restriction
  if (!ALLOWED_TENANTS.includes(account.tenantId) && !ALLOWED_TENANTS.includes('common')) {
    throw new Error('Your organization is not authorized to use this application');
  }

  return {
    id: account.localAccountId,
    email: account.username,
    name: account.name || account.username,
    tenantId: account.tenantId,
  };
}, [account]);
```

### A.16 Impact on Existing Tutorial Sections

#### Section 5.5 (PostgreSQL Setup)

**Added:**
- Run migration for EntraID columns
- Update RLS policies to support EntraID users

```sql
-- Add to RLS policies (example)
CREATE POLICY "EntraID users can view their own profile"
  ON public.profiles FOR SELECT
  USING (id = auth.uid() OR entraid_oid = current_setting('request.jwt.claims', true)::json->>'entraid_oid');
```

#### Section 5.8 (Azure Functions)

**Added:**
- Deploy `entraid-auth` function
- Configure CORS for Microsoft login endpoints
- Add Microsoft Graph API endpoint to allowed origins

#### Section 6.2 (GitHub Actions)

**Added:**
- Include EntraID client secret in GitHub Secrets
- Update workflow to set VITE_ENTRAID_CLIENT_ID

```yaml
# In build step
env:
  VITE_SUPABASE_URL: ${{ secrets.VITE_SUPABASE_URL }}
  VITE_SUPABASE_PUBLISHABLE_KEY: ${{ secrets.VITE_SUPABASE_PUBLISHABLE_KEY }}
  VITE_ENTRAID_CLIENT_ID: ${{ secrets.ENTRAID_CLIENT_ID }}  # Added
  VITE_ENTRAID_ENABLED: 'true'  # Added
```

#### Section 7.3 (CORS Settings)

**Added:**
- Allow `https://login.microsoftonline.com` in CORS
- Allow `https://graph.microsoft.com` for token validation

```bash
az functionapp cors add \
  --name $FUNCTION_APP_NAME \
  --resource-group $RESOURCE_GROUP \
  --allowed-origins \
    "https://$STATIC_APP_URL" \
    "https://login.microsoftonline.com"
```

#### Section 8.5 (Testing)

**Added:**
- [ ] User can sign in with Microsoft account
- [ ] User can sign in with organizational account
- [ ] Admin consent workflow works for first-time org users
- [ ] Tenant ID is properly recorded
- [ ] EntraID users have correct permissions (RLS policies)

### A.17 Best Practices for Production

1. **Incremental Rollout:**
   - Deploy EntraID auth alongside existing Supabase auth
   - Use feature flags to control availability
   - Monitor adoption before making required

2. **User Migration:**
   - Allow users to link existing accounts to EntraID
   - Provide clear communication about changes
   - Maintain backward compatibility

3. **Monitoring:**
   - Track EntraID authentication success/failure rates
   - Monitor Microsoft Graph API latency
   - Alert on admin consent rejections

4. **Security:**
   - Rotate client secrets every 90 days
   - Monitor for unusual tenant patterns
   - Implement rate limiting on token exchange endpoint

5. **Compliance:**
   - Document data flows for GDPR/privacy reviews
   - Ensure tenant admins can disable access
   - Provide data export/deletion mechanisms

### A.18 Troubleshooting EntraID Integration

#### "AADSTS50105: The signed in user is not assigned to a role"

**Solution:** Configure optional claims or remove role requirement

```bash
# Make app available to all users in tenant
az ad app update --id $CLIENT_ID --set "appRoles=[]"
```

#### Token validation fails

**Solution:** Check clock skew and token lifetime

```typescript
// In msalConfig
system: {
  tokenRenewalOffsetSeconds: 300, // Renew 5 minutes before expiry
}
```

#### "AADSTS65001: User or administrator has not consented"

**Solution:** Provide admin consent URL to tenant admin

```
https://login.microsoftonline.com/{tenant}/adminconsent?client_id={client_id}
```

### A.19 Additional Resources

**Microsoft Documentation:**
- [MSAL.js Documentation](https://learn.microsoft.com/en-us/azure/active-directory/develop/msal-overview)
- [Multi-tenant Applications](https://learn.microsoft.com/en-us/azure/active-directory/develop/howto-convert-app-to-be-multi-tenant)
- [Microsoft Graph API](https://learn.microsoft.com/en-us/graph/overview)

**Sample Code:**
- [MSAL React Samples](https://github.com/AzureAD/microsoft-authentication-library-for-js/tree/dev/samples/msal-react-samples)
- [Multi-tenant B2B App Sample](https://github.com/Azure-Samples/ms-identity-javascript-react-tutorial/tree/main/3-Authorization-II/1-call-api)

**Community Resources:**
- [Stack Overflow - MSAL.js Tag](https://stackoverflow.com/questions/tagged/msal.js)
- [Microsoft Q&A - Azure AD](https://learn.microsoft.com/en-us/answers/tags/170/azure-active-directory)

---

## Conclusion

This tutorial provides a complete, MECE (Mutually Exclusive, Collectively Exhaustive) guide for deploying the learn-wings LMS to Microsoft Azure. By following these steps in order, junior DevOps engineers can successfully:

1. ✅ Understand the application architecture
2. ✅ Map components to appropriate Azure services
3. ✅ Deploy infrastructure in the correct dependency order
4. ✅ Configure CI/CD pipelines for automated deployments
5. ✅ Implement monitoring and operations
6. ✅ Optimize for cost and performance
7. ✅ Integrate enterprise authentication with EntraID

**Next Steps:**
- Customize the tutorial for your specific organization
- Set up staging and development environments
- Implement disaster recovery procedures
- Plan for scalability as user base grows

**Support:**
For issues or questions, refer to the Azure documentation links throughout this guide or engage with the Azure community.

---

**Document Version:** 1.0
**Last Updated:** 2026-04-15
**Maintained By:** DevOps Team
**License:** Internal Use Only
