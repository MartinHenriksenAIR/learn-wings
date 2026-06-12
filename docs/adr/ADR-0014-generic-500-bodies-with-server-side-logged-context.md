---
id: "ADR-0014"
title: "Generic 500 Bodies with Server-Side Logged Context"
status: accepted
date: 2026-06-12
deciders: ['emkataumre']
tags: ['backend', 'api-contract', 'security', 'error-handling']
policy:
  rationales: ['500 responses carry the constant body { error: "Internal server error" } — never exception-derived text (CWE-209)', 'The real error (message + stack) is logged server-side via context.error() in the shared internalError() helper before the generic body is returned']
approval_date: 2026-06-12
approval_notes: "Introduced by issue #25. Replaces the migration-era convention of propagating err.message in 500 bodies, which leaked schema names, driver errors, and connection details to any caller."

---

## Context

Every handler's generic catch block propagated the exception message to the caller: `corsResponse(origin, 500, { error: err.message })`. A failing query therefore leaked Postgres relation names, FK constraint names, connection strings/hosts, and driver internals to anyone who could trigger a server error — classic CWE-209 (Generation of Error Message Containing Sensitive Information). The contract tests pinned this behavior (asserting the raw message in the 500 body), so the leak was self-perpetuating: new endpoints copied the suite pattern. `.claude/rules/functions.md` tracked this as a known hardening gap awaiting an ADR.

## Decision

Unexpected-exception 500 responses are generic and constant; the real error is logged server-side.

- All handler catch blocks route their generic-exception path through `internalError(context, origin, err)` in `functions/shared/errors.ts`. The helper logs the error message and stack via the invocation context's `context.error(...)` (surfacing in Application Insights), then returns `corsResponse(origin, 500, { error: 'Internal server error' })`.
- **Scope: 500s only.** Deliberate 4xx contracts are unaffected: validation messages (400), authz denials (403), and the `AuthError → 401 { error: err.message }` convention remain as-is — those messages are written for callers, not exception propagation. The SAS endpoints' token-message → 401 routing and `test-smtp-connection`'s 200 diagnostic body (an admin-only connectivity tester whose purpose is reporting the failure) are likewise deliberate contracts.
- No exception-derived text may appear in any 500 body. Static, intentionally written 500 messages (e.g. `'Blob delete failed'`) are permitted but discouraged; prefer the helper unless the message is genuinely caller-actionable.
- Contract tests assert the generic body on 500 paths and pass a context with a mockable `error` fn; representative tests (plus the helper's own unit tests) assert the real error was logged.

## Consequences

Positive: internal details (schema, infrastructure, dependency internals) no longer reach callers; operators keep full fidelity via context logging; the frontend already treats 500s as opaque failures, so no UI change. ADR-0013's `code` field stays available if a machine-readable 5xx discriminator is ever needed. Negative: debugging from the client side alone is no longer possible — you must read the function logs; tests that previously asserted specific 500 messages can no longer distinguish failure causes through the response body.

## Alternatives

1. Keep propagating `err.message` — rejected: it is the CWE-209 vulnerability this ADR fixes. 2. Include a correlation/request id in the 500 body — deferred: Azure Functions already correlates logs by invocation id; can be added later without breaking the generic-body contract. 3. Sanitize messages with an allowlist/denylist — rejected: enumeration of "safe" substrings is fragile; a constant body cannot leak.
