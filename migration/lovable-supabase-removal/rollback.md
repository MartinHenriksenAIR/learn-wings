# Rollback Instructions

**This document describes how to revert to the Supabase/Lovable-based state.**
**Execute only if migration causes a production incident.**
**No secrets are included in this document.**

---

## Pre-Migration State to Preserve

Before executing any migration step, take these snapshots:

1. **Git tag the current state:**
   ```bash
   git tag pre-supabase-migration-$(date +%Y%m%d)
   git push origin --tags
   ```

2. **Export Supabase project state:**
   - Download current database schema from Supabase Dashboard → Database → Schema
   - Download all table data exports if needed
   - Note the Supabase project ref: `cairuxpyfshugwjrrqha`

3. **Record current Azure Function App settings** (names only, not values):
   ```bash
   az functionapp config appsettings list --name func-ai-education-migration --resource-group AI-Education --output table > migration/lovable-supabase-removal/pre-migration-func-settings.txt
   ```

4. **Record current Static Web App settings** (names only):
   ```bash
   az staticwebapp appsettings list --name stapp-ai-education-migration --resource-group AI-Education --output table > migration/lovable-supabase-removal/pre-migration-swa-settings.txt
   ```

---

## Rollback: Frontend

**Scenario:** New Azure Function call sites fail; users cannot access the app.

**Steps:**
1. Revert `package.json` to restore `@supabase/supabase-js` and `lovable-tagger`
2. Restore `src/integrations/supabase/client.ts` (from git history: `git show pre-supabase-migration-YYYYMMDD:src/integrations/supabase/client.ts > src/integrations/supabase/client.ts`)
3. Restore `src/integrations/supabase/types.ts` from git history
4. Revert all 12 call sites to `supabase.functions.invoke` (from git history)
5. Restore `vite.config.ts` with `lovable-tagger`
6. Restore `.env` with `VITE_SUPABASE_*` vars
7. Rebuild and redeploy SWA:
   ```bash
   npm install
   npm run build
   # push to trigger CI/CD or redeploy manually
   ```

**Validation:** Verify users can log in and call sites return data.

---

## Rollback: Azure Function App

**Scenario:** Replacement Azure Functions produce incorrect results or are unreachable.

**Steps:**
1. Remove newly-added app settings that break auth/DB:
   ```bash
   # DO NOT RUN without identifying which settings cause the issue
   az functionapp config appsettings delete \
     --name func-ai-education-migration \
     --resource-group AI-Education \
     --setting-names DATABASE_URL RESEND_API_KEY AZURE_STORAGE_ACCOUNT_KEY
   ```
2. Remove replacement function code from repo if deployed
3. Restore old Azure Function App settings from pre-migration snapshot

**Note:** Supabase edge functions remain live during migration. Rolling back means the frontend reverts to using Supabase endpoints.

---

## Rollback: Supabase Edge Functions

**The Supabase edge functions must NOT be deleted until migration is verified in production.**

If Supabase functions are accidentally decommissioned:
1. Redeploy from `supabase/functions/` directory:
   ```bash
   supabase functions deploy grade-quiz --project-ref cairuxpyfshugwjrrqha
   supabase functions deploy generate-certificate --project-ref cairuxpyfshugwjrrqha
   # ... repeat for all 10 functions
   ```
2. Verify env secrets are still set in Supabase dashboard:
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`
   - `RESEND_API_KEY`
   - `AZURE_STORAGE_ACCOUNT_NAME`, `AZURE_STORAGE_ACCOUNT_KEY`
   - `AZURE_STORAGE_CONTAINER_NAME`

---

## Rollback: Database

**Scenario:** Azure PostgreSQL migration fails or produces incorrect data.

**Steps:**
1. Do not delete Supabase project during migration
2. Re-point application to Supabase PostgreSQL by restoring `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`
3. Azure PostgreSQL data can be cleared and re-migrated

---

## Old Endpoint/Config to Restore if Needed

| Component | Old Value / State | How to Restore |
|-----------|-----------------|---------------|
| Supabase URL | `https://cairuxpyfshugwjrrqha.supabase.co` | Restore `.env`, SWA app settings |
| Supabase Anon Key name | `VITE_SUPABASE_PUBLISHABLE_KEY` | Restore from git history |
| Edge Function base | `${VITE_SUPABASE_URL}/functions/v1/` | Restore raw fetch call sites |
| CORS (edge functions) | Lovable + ai-uddannelse.dk origins | Restore from supabase/ directory |
| Invite link allowlist | Lovable domains + ai-uddannelse.dk | Restore send-invitation-email source |
| Build plugin | `lovable-tagger` in vite.config.ts | Restore from git history |

---

## Rollback Validation Steps

After rollback:
1. Load the application and verify the browser console has no 401/403/404 errors on function calls
2. Test quiz grading in CoursePlayer
3. Test certificate download from Dashboard
4. Test video upload in admin CourseEditor
5. Test video playback in CoursePlayer
6. Test delete-user in UserDetailDialog (admin only)
7. Test send-invitation-email flow
8. Test compliance report download in OrgAnalytics
9. Test SMTP connection in PlatformSettings (admin only)
10. Verify no Supabase connection errors in browser console

---

## Key Constraint
Do not decommission Supabase project (`cairuxpyfshugwjrrqha`) until all of the following are true:
- All 10 Azure Function replacements are deployed and passing contract tests
- All 12 frontend call sites have been updated and tested
- Auth migration is complete and all users can log in
- Database migration is complete with verified data integrity
- No error rates in Application Insights for at least 72 hours post-migration
