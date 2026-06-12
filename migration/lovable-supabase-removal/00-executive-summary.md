# 00 — Executive Summary

## Target State
Zero Supabase dependency. Zero Lovable dependency. Application runs entirely on Azure-native services.

## Confirmed Current State
The application is a Vite/React SPA (TypeScript) hosted on Azure Static Web Apps. It uses:
- **Supabase Auth** for identity and session management (JWT issued by `cairuxpyfshugwjrrqha.supabase.co`)
- **Supabase PostgreSQL** as the application database (RLS-protected via Supabase RLS policies)
- **10 Supabase Deno Edge Functions** for all privileged server-side operations
- **`@supabase/supabase-js` v2.93.1** as a runtime dependency
- **`lovable-tagger` v1.1.13** as a dev/build dependency
- **Azure Blob Storage** (already in use) via `staieducationmigration` for video/document blobs
- **Azure Function App** (`func-ai-education-migration`, Node 22) already provisioned but empty of app logic
- **Azure PostgreSQL Flexible Server** (`psql-ai-education-migration`) already provisioned but separate from Supabase DB

Lovable appears only as:
- CORS allowlisted origins in 7 of 10 edge functions
- Invite link domain allowlist in `send-invitation-email`
- A build plugin (`lovable-tagger`) in `vite.config.ts` and `package.json`
- Documentation links in `README.md`
- The `.lovable/plan.md` config file

## Highest-Risk Dependencies

| Risk | Dependency | Why Critical |
|------|-----------|-------------|
| **CRITICAL** | Supabase Auth (JWT issuer) | All 10 edge functions verify Supabase-issued JWTs. Replacing auth requires choosing a new identity provider, re-issuing tokens, updating all 10 function auth checks, and updating the frontend auth context. |
| **CRITICAL** | Supabase PostgreSQL + RLS | The database schema, RLS policies, RPC functions (`can_user_access_lms_asset`, `user_can_access_quiz`), and `supabase/migrations/` are all Supabase-specific. Azure PostgreSQL exists but needs schema migration. |
| **HIGH** | `@supabase/supabase-js` SDK | Used for auth state, session management, and all 12 edge function call sites in the frontend. |
| **HIGH** | `generate-certificate` / `generate-compliance-report` | Server-side PDF generation — must remain server-side. |
| **HIGH** | Azure SAS token generation (4 functions) | Secrets (`AZURE_STORAGE_ACCOUNT_KEY`) must stay server-side. |
| **MEDIUM** | Lovable CORS origins | Blocking current non-Lovable clients. Must be replaced with production domain. |
| **MEDIUM** | `send-invitation-email` invite domain allowlist | Still lists Lovable domains though frontend now uses `ai-uddannelse.dk`. Dead but must be cleaned. |
| **LOW** | `lovable-tagger` build plugin | Dev-only, no runtime effect. Easy to remove. |
| **LOW** | README/doc references | No runtime impact. |

## Recommended Migration Sequence

**Phase 1 — Auth Foundation (BLOCKER for everything else)**
1. Decide on replacement auth provider (Azure AD B2C recommended, or custom JWT on Azure Functions).
2. Migrate user identities from Supabase Auth to new provider.
3. Provision auth infrastructure in Azure.

**Phase 2 — Database Migration**
4. Migrate Supabase PostgreSQL schema to Azure PostgreSQL Flexible Server.
5. Migrate RLS logic to application-layer authorization in Azure Functions.
6. Migrate RPC functions (`can_user_access_lms_asset`, `user_can_access_quiz`) to PostgreSQL stored procedures or inline logic.
7. Data migration from Supabase to Azure PostgreSQL.

**Phase 3 — Function Replacement (parallel after Phase 2)**
8. Implement all 10 replacement endpoints in `func-ai-education-migration`.
9. Add required app settings to Function App (Key Vault references for secrets).
10. Update CORS on Function App to production domain only.

**Phase 4 — Frontend Update**
11. Replace `@supabase/supabase-js` with Azure auth SDK / direct API calls.
12. Update all 12 edge function call sites to new Azure Function endpoints.
13. Remove `lovable-tagger` from `package.json` and `vite.config.ts`.
14. Update invite domain allowlist in `send-invitation-email` replacement.

**Phase 5 — Cleanup**
15. Remove `supabase/` directory entirely.
16. Remove `.env` Supabase vars.
17. Remove `.lovable/` directory.
18. Update README and documentation.

## Azure Changes Not Executed
This document is planning-only. No Azure resources were modified.

## Confidence Rating
- Evidence completeness: **HIGH** — all 10 functions read fully, all 12 call sites verified
- Azure discovery: **MEDIUM** — resource list complete; Key Vault secret names inaccessible (network unreachable from local machine, likely private endpoint)
- Auth replacement decision: **NOT MADE** — requires human decision (see 10-open-questions.md)
- Database migration complexity: **HIGH RISK** — Supabase RLS + RPCs require careful translation

**Overall plan readiness: BLOCKED on auth and database migration decisions.** The 10 function replacements can be fully specified once the auth/DB decisions are made.
