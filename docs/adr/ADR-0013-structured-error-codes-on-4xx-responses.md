---
id: "ADR-0013"
title: "Structured Error Codes on 4xx Responses"
status: accepted
date: 2026-06-12
deciders: ['emkataumre']
tags: ['backend', 'api-contract', 'frontend', 'error-handling']
policy:
  rationales: ['Frontend logic must match on the machine-readable code field, never the English error sentence', 'Error codes are SCREAMING_SNAKE_CASE string literals; the human-readable error field remains required and free to be reworded']
approval_date: 2026-06-12
approval_notes: "Introduced by issue #50 after OrganizationsManager broke encapsulation by exact-matching the backend's English 'Slug already in use' sentence. First code: DUPLICATE_SLUG."

---

## Context

Backend 4xx error responses carried only a human-readable English sentence: `{ error: string }`. Frontend code that needed to branch on a specific failure had no choice but to exact-match the sentence — `OrganizationsManager.handleCreate` matched `err.message === 'Slug already in use'` to show an inline field error on the slug input. Rewording the backend message (or localizing it) silently breaks that branch: the user gets a generic destructive toast instead of the inline hint. As the API grows more recoverable 4xx cases (duplicates, quota limits, state conflicts), more frontend branches will need a stable contract to match on.

## Decision

4xx error bodies MAY carry an optional machine-readable code alongside the required human-readable message: `{ error: string, code?: string }`.

- `error` stays required and remains the human-readable sentence. It may be reworded freely; nothing programmatic may depend on its exact text.
- `code` is an optional SCREAMING_SNAKE_CASE string literal identifying the failure case. Once shipped, a code is a contract: never renamed or reused with a different meaning.
- Frontend branching on a specific failure MUST match on `code` (via `ApiError.code` thrown by `src/lib/api-client.ts` `callApi`), never on the `error` text.
- Codes are added only where the frontend (or another machine consumer) actually branches on the failure — not on every 4xx.

Registered codes:

| Code | Status | Returned by | Meaning |
| --- | --- | --- | --- |
| `DUPLICATE_SLUG` | 409 | `organization-create`, `organization-update` | Organization slug already taken (Postgres unique_violation on the slug UNIQUE constraint) |

Relatedly, the hand-rolled Postgres `23505` checks at call sites collapse into `isUniqueViolation(err)` in `functions/shared/db.ts`.

## Consequences

Positive: Backend error copy can be reworded or localized without breaking frontend behavior. Existing matchers on `error` keep working — the shape change is purely additive. New recoverable failure cases get a stable, greppable identifier. Negative: A small registry discipline is required — new codes must be added to the table above so they stay discoverable and are never reused with different semantics.

## Alternatives

1. Keep matching on the English sentence — rejected: it is the bug this ADR fixes; any copy edit silently breaks UX. 2. Numeric or namespaced error codes (e.g. `ORG_409_001`) — rejected: opaque, harder to grep, no added value at this scale. 3. Required `code` on every 4xx — rejected for now: most 4xx responses have no machine consumer; mandating codes everywhere adds churn without benefit. Can be revisited if consumers multiply.
