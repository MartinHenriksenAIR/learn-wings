# learn-wings

A multi-tenant **B2B learning-management platform** for AI education and EU AI-Act compliance training. Organizations enroll their staff in courses (lessons, quizzes, certificates), generate compliance reports, and collaborate through a community feed, an ideas board, and a shared resource library. Production domain: **ai-uddannelse.dk** ("AI Uddannelse" — _AI Education_).

> **Status — actively migrating, not yet in production.** The app was originally built in [Lovable](https://lovable.dev) on Supabase and is ~95% through a rip-and-replace migration onto a fully owned Azure stack. All current work lives on the **`feature/lovable-migration`** branch behind draft **PR #6**; `main` is the (still-untouched) production target. The single source of truth for current state is **[`migration/STATUS.html`](migration/STATUS.html)** — _not_ this README. The path to the production cutover is tracked in issue **#69 ("Road to merge")**.

---

## What it is

Three roles, one app:

- **Learner** — takes assigned courses, completes lessons + quizzes, earns certificates, participates in the community and ideas board.
- **Org admin** — manages their organization's members and invitations, course access, analytics, moderation, and AI-Act compliance reports.
- **Platform admin** — manages all organizations, authors courses, and configures the platform. Can switch "view mode" to act as an org-admin or learner without logging out.

Everything is **org-scoped**: data belongs to an organization, and members see only their organization's slice. The UI is available in **English and Danish**.

## Tech stack

| Layer | Choice |
|-------|--------|
| Frontend | React 18 + Vite SPA · TypeScript · shadcn/ui (Radix) + Tailwind · TanStack Query v5 · react-router-dom v6 · i18next |
| Auth | Microsoft **Entra ID** (multi-tenant) via MSAL — corporate SSO, no passwords stored |
| Backend | ~100 **Azure Functions** (v4, Node 20), one folder per endpoint, raw `pg` |
| Database | Azure **PostgreSQL** 15 (Flexible Server) — authorization in app code (no RLS) |
| Storage | Azure **Blob Storage** + short-lived SAS tokens for protected lesson assets |
| Email | **Resend** (transactional invitations) |
| Hosting | Azure **Static Web Apps** (frontend) + Azure Functions (API) |

Active architecture decisions live in **[`docs/orientation/CONTEXT.md`](docs/orientation/CONTEXT.md)** (the decisions log) — read it before structural changes. The original 12 ADRs in [`docs/adr/`](docs/adr/) are archived history.

## How it fits together

```
Browser (React SPA, src/)
   │   MSAL acquires an Entra access token
   ▼
callApi()  ──────────────────────────────►  src/lib/api-client.ts
   │   POST /api/<endpoint>  (Authorization: Bearer <token>)
   ▼
Azure Function  ─────────────────────────►  functions/<name>/index.ts  (×~100)
   │   every handler follows the same skeleton, leaning on 4 shared helpers:
   │     authenticate()  verify the Entra JWT            functions/shared/auth.ts
   │     getProfile()    Entra identity → DB profile     functions/shared/profile.ts
   │                     + isActiveMember / isOrgAdmin    (authorization lives HERE)
   │     query()         parameterized SQL, pooled        functions/shared/db.ts
   │     corsResponse()  CORS headers                     functions/shared/cors.ts
   ▼
Azure PostgreSQL 15  (~30 tables, all org-scoped, ON DELETE CASCADE)
```

There is **no row-level security** — the Supabase RLS was stripped, so **every permission check is enforced by hand in the function code**. The canonical schema and the full record of what was ported/dropped from Supabase live in **[`migration/azure/README.md`](migration/azure/README.md)**.

## Repository layout

| Path | What's there |
|------|--------------|
| `src/` | Frontend SPA — `pages/` (by role), `components/`, `hooks/useAuth.tsx`, `lib/` (api-client, types, msal-config) |
| `functions/` | ~100 Azure Functions (one folder each) + `shared/` (auth, db, profile, cors) + `index.ts` barrel |
| `migration/azure/` | The canonical Postgres schema (`01-schema.sql`), seed data (`02-seed.sql`), and apply guide |
| `migration/` | `STATUS.html` (live ledger), `WORKLOG.md` (append-only history), `lovable-supabase-removal/` (planning) |
| `docs/orientation/` | The durable orientation core (`CONTEXT.md`) + the generated `/orient` digest. Active decisions live here. |
| `docs/adr/` | The 12 original ADRs — **archived** history; superseded by the orientation core's decisions log |
| `.claude/` | Agent collaboration system — `rules/` (hard-won conventions), `skills/`, `collab.json` |
| `supabase/` | **Dead** — the original Supabase Deno functions + migrations, kept only as authz-provenance reference. Deleted in the final migration slice (#13). |

## Local development

**Prerequisites:** Node.js **20** (the functions runtime is pinned to ~20; Node 22 crashes the Functions gRPC worker), npm, and — for the backend — the [Azure Functions Core Tools](https://learn.microsoft.com/azure/azure-functions/functions-run-local) and access to a PostgreSQL database.

### Frontend

```sh
npm install
cp .env.example .env        # then fill in the values (see below)
npm run dev                 # Vite dev server with HMR
```

Environment variables (see [`.env.example`](.env.example)) — all `VITE_`-prefixed and **browser-bundled, so never put secrets here** (ADR-0010):

| Var | Purpose |
|-----|---------|
| `VITE_ENTRA_CLIENT_ID` | Your Entra app-registration client id (drives MSAL config + API scope) |
| `VITE_API_BASE_URL` | Base URL for the Functions API. Empty string `""` = same-origin `/api` |
| `VITE_REDIRECT_URI` | Entra redirect URI (optional; defaults to `window.location.origin`) |
| `VITE_STORAGE_BASE_URL` | Base URL for public blob assets (e.g. email logo) |

### Backend (Azure Functions)

```sh
cd functions
npm install
# create local.settings.json with DATABASE_URL, ENTRA_CLIENT_ID, ALLOWED_ORIGINS,
# the Azure Storage account/key (SAS), and RESEND_API_KEY — secrets, never committed.
npm start                   # func start — serves the API on http://localhost:7071/api
npm test                    # vitest contract tests (mocked auth/db — never hits a real DB)
```

Every function must be imported in **`functions/index.ts`** or it silently never registers. See [`.claude/rules/functions.md`](.claude/rules/functions.md) for the full backend conventions.

### Database

The schema is a single plain-SQL file — no migration tool. Apply it to a fresh Postgres database, then seed:

```sh
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migration/azure/01-schema.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migration/azure/02-seed.sql
```

Full apply options (including a Node runner that mirrors the functions' `pg` client) and how to **elevate your own profile to platform admin** after first login are in [`migration/azure/README.md`](migration/azure/README.md).

## Testing & quality gates

```sh
npm test                                  # frontend unit tests (vitest)
npm run build                             # production build must succeed
npx tsc --noEmit -p tsconfig.app.json     # type-check (exit 0)
cd functions && npm test                  # backend contract tests
```

## Conventions & where to look

The hard-won rules that keep this codebase stable are codified — read them before contributing:

- **[`AGENTS.md`](AGENTS.md)** — the single source of truth for all coding agents (and humans): session start, workflow, collaboration rules, safety constraints. `CLAUDE.md` just imports it.
- **[`.claude/rules/frontend.md`](.claude/rules/frontend.md)** & **[`.claude/rules/functions.md`](.claude/rules/functions.md)** — frontend and backend conventions, including the two most-hit bug classes:
  - Ownership checks use **`profile.id`** (the DB UUID), never **`user.id`** (the Entra OID) — they never match.
  - Role guards must wait for the user-context fetch to resolve, or they bounce authorized users (the auth-bootstrap seam).

## Documentation map

| Doc | What it is |
|-----|------------|
| [`migration/STATUS.html`](migration/STATUS.html) | **Live ledger** — current checkpoint, operational quirks, pointers. Authoritative. |
| [`migration/WORKLOG.md`](migration/WORKLOG.md) | Append-only history of every merged change. |
| [`docs/orientation/CONTEXT.md`](docs/orientation/CONTEXT.md) | The durable orientation core — current focus, component map, **active decisions log**. Run `/orient` to merge it with live state into a digest. |
| [`docs/adr/`](docs/adr/) | The 12 original ADRs — archived history (superseded by the core's decisions log). |
| [`AGENTS.md`](AGENTS.md) | Agent + contributor instructions. |
| [`migration/azure/README.md`](migration/azure/README.md) | The Supabase→Azure schema port: what was stripped, added, ported, and flagged. |
| [`AZURE_DEPLOYMENT_GUIDE.md`](AZURE_DEPLOYMENT_GUIDE.md) | Reference Azure deployment guide. |

> Note: a few root-level docs from early 2026 (`QUICK_START.md`, `DEPLOYMENT_SUMMARY.md`) predate the current vertical-slice migration plan and describe a since-abandoned approach. Treat `STATUS.html`, `docs/orientation/CONTEXT.md`, and `migration/azure/README.md` as authoritative (the ADRs are archived).

## Collaboration & deployment

This is a two-developer repo with a strict workflow: **the trunk takes changes only via pull requests**, work happens on short-lived `<firstname>/<issue#>-<slug>` branches, and a draft PR is the claim on an issue. **Deploys go only from fresh trunk after a merge**, never from work branches (shared function app / DB / preview). The full playbook — including the 5-gate Definition of Done for migration slices — is in [`AGENTS.md`](AGENTS.md) and the `.claude/skills/` (`pickup`, `handoff`, `slice-workflow`).
