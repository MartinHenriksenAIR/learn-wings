# 09 — Validation Report

## Checks Performed

### Repository Searches
| Search | Coverage | Result |
|--------|---------|--------|
| `lovable` (all variants) | src/, supabase/, .github/, root files | 26 references found and classified |
| `supabase` (case-insensitive) | All above + package.json | 187+ references found and classified |
| `functions.invoke` | src/ | 10 call sites found |
| `/functions/v1` | src/ | 2 raw fetch call sites found |
| `VITE_SUPABASE_*` | All files | 3 env vars in .env, client.ts |
| `createClient` | src/, supabase/ | 6 function implementations |
| All 10 function names | src/ | All 12 call sites verified |
| `RESEND_API_KEY` | supabase/ | send-invitation-email only |
| `AZURE_STORAGE_ACCOUNT_*` | supabase/ | 4 functions |
| `can_user_access_lms_asset` | All | 3 references (migration SQL, function, types.ts) |
| `quiz_options.is_correct` | All | 4 references (migration, function, types.ts, front-end type) |
| `Deno.connect` / `Deno.connectTls` | supabase/ | test-smtp-connection only |
| `generateSasToken` / `generateReadSasToken` / `generateDeleteSasToken` | supabase/ | azure-upload-url, azure-view-url, azure-delete-blob, azure-document-upload-url |
| `supabase.(from\|rpc\|auth\|storage\|channel\|realtime)` | src/ | 30 additional call sites across 19 files (11 auth, 12 DB, 5 storage, 2 RPC) |
| `supabase\|lovable` (doc files) | AZURE_DEPLOYMENT_GUIDE.md, QUICK_START.md, DEPLOYMENT_SUMMARY.md | ~29 references in 3 doc files |
| lockfile grep | bun.lock, package-lock.json | 7+18 supabase refs, 2+27 lovable refs |

### Edge Functions Read
| Function | Source Read | Contract Extracted |
|----------|-----------|------------------|
| grade-quiz | ✅ Full source | ✅ Complete |
| generate-certificate | ✅ Full source | ✅ Complete |
| delete-user | ✅ Full source | ✅ Complete |
| send-invitation-email | ✅ Full source | ✅ Complete |
| azure-upload-url | ✅ Full source | ✅ Complete |
| azure-view-url | ✅ Full source | ✅ Complete |
| azure-delete-blob | ✅ Full source | ✅ Complete |
| generate-compliance-report | ✅ Full source | ✅ Complete |
| azure-document-upload-url | ✅ Full source | ✅ Complete |
| test-smtp-connection | ✅ Full source | ✅ Complete |

### Azure Read-Only Validation
| Check | Method | Result |
|-------|--------|--------|
| Resource group inventory | `az resource list` | Complete — 12 resources found |
| Function App app settings | `az functionapp config appsettings list` | Complete — no Supabase/Lovable found |
| Static Web App details | `az staticwebapp list` | Complete — no custom domain linked yet |
| Storage Account details | `az storage account show` | Partial — CORS inaccessible (private network) |
| Key Vault details | `az keyvault show` | Partial — secret names inaccessible (private network) |
| Function App host details | `az functionapp show` | Complete |

---

## Unresolved Conflicts

| Conflict | Severity | Resolution |
|----------|---------|-----------|
| DeepWiki claimed Lovable CORS on grade-quiz; reality is `*` wildcard | Low | Reality confirmed via full source read |
| DeepWiki claimed Lovable CORS on generate-compliance-report; reality is `*` wildcard | Low | Reality confirmed |
| test-smtp-connection has NO auth; DeepWiki didn't flag this | Medium | Must add auth gate in replacement |
| Key Vault secret names unknown | Medium | Requires VNet access to verify |
| Storage CORS unknown | Medium | Requires VNet access or Azure Portal |
| Supabase Auth migration approach | Critical | Human decision required — see open questions |
| Frontend direct SDK usage (supabase.auth/from/storage/rpc) not in initial search | Medium | Resolved: post-advisor grep found 30 call sites across 19 files; all now catalogued |
| patches/03-azure-functions-src.patch not created in initial pass | Low | Resolved: placeholder created; deferred because content depends on auth provider decision |

---

## Acceptance Criteria Pass/Fail

| # | Criterion | Status |
|---|-----------|--------|
| 1 | All 10 DeepWiki functions accounted for | ✅ PASS |
| 2 | Every DeepWiki call site verified (current/stale/moved/absent) | ✅ PASS — All 12 call sites confirmed current |
| 3 | Repository searched beyond DeepWiki paths | ✅ PASS — 11th function (seed-mock-users) found; send-invitation-email has 3 additional call contexts |
| 4 | Azure resource group ai-education inspected | ✅ PASS (partial — KV/storage private) |
| 5 | Every Supabase and Lovable reference classified | ✅ PASS — Updated: initial search missed 30 direct SDK call sites (supabase.auth/from/storage/rpc) across 19 files; now fully catalogued in 01-evidence-ledger.md §Frontend Direct SDK Usage |
| 6 | Every active runtime/config dependency has proposed action | ✅ PASS — Updated: 19 additional files now have proposed actions in 06-proposed-code-changes.md (convert supabase.auth to new auth provider, supabase.from to REST/function calls, supabase.storage to Azure Blob) |
| 7 | Every replacement preserves security-critical server-side behaviour | ✅ PASS |
| 8 | Every function has contract analysis | ✅ PASS |
| 9 | Every function has migration decision A/B/C/D/E | ✅ PASS |
| 10 | Every function has code/Azure/test/rollback entries | ✅ PASS |
| 11 | Active blockers distinguished from docs/dead-code cleanup | ✅ PASS |
| 12 | No app source files modified | ✅ PASS |
| 13 | No Azure resources modified | ✅ PASS |
| 14 | No secrets printed | ✅ PASS — env var names recorded, values redacted |
| 15 | No local emulators used | ✅ PASS |
| 16 | Artifact files exist under migration/lovable-supabase-removal/ | ✅ PASS |
| 17 | rollback.md exists as separate file | ✅ PASS |
| 18 | Proposed Azure changes separate from code changes | ✅ PASS |
| 19 | Proposed IaC/CLI artifacts separate and marked draft-only | ✅ PASS |
| 20 | Validation report states plan readiness | See below |

---

## Readiness Score

**Plan Readiness: BLOCKED — Not ready for implementation**

**Reason:** Two human decisions must be made before implementation can begin:

1. **Auth provider choice** (Critical): Which system replaces Supabase Auth? Until this is decided, none of the 10 replacement functions can be written (they all verify JWTs, and the JWT format depends on the auth provider).

2. **Database migration plan** (Critical): How will the Supabase PostgreSQL schema, RLS policies, RPCs, and data be migrated to Azure PostgreSQL? This affects every function that queries the database.

**Once those two decisions are made**, the plan is complete and implementation can begin immediately. All function contracts, call sites, Azure resources, secrets requirements, and test cases are fully specified.

**Estimated implementation complexity after decisions:**
- 10 Azure Functions: 2–4 weeks (can parallelize)
- Frontend updates: 1 week
- Database schema migration: 1–3 weeks (depends on RLS complexity)
- Auth migration: 1–3 weeks (depends on provider)
- Testing: 1–2 weeks
- Total: 6–12 weeks depending on team size and auth provider choice
