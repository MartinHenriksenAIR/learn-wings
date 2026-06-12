# Migration: Lovable + Supabase Removal

**Status:** Planning artifact — READ ONLY. No Azure resources or source files were modified.

## Target State
- Zero Supabase dependency (auth, DB, edge functions, SDK, env vars, CORS, documentation)
- Zero Lovable dependency (runtime host, CORS origins, invite domains, build plugins, documentation)

## Artifacts

| File | Purpose |
|------|---------|
| [00-executive-summary.md](00-executive-summary.md) | Target state, risks, sequence, confidence |
| [01-evidence-ledger.md](01-evidence-ledger.md) | Every Supabase/Lovable reference found, classified |
| [02-codebase-discovery.md](02-codebase-discovery.md) | Repository search results, all areas inspected |
| [03-azure-discovery.md](03-azure-discovery.md) | Azure resource inventory for ai-education RG |
| [04-function-migration-matrix.md](04-function-migration-matrix.md) | Per-function contract + migration decision |
| [05-replacement-architecture.md](05-replacement-architecture.md) | Proposed replacement architecture |
| [06-proposed-code-changes.md](06-proposed-code-changes.md) | File-by-file code change plan |
| [07-proposed-azure-changes.md](07-proposed-azure-changes.md) | Azure resource changes required |
| [proposed-iac/](proposed-iac/) | Draft CLI commands — DRAFT ONLY, DO NOT RUN |
| [08-test-strategy.md](08-test-strategy.md) | Test plan proving behavioral equivalence |
| [09-validation-report.md](09-validation-report.md) | Readiness checks and acceptance criteria |
| [rollback.md](rollback.md) | Rollback instructions |
| [10-open-questions.md](10-open-questions.md) | Blockers requiring human decision |
| [patches/](patches/) | Proposed diff patches — NOT applied |

## Critical Facts
- Supabase project ID: `cairuxpyfshugwjrrqha`
- All 10 Supabase edge functions confirmed live
- Azure Function App already exists: `func-ai-education-migration` (Node 22, Sweden Central)
- Azure PostgreSQL Flexible Server exists: `psql-ai-education-migration` (Sweden Central)
- Azure Storage Account exists: `staieducationmigration` (Sweden Central)
- Static Web App: `stapp-ai-education-migration` → `black-forest-0d7f96c03.7.azurestaticapps.net`
- **Blocker**: Supabase Auth is used for identity — requires separate auth migration decision

## Non-Destructive Confirmation
No application source files were modified.
No Azure resources were modified, created, or deleted.
No secrets were printed (env var names recorded only).
