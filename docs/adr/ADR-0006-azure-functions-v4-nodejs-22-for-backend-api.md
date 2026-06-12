---
id: "ADR-0006"
title: "Azure Functions v4 (Node.js ~20) for Backend API"
status: accepted
date: 2026-05-19
deciders: ['le-dawg']
tags: ['backend', 'azure', 'functions', 'migration']
policy:
  imports: {'disallow': ['express', 'fastify', 'koa', 'hono', '@supabase/functions-js'], 'prefer': ['@azure/functions']}
  rationales: ['Azure Functions v4 on Node.js (pinned ~20) is the backend runtime; no Express servers or Supabase Edge Functions']
approval_date: 2026-05-19
approval_notes: "Baseline approval"

---

## Context

The original backend consisted of Supabase Edge Functions (Deno runtime). The migration requires replacing these with Azure-native compute. The backend handles: SAS token generation for blob storage, quiz grading, invitation email dispatch, compliance report generation, PDF certificate generation, and user-context (first-login provisioning). All functions are short-lived request handlers with no persistent state.

## Decision

Use Azure Functions v4 programming model with the Node.js runtime (pinned `~20`, see Amendment) for all backend logic. Functions live in functions/ directory at repo root. Each function is an HTTP trigger exported via app.http(). Don't use Azure App Service, Azure Container Apps, or Express.js servers for this backend. Don't use Deno or Bun runtimes.

## Consequences

Positive: Dedicated App Service Plan (S1, `ASP-AIEducation-bfca`) eliminates cold starts, native Key Vault reference support, Node.js 20 LTS with full npm ecosystem. Negative: Always-on billing regardless of traffic volume; functions must remain stateless.

## Amendment (2026-06-12)

This record originally specified Node.js 22. At deploy time the Node 22 worker crashed the gRPC channel (`14 UNAVAILABLE`) and no functions registered, so the runtime is pinned to Node `~20` via `WEBSITE_NODE_DEFAULT_VERSION` (recorded in `.claude/rules/functions.md` and WORKLOG Slice 0). Do not bump the runtime without re-verifying function registration. Amended per issue #27.

## Alternatives

1. Azure Container Apps — rejected: over-engineered for stateless HTTP handlers; higher cold-start and cost. 2. Azure App Service (Express) — rejected: always-on cost not justified for infrequent function calls; scales worse. 3. Keep Supabase Edge Functions (Deno) — rejected: contradicts migration goal. 4. Azure Logic Apps — rejected: insufficient for custom business logic (quiz grading, PDF generation).
