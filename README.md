# learn-wings

A multi-tenant **B2B learning-management platform** for AI education and EU AI-Act compliance training. Organizations enroll their staff in courses (lessons, quizzes, certificates), generate compliance reports, and collaborate through a community feed, an ideas board, and a shared resource library. Production domain: **ai-uddannelse.dk** ("AI Uddannelse" — _AI Education_).

The app was originally built in [Lovable](https://lovable.dev) on Supabase and has completed a rip-and-replace migration onto a fully owned Azure stack. `main` is the production branch: it takes changes only via pull request, and every merge deploys. The backlog lives in GitHub issues.

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
| Backend | **Azure Functions** (v4, Node 20), one folder per endpoint, raw `pg` |
| Database | Azure **PostgreSQL** 15 (Flexible Server) — authorization in app code (no RLS) |
| Storage | Azure **Blob Storage** + short-lived SAS tokens for protected lesson assets |
| Email | **Resend** (transactional invitations) |
| Hosting | Azure **Static Web Apps** (frontend) + Azure Functions (API) |

## How it fits together

```
Browser (React SPA, src/)
   │   MSAL acquires an Entra access token
   ▼
callApi()  ──────────────────────────────►  src/lib/api-client.ts
   │   POST /api/<endpoint>  (Authorization: Bearer <token>)
   ▼
Azure Function  ─────────────────────────►  functions/<name>/index.ts
   │   the envelope is owned by endpoint()/adminEndpoint() in functions/shared/endpoint.ts
   │   (ADR-0015; a handful of hand-rolled exceptions), leaning on functions/shared/:
   │     authenticate()  verify the Entra JWT            functions/shared/auth.ts
   │     getProfile()    Entra identity → DB profile     functions/shared/profile.ts
   │                     + isActiveMember / isOrgAdmin    (authorization lives HERE)
   │     query()         parameterized SQL, pooled        functions/shared/db.ts
   ▼
Azure PostgreSQL 15  (org-scoped tables, ON DELETE CASCADE)
```

There is **no row-level security** — the Supabase RLS was stripped, so **every permission check is enforced by hand in the function code**.

## Repository layout

| Path | What's there |
|------|--------------|
| `src/` | Frontend SPA — `pages/` (by role), `components/`, `hooks/useAuth.tsx`, `lib/` (api-client, types, msal-config) |
| `functions/` | One folder per Azure Function + `shared/` (`endpoint`, `auth`, `db`, `profile`, `cors`, `errors`, …) + the `index.ts` barrel |
| `migration/azure/` | The canonical Postgres schema, seed data, and apply guide |
| `migration/STATUS.html` | Live ledger — current checkpoint and operational quirks. Read it first. |
| `docs/adr/` | Architecture decision records — read before structural changes |
| `docs/glossary.md` | Canonical en/da terminology for user-facing copy |
| `.claude/` | `rules/` (per-tree conventions), `skills/` (`pickup`/`handoff`), `collab.json` (branch topology) |
| `supabase/` | **Dead** — the original Supabase SQL migrations, kept only as provenance for the RLS policies the hand-written authz checks replaced. |

## Local development

**Prerequisites:** Node.js **20** (the functions runtime is pinned to ~20; Node 22 crashes the Functions gRPC worker), npm, and — for the backend — the [Azure Functions Core Tools](https://learn.microsoft.com/azure/azure-functions/functions-run-local) and access to a PostgreSQL database.

### Frontend

```sh
npm install
cp .env.example .env        # then fill in the values
npm run dev                 # Vite dev server with HMR
```

All frontend vars are `VITE_`-prefixed and **browser-bundled, so never put secrets there** (ADR-0010). `.env.example` documents each one.

### Backend (Azure Functions)

```sh
cd functions
npm install
# create local.settings.json with DATABASE_URL, ENTRA_CLIENT_ID, ALLOWED_ORIGINS,
# the Azure Storage account/key (SAS), and RESEND_API_KEY — secrets, never committed.
npm start                   # func start — serves the API on http://localhost:7071/api
```

Every function must be imported in **`functions/index.ts`** or it silently never registers. See [`.claude/rules/functions.md`](.claude/rules/functions.md) for the backend conventions.

### Database

A single plain-SQL file, no migration tool — apply it to a fresh Postgres database, then seed:

```sh
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migration/azure/01-schema.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migration/azure/02-seed.sql
```

[`migration/azure/README.md`](migration/azure/README.md) covers the migration convention and how to elevate your own profile to platform admin after first login.

## Verification gates

```sh
npm run lint
npm test                                  # frontend unit tests (vitest)
npx tsc --noEmit -p tsconfig.app.json     # app tree
npx tsc --noEmit -p tsconfig.node.json    # tooling + e2e tree
npm run build
cd functions && npm run build && npm test # backend contract tests (mocked auth/db)
```

All of them must exit 0 before a PR; CI runs the same set. `npm run e2e` drives the deployed app with a real login and real writes — on demand only, never a CI gate ([`e2e/README.md`](e2e/README.md)).

## Conventions

- **[`AGENTS.md`](AGENTS.md)** — the operating rules for contributors and coding agents: session start, workflow, collaboration, safety constraints. `CLAUDE.md` just imports it.
- **[`.claude/rules/frontend.md`](.claude/rules/frontend.md)** & **[`.claude/rules/functions.md`](.claude/rules/functions.md)** — per-tree conventions, including the two most-hit bug classes:
  - Ownership checks use **`profile.id`** (the DB UUID), never **`user.id`** (the Entra OID) — they never match.
  - Role guards must wait for the user-context fetch to resolve, or they bounce authorized users.

`main` takes changes only via pull request (server-side ruleset); work happens on short-lived branches with a draft PR opened early. Merging to `main` deploys both tiers automatically — never deploy from a work branch. The full playbook is in [`AGENTS.md`](AGENTS.md).
