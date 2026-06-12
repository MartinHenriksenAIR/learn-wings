---
id: "ADR-0012"
title: "Auth stub pattern — SAS functions deferred until Task 9 JWKS validation"
status: accepted
date: 2026-05-20
deciders: ['dawid@ai-raadgivning.dk']
tags: ['auth', 'azure-functions', 'testing', 'deployment-gate']
policy:
  boundaries: {'rules': [{'forbid': 'shared/auth.ts stub -> production traffic before Task 9'}]}
  rationales: ['stub throws for real tokens to prevent accidental permissive auth', '_mockUser injection is the only test contract until JWKS lands']
---

## Context

Tasks 1–8 implement four Azure Blob SAS functions (azure-upload-url, azure-view-url, azure-delete-blob, azure-document-upload-url) that all call authenticate(req) from shared/auth.ts. Real multi-tenant Entra ID JWKS validation (jwks-rsa + jsonwebtoken) is not implemented until Task 9. Shipping the four functions with a real validator would block all testing progress; shipping them with a permissive stub would be a security hole. A deliberate throwing stub is the correct intermediate state.

## Decision

shared/auth.ts is a deliberate stub until Task 9 completes. The stub throws 'Token validation not yet implemented' for any real Bearer token. For unit tests, inject a mock user via (req as any)._mockUser = { id: string, email: string } on the request object before calling the handler — the stub returns this mock user without validating any token. Don't replace the stub with a permissive implementation (e.g. returning a hardcoded user without checking _mockUser). Don't deploy the four SAS functions to production until Task 9 lands and shared/auth.ts is replaced by real JWKS validation. The stub is superseded by ADR-0005 implementation details once Task 9 is complete.

## Consequences

Positive: all four SAS functions are fully testable in isolation without a real Entra ID token. Test pattern is consistent — every function test sets _mockUser before calling the handler. Negative: the four SAS endpoints return 401 for every real request until Task 9 is deployed. CI will deploy the functions on merge to main — they must not receive production traffic until Task 9 is also deployed. Deployment gate: Task 9 (shared/auth.ts JWKS replacement) must be merged and deployed before the four SAS functions are wired to the frontend.

## Alternatives

1. Deploy with permissive stub (return hardcoded user) — rejected: security hole, any request would be treated as admin. 2. Block Task 8 until Task 9 is complete — rejected: unnecessarily serialises independent work. 3. Feature-flag the functions — rejected: adds complexity for a short-lived intermediate state.
