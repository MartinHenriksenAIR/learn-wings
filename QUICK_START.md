# Azure Deployment Quick Start

This is a condensed quick-start guide. For complete details, see [AZURE_DEPLOYMENT_GUIDE.md](./AZURE_DEPLOYMENT_GUIDE.md).

## Prerequisites Checklist

- [ ] Azure CLI installed (`az --version`)
- [ ] Node.js 20+ installed (`node --version`)
- [ ] Docker Desktop running
- [ ] PostgreSQL client tools (`psql --version`)
- [ ] Azure subscription with Contributor role
- [ ] Repository cloned locally

## 30-Minute Setup (Development)

### 1. Set Variables (2 min)

```bash
# Customize these values
export RESOURCE_GROUP="rg-learnwings-dev"
export LOCATION="eastus"
export KEYVAULT_NAME="kv-learnwings-dev-$(openssl rand -hex 3)"
export DB_SERVER_NAME="psql-learnwings-dev-$(openssl rand -hex 3)"
export STORAGE_ACCOUNT_NAME="stlearnwingsdev$(openssl rand -hex 3)"
export FUNCTION_APP_NAME="func-learnwings-dev"
export STATIC_APP_NAME="stapp-learnwings-dev"
```

### 2. Login and Create Resource Group (1 min)

```bash
az login
az group create --name $RESOURCE_GROUP --location $LOCATION
```

### 3. Create Key Vault (2 min)

```bash
az keyvault create \
  --name $KEYVAULT_NAME \
  --resource-group $RESOURCE_GROUP \
  --location $LOCATION \
  --enable-rbac-authorization true
```

### 4. Create Database (5 min)

```bash
# Generate secure password
DB_PASSWORD="$(openssl rand -base64 32)"

# Store in Key Vault
az keyvault secret set \
  --vault-name $KEYVAULT_NAME \
  --name "postgresql-admin-password" \
  --value "$DB_PASSWORD"

# Create PostgreSQL server (this takes ~5 minutes)
az postgres flexible-server create \
  --name $DB_SERVER_NAME \
  --resource-group $RESOURCE_GROUP \
  --location $LOCATION \
  --admin-user learnwingsadmin \
  --admin-password "$DB_PASSWORD" \
  --sku-name Standard_B2s \
  --tier Burstable \
  --version 15 \
  --storage-size 32 \
  --public-access All
```

### 5. Run Migrations (2 min)

```bash
# Get connection info
DB_HOST=$(az postgres flexible-server show \
  --resource-group $RESOURCE_GROUP \
  --name $DB_SERVER_NAME \
  --query "fullyQualifiedDomainName" -o tsv)

# Connect and run migrations
export PGHOST="$DB_HOST"
export PGUSER="learnwingsadmin"
export PGPASSWORD="$DB_PASSWORD"
export PGDATABASE="postgres"
export PGSSLMODE="require"

# Create database
psql -c "CREATE DATABASE learnwings;"

# Run migrations
export PGDATABASE="learnwings"
for migration in supabase/migrations/*.sql; do
  echo "Running: $migration"
  psql -f "$migration"
done
```

### 6. Create Blob Storage (3 min)

```bash
# Create storage account
az storage account create \
  --name $STORAGE_ACCOUNT_NAME \
  --resource-group $RESOURCE_GROUP \
  --location $LOCATION \
  --sku Standard_LRS \
  --kind StorageV2

# Get key
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
  --name lms-videos \
  --account-name $STORAGE_ACCOUNT_NAME \
  --account-key "$STORAGE_KEY"

az storage container create \
  --name lms-documents \
  --account-name $STORAGE_ACCOUNT_NAME \
  --account-key "$STORAGE_KEY"
```

### 7. Create Static Web App (3 min)

```bash
az staticwebapp create \
  --name $STATIC_APP_NAME \
  --resource-group $RESOURCE_GROUP \
  --location $LOCATION

# Get deployment token
DEPLOYMENT_TOKEN=$(az staticwebapp secrets list \
  --name $STATIC_APP_NAME \
  --resource-group $RESOURCE_GROUP \
  --query "properties.apiKey" -o tsv)

echo "Save this token for GitHub: $DEPLOYMENT_TOKEN"
```

### 8. Deploy Frontend (5 min)

```bash
# Build locally
cd /path/to/learn-wings
npm install
npm run build

# Get Static Web App URL
STATIC_URL=$(az staticwebapp show \
  --name $STATIC_APP_NAME \
  --resource-group $RESOURCE_GROUP \
  --query "defaultHostname" -o tsv)

echo "Your app will be available at: https://$STATIC_URL"

# Add GitHub secret and push to trigger deployment
# Or use Azure CLI to deploy
az staticwebapp deploy \
  --name $STATIC_APP_NAME \
  --resource-group $RESOURCE_GROUP \
  --source dist
```

### 9. Summary of Created Resources

```bash
echo "=== Azure Resources Created ==="
echo "Resource Group: $RESOURCE_GROUP"
echo "Key Vault: $KEYVAULT_NAME"
echo "Database: $DB_SERVER_NAME"
echo "Storage: $STORAGE_ACCOUNT_NAME"
echo "Static Web App: $STATIC_APP_NAME"
echo "App URL: https://$STATIC_URL"
echo ""
echo "Next: Configure GitHub Actions with DEPLOYMENT_TOKEN"
```

## Quick GitHub Actions Setup

### 1. Add GitHub Secrets

Go to: `https://github.com/YOUR-USERNAME/learn-wings/settings/secrets/actions`

Add these secrets:

```
AZURE_STATIC_WEB_APPS_API_TOKEN=<$DEPLOYMENT_TOKEN from above>
PGHOST=<$DB_HOST>
PGUSER=learnwingsadmin
PGPASSWORD=<$DB_PASSWORD>
PGDATABASE=learnwings
AZURE_STORAGE_ACCOUNT_NAME=<$STORAGE_ACCOUNT_NAME>
AZURE_STORAGE_ACCOUNT_KEY=<$STORAGE_KEY>
VITE_SUPABASE_URL=https://<your-function-url>
VITE_SUPABASE_PUBLISHABLE_KEY=<your-anon-key>
```

### 2. Use Provided Workflow

The workflow in [AZURE_DEPLOYMENT_GUIDE.md](./AZURE_DEPLOYMENT_GUIDE.md) Section 6.2 is ready to use.

Copy it to `.github/workflows/azure-deploy.yml` and push to trigger deployment.

## Common Issues & Quick Fixes

### Issue: "Database connection refused"

```bash
# Add your IP to firewall
MY_IP=$(curl -s ifconfig.me)
az postgres flexible-server firewall-rule create \
  --resource-group $RESOURCE_GROUP \
  --name $DB_SERVER_NAME \
  --rule-name "MyIP" \
  --start-ip-address $MY_IP \
  --end-ip-address $MY_IP
```

### Issue: "Storage upload fails"

```bash
# Check CORS
az storage cors add \
  --services b \
  --methods GET POST PUT \
  --origins "*" \
  --account-name $STORAGE_ACCOUNT_NAME
```

### Issue: "Static Web App shows blank page"

```bash
# Check deployment logs
az staticwebapp show \
  --name $STATIC_APP_NAME \
  --resource-group $RESOURCE_GROUP
```

## Production Deployment Differences

For production, upgrade:

1. **Database**: Use `Standard_D2ds_v4` with `--high-availability Enabled`
2. **Static Web App**: Use `--sku Standard` tier
3. **Functions**: Add Azure Functions (see full guide Section 5.8)
4. **Networking**: Add VNet with subnets (see full guide Section 5.4)
5. **Monitoring**: Add Application Insights (see full guide Section 5.12)

## Cost Estimate

Development setup: **~$50-80/month**
- PostgreSQL Burstable B2s: ~$25
- Blob Storage (100GB): ~$5
- Static Web Apps Standard (includes CDN): ~$9
- Misc (Key Vault, bandwidth): ~$10-40

Production setup: **~$300-550/month**
- With high availability and Premium Functions
- **Includes built-in global CDN at no extra cost**
- No need for separate CDN service ($420/month savings vs Azure Front Door)

See [AZURE_DEPLOYMENT_GUIDE.md](./AZURE_DEPLOYMENT_GUIDE.md) Section 11 for full cost breakdown.

## Next Steps

1. ✅ Complete this quick start
2. 📖 Read full guide for production setup
3. 🔒 Review security configuration (Section 5)
4. 📊 Set up monitoring (Section 9)
5. 🔄 Configure CI/CD (Section 6)
6. 🔐 Add EntraID auth (Appendix A)

## Getting Help

- **Full Documentation**: See [AZURE_DEPLOYMENT_GUIDE.md](./AZURE_DEPLOYMENT_GUIDE.md)
- **Azure Support**: https://portal.azure.com/#blade/Microsoft_Azure_Support/HelpAndSupportBlade
- **Azure Status**: https://status.azure.com/
- **Community**: Stack Overflow tag: `azure`

## Clean Up (Delete Everything)

⚠️ **Warning**: This deletes all resources and data!

```bash
az group delete --name $RESOURCE_GROUP --yes --no-wait
```

---

**Time to Complete**: 30 minutes (mostly waiting for database creation)
**Difficulty**: Beginner-friendly
**Cost**: ~$2-3 for testing (delete within 24 hours)
