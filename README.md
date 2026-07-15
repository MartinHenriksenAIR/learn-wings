# learn-wings

A multi-tenant **B2B learning-management platform** for AI education and EU AI-Act compliance training. Organizations enroll their staff in courses (lessons, quizzes, certificates), generate compliance reports, and collaborate through a community feed, an ideas board, and a shared resource library. Production domain: **ai-uddannelse.dk** ("AI Uddannelse" — _AI Education_).

> **Status — MVP on `main`.** The app was originally built in [Lovable](https://lovable.dev) on Supabase and has completed a rip-and-replace migration onto a fully owned Azure stack (June 2026). `main` is the production branch: it takes changes only via pull requests, and every merge deploys both the frontend and the backend. The backlog lives in GitHub issues.

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

Architecture decisions are recorded in **[`docs/adr/`](docs/adr/)** (ADR-0001 … ADR-0015) — read them before structural changes.

## How it fits together

```
Browser (React SPA, src/)
   │   MSAL acquires an Entra access token
   ▼
callApi()  ──────────────────────────────►  src/lib/api-client.ts
   │   POST /api/<endpoint>  (Authorization: Bearer <token>)
   ▼
Azure Function  ─────────────────────────►  functions/<name>/index.ts  (×~100)
   │   the envelope is owned by endpoint()/adminEndpoint() in functions/shared/endpoint.ts
   │   (ADR-0015; a handful of hand-rolled exceptions), leaning on 4 shared helpers:
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
| `migration/` | `STATUS.html` (live ledger), `WORKLOG.md` (append-only history) |
| `docs/adr/` | The 15 architecture decision records |
| `.claude/` | Agent collaboration system — `rules/` (hard-won conventions), `skills/` (`pickup`/`handoff`/`slice-workflow`), `collab.json` (branch topology), and the `guard-trunk` hook |
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
| [`docs/adr/`](docs/adr/) | The 15 architecture decision records (what is and isn't allowed). |
| [`AGENTS.md`](AGENTS.md) | Agent + contributor instructions. |
| [`migration/azure/README.md`](migration/azure/README.md) | The Supabase→Azure schema port: what was stripped, added, ported, and flagged. |
| [`.claude/rules/`](.claude/rules/) | Frontend and backend conventions. |

## Collaboration & deployment

This is a two-developer repo with a strict workflow: **`main` takes changes only via pull requests** (enforced by a server-side ruleset), work happens on short-lived `<firstname>/<issue#>-<slug>` branches, and a draft PR is the claim on an issue. CI ([`ci.yml`](.github/workflows/ci.yml)) must be green before merge: frontend lint + typecheck + tests + build, and functions build + tests. **Deploys go only from `main` after a merge** — every merge deploys automatically (the Static Web Apps workflow ships the frontend and builds a preview environment per PR; the functions workflow ships the backend), never from work branches. The full playbook is in [`AGENTS.md`](AGENTS.md) and the `.claude/skills/` (`pickup`, `handoff`, `slice-workflow`).
