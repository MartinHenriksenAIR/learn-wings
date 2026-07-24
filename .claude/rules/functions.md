---
paths:
  - "functions/**"
---

# Azure Functions conventions (hard-won — see WORKLOG Slice 0)

- **New endpoints MUST use `endpoint()` / `adminEndpoint()` from `functions/shared/endpoint.ts`** (ADR-0015). The factory owns the whole HTTP envelope — origin/CORS, OPTIONS→204, authenticate→getProfile→401, the platform-admin 403 gate (`adminEndpoint`), `AuthError`→401, the generic-500 catch, and the `app.http` registration. The ~8 hand-rolled endpoints that remain are deliberate exceptions, each with a pointer comment stating why (grep `app.http(` for the list).
- **Every new function MUST be imported in the `functions/index.ts` barrel** (`main: dist/index.js`) — an unimported function silently never registers. Enforced by the fleet guard `functions/registration-names.test.ts` (route↔folder parity, uniqueness, reserved prefixes, barrel cross-check).
- **No module-load-time side effects that can throw** (e.g. `new Resend(env)` at top level) — they crash the worker entry and deregister ALL functions. Initialize lazily inside handlers.
- **Function/route names may NOT start with `admin`, `runtime`, or `host`** (reserved prefixes; also pinned by the fleet guard). Use suffix style if admin scoping is needed (e.g. a hypothetical `user-actions` folder would register as `user-actions-admin`). Deviations must be listed in `KNOWN_DEVIATIONS` in `registration-names.test.ts`.
- **Identity/authz:** reach for the factory's ctx helpers first — `ctx.requireOrgAdmin(orgId)` / `ctx.requireActiveMember(orgId)` / `ctx.requirePlatformAdmin()` encode the suite convention that platform admins bypass org-membership checks, and throw `Reply(403, { error: 'Forbidden' })` on denial (custom 403 body: `throw new Reply(403, {...})` yourself). Bare probes: `functions/shared/profile.ts` (`getProfile`, `isActiveMember`, `isOrgAdmin`). Never trust client-supplied user ids. Authz parity derives from the original RLS policies in `supabase/migrations/`.
- **Pinned versions:** `@azure/functions` exactly `4.5.0` (4.14 fails the worker handshake); runtime is Node `~20` (`WEBSITE_NODE_DEFAULT_VERSION` — Node 22 crashes gRPC). Don't bump without re-verifying registration.
- **Tests:** mock contract tests per endpoint (`*/index.test.ts`): happy path + 401/403 authz + key errors. Mock `shared/auth`, `shared/db`, `shared/profile`; NEVER touch a real DB. Run: `cd functions && npm test`.
- **500 responses are generic (ADR-0014):** the factory already routes unexpected exceptions through `internalError(context, origin, err)` from `functions/shared/errors.ts`; hand-rolled catch paths must do the same. Never put exception-derived text in a 500 body (CWE-209). Deliberate 4xx messages (validation 400s, `AuthError → 401 { error: err.message }`) are caller-facing contracts and stay as-is.
