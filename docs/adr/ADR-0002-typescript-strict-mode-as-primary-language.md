---
id: "ADR-0002"
title: "TypeScript Strict Mode as Primary Language"
status: accepted
date: 2026-05-19
deciders: ['le-dawg']
tags: ['language', 'typescript', 'tooling']
policy:
  imports: {'disallow': [], 'prefer': ['typescript']}
  rationales: ['TypeScript strict mode required for all source; no plain JS in src/ or functions/']approval_date: 2026-05-19
approval_notes: "Baseline approval"

---

## Context

The codebase spans frontend (React components, hooks, pages) and backend (Azure Functions). Type safety is critical for a multi-role platform where data contracts between frontend and backend must be consistent. Supabase generated typed clients; the Azure migration must maintain equivalent type coverage.

## Decision

Use TypeScript with strict mode enabled (strict: true in tsconfig.json) for all source files — frontend (.tsx/.ts) and backend Azure Functions (.ts). Don't write plain JavaScript files in src/ or functions/. Don't disable strict mode or add @ts-ignore suppressions except in documented migration stubs.

## Consequences

Positive: Catches null/undefined errors at compile time, self-documenting function signatures, Supabase/Azure SDK types enforced. Negative: Slightly higher onboarding friction, migration stubs may need temporary type casts during Supabase removal.

## Alternatives

1. JavaScript with JSDoc — rejected: insufficient IDE tooling and runtime error surface too large for multi-role auth flows. 2. TypeScript without strict mode — rejected: nullability bugs in auth/data layers are production risks.
