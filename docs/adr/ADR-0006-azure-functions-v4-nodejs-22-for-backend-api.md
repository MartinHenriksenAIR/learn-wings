---
id: "ADR-0006"
title: "Azure Functions v4 (Node.js 22) for Backend API"
status: accepted
date: 2026-05-19
deciders: ['le-dawg']
tags: ['backend', 'azure', 'functions', 'migration']
policy:
  imports: {'disallow': ['express', 'fastify', 'koa', 'hono', '@supabase/functions-js'], 'prefer': ['@azure/functions']}
  rationales: ['Azure Functions v4 Node.js 22 is the backend runtime; no Express servers or Supabase Edge Functions']approval_date: 2026-05-19
approval_notes: "Baseline approval"

---

## Context

The original backend consisted of Supabase Edge Functions (Deno runtime). The migration requires replacing these with Azure-native compute. The backend handles: SAS token generation for blob storage, quiz grading, invitation email dispatch, compliance report generation, PDF certificate generation, and user-context (first-login provisioning). All functions are short-lived request handlers with no persistent state.

## Decision

Use Azure Functions v4 programming model with Node.js 22 runtime for all backend logic. Functions live in functions/ directory at repo root. Each function is an HTTP trigger exported via app.http(). Don't use Azure App Service, Azure Container Apps, or Express.js servers for this backend. Don't use Deno or Bun runtimes.

## Consequences

Positive: Serverless scaling, consumption billing model, native Key Vault reference support, Node.js 22 LTS with full npm ecosystem. Negative: Cold starts on consumption plan (mitigated by S1 Standard plan with always-on); functions must remain stateless.

## Alternatives

1. Azure Container Apps — rejected: over-engineered for stateless HTTP handlers; higher cold-start and cost. 2. Azure App Service (Express) — rejected: always-on cost not justified for infrequent function calls; scales worse. 3. Keep Supabase Edge Functions (Deno) — rejected: contradicts migration goal. 4. Azure Logic Apps — rejected: insufficient for custom business logic (quiz grading, PDF generation).
