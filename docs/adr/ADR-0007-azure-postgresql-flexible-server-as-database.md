---
id: "ADR-0007"
title: "Azure PostgreSQL Flexible Server as Database"
status: accepted
date: 2026-05-19
deciders: ['le-dawg']
tags: ['database', 'azure', 'postgresql', 'migration']
policy:
  imports: {'disallow': ['@supabase/supabase-js', 'mssql', '@azure/cosmos', 'mongoose', 'prisma'], 'prefer': ['pg']}
  rationales: ['Azure PostgreSQL Flexible Server is the database; pg (node-postgres) is the only client; no ORM, no Supabase client, no other DB engines']
approval_date: 2026-05-19
approval_notes: "Baseline approval"

---

## Context

The application uses a PostgreSQL database (42 migration files, PostgreSQL 15 target) with tables for profiles, courses, org memberships, quiz attempts, lesson progress, invitations, and certificates. The original DB was Supabase PostgreSQL. Supabase-specific constructs (auth.uid(), RLS policies, auth schema references, custom auth functions) must be removed and replaced with app-layer authorization in Azure Functions.

## Decision

Use Azure PostgreSQL Flexible Server (PostgreSQL 15) as the sole database. Connection via pg (node-postgres) from Azure Functions using DATABASE_URL from Key Vault. All Row Level Security policies and auth.uid() references are dropped — authorization is enforced at the Azure Functions application layer, not the database layer. Don't use Azure SQL, CosmosDB, or any other database engine. Don't use Supabase PostgreSQL.

## Consequences

Positive: Native PostgreSQL 15 compatibility with all 42 existing migrations (after RLS cleanup), managed backups, Azure-backbone connectivity from Functions. Negative: Must strip all auth.uid() / RLS / auth schema references (190 lines across migrations); app-layer auth requires careful query parameter validation to prevent privilege escalation.

## Alternatives

1. Azure SQL (SQL Server) — rejected: schema migration from PostgreSQL is non-trivial; no compelling reason to change RDBMS. 2. CosmosDB (PostgreSQL API) — rejected: compatibility concerns with PG-specific SQL used in 42 migrations. 3. PlanetScale / Neon — rejected: introduces additional vendor; Azure PostgreSQL is already provisioned. 4. Keep Supabase PostgreSQL — rejected: contradicts migration goal.
