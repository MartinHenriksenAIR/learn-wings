---
id: "ADR-0015"
title: "Shared Endpoint Envelope Factory"
status: accepted
date: 2026-07-15
deciders: ['emkataumre']
tags: ['backend', 'azure-functions', 'architecture', 'api-contract', 'error-handling']
policy:
  rationales: ['New endpoints are declared via endpoint()/adminEndpoint() from functions/shared/endpoint.ts — the factory owns the HTTP envelope and the app.http registration', 'The factory has a frozen dependency set (shared auth/profile/cors/errors only) so endpoint contract tests keep mocking exactly those module names', 'Hand-rolled endpoints are deliberate, enumerated exceptions, each carrying a one-line pointer comment explaining why it is off the factory']
approval_date: 2026-07-15
approval_notes: "Introduced by the cleanup branch (PR #129): factory extracted, 90 endpoints migrated in verified batches with per-endpoint contract tests unchanged, shared/guards.ts retired, runtime parity proven byte-identical (285/285 unauthenticated envelope probes, old vs new hosts)."

---

## Context

Every one of ~100 Azure Functions hand-rolled the same ~20-line HTTP envelope: read the `origin` header, answer `OPTIONS` with a CORS 204, `authenticate(req)`, `getProfile(user)` → 401 when missing, an optional platform-admin 403 gate, `AuthError` → 401, a generic-exception catch, and the trailing `app.http(...)` registration. A hundred copies meant a hundred chances to drift, and four bug classes recurred across the fleet: (1) functions that silently never registered (missing barrel import or a route/folder mismatch); (2) 500 bodies leaking exception-derived text until the ADR-0014 sweep (CWE-209); (3) authz drift — admin gates placed after body parsing, or the suite-wide platform-admin-bypass convention re-implemented inconsistently per endpoint; (4) CORS/OPTIONS ordering mistakes. Any cross-cutting envelope change (ADR-0014 being the canonical example) was a ~100-file sweep.

## Decision

The HTTP envelope is a deep module: `functions/shared/endpoint.ts` exports `endpoint(name, run)` and `adminEndpoint(name, run, opts?)`, which absorb the entire envelope — origin extraction, OPTIONS→204 preflight before any auth work, authenticate → getProfile → 401, the platform-admin 403 gate (`adminEndpoint`, before `run` and therefore before body parsing), `AuthError` → 401, the ADR-0014 constant-500 catch, and the `app.http` registration. Handlers receive an `AuthedCtx` (`req`, `context`, `origin`, `user`, `profile`, `reply()`, `requireOrgAdmin()`, `requireActiveMember()`, `requirePlatformAdmin()`); the authz helpers encode the platform-admin-bypass convention and throw `Reply(403, { error: 'Forbidden' })` on denial — `Reply` is a control-flow exit, never logged and never routed to `internalError`; custom 403 bodies use `throw new Reply(403, {...})` in the endpoint.

- **What stays per-endpoint:** body parsing (the factory never touches the request body), validation, SQL, deliberate 4xx contracts, and the endpoint's own contract tests.
- **Dependency freeze:** the module may only call `shared/auth`, `shared/profile`, `shared/cors`, and `shared/errors`. Endpoint tests mock exactly those module names; any new dependency (in particular anything from `shared/db`) is a breaking change to every migrated endpoint's tests and requires revisiting this ADR.
- **Hand-rolled exceptions:** endpoints whose contract genuinely doesn't fit stay hand-rolled — first-login profile provisioning (`user-context`), binary PDF responses with token-only auth (the two generators), bespoke email/SMTP authz and response shapes, and legacy oid-only identity lookups pending normalization. Each carries a one-line pointer comment; grep `app.http(` under `functions/` for the current list (8 at time of writing).

## Consequences

Positive: New endpoints MUST be declared via the factory (rule in `.claude/rules/functions.md`), so the envelope can no longer drift per-file. Cross-cutting envelope changes (a new header, a logging hook, the next ADR-0014-class fix) are one-file edits instead of ~100-file sweeps. The fleet guard `functions/registration-names.test.ts` pins route↔folder parity, route uniqueness, reserved prefixes, the barrel cross-check, and folder-must-have-index — the silent-non-registration bug class is now test-caught. `shared/guards.ts` is retired. Negative: the factory is a single point of failure — a bug in it breaks every migrated endpoint at once (mitigated by its own unit tests, 90 endpoints' unchanged contract tests, and the byte-identical parity verification done at migration time). The hand-rolled list must be actively shrunk (or its pointer comments kept honest) or it becomes a second, undocumented convention.

## Alternatives

1. Keep hand-rolling with review discipline — rejected: a hundred copies had already drifted four distinct ways; discipline demonstrably did not hold. 2. Express/Hono-style pluggable middleware chains — rejected: more flexibility than the suite needs, and configurable ordering reintroduces exactly the per-endpoint variance the factory eliminates; a fixed pipeline with two entry points is the deeper module. 3. Force the remaining 8 hand-rolled endpoints through the factory too — deferred, not rejected: each needs a contract or identity-normalization decision first (e.g. GET support, binary bodies, 200-on-failure diagnostics), and forcing them now would change caller-visible behavior.
