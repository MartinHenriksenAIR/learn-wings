---
paths:
  - "functions/**"
---

# Azure Functions conventions (hard-won)

- **Every new function MUST be imported in the `functions/index.ts` barrel** (`main: dist/index.js`). An unimported function silently never registers.
- **No module-load-time side effects that can throw** (e.g. `new Resend(env)` at top level) — they crash the worker entry and deregister ALL functions. Initialize lazily inside handlers.
- **Function/route names may NOT start with `admin`, `runtime`, or `host`** (reserved prefixes). Use suffix style: `user-actions-admin`, `course-admin`.
- **Identity/authz:** use `functions/shared/profile.ts` — `getProfile(entra_oid+entra_tid)`, `isActiveMember`, `isOrgAdmin`. Never trust client-supplied user ids; platform admins bypass org-membership checks by suite convention. Authz parity derives from the original RLS policies in `supabase/migrations/`.
- **Pinned versions:** `@azure/functions` exactly `4.5.0` (4.14 fails the worker handshake); runtime is Node `~20` (`WEBSITE_NODE_DEFAULT_VERSION` — Node 22 crashes gRPC). Don't bump without re-verifying registration.
- **Tests:** mock contract tests per endpoint (`*/index.test.ts`): happy path + 401/403 authz + key errors. Mock `shared/auth`, `shared/db`, `shared/profile`; NEVER touch a real DB. Run: `cd functions && npm test`.
- **500 responses are generic (ADR-0014):** route every generic-exception catch path through `internalError(context, origin, err)` from `functions/shared/errors.ts` — it logs the real error (message + stack) on the invocation context and returns the constant body `{ error: 'Internal server error' }`. Never put exception-derived text in a 500 body (CWE-209). Deliberate 4xx messages (validation 400s, `AuthError → 401 { error: err.message }`) are caller-facing contracts and stay as-is.
