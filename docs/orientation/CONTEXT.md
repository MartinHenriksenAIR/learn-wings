---
title: learn-wings — durable orientation core
maintained_by: core-sync (.claude/skills/orient/core-sync.md)
note: Hand-curated, small, slow-changing BY DESIGN. The live picture (open issues, PRs, branches, what just merged) is pulled fresh by the `orient` skill — do NOT duplicate volatile state here.
---

# Orientation Core

The durable, curated half of the comprehension layer — the understanding that **can't** be auto-derived from GitHub state. The `orient` skill merges this with live issues/PRs/branches to produce the human digest. Keep it small; let the live layer carry what changes daily.

> **Structured-prose / "3-ready":** the sections below (`current_focus`, the `components` table columns, the `decisions` list) map 1:1 to a future structured `context.yml`. If/when richer automation is wanted, this prose lifts mechanically into that schema — no redesign. See the note at the bottom.

## current_focus

Finish the **Supabase → Azure migration** and merge **PR #6 → `main`**. The app is ~95% cut over and lives on `feature/lovable-migration` (the trunk), **not yet in production**. Remaining to ship: Slice 8 decommission (**#13**), a full all-roles regression sweep, the at-merge infra flips (**#33** + domain/Entra), then un-draft + merge **#6** (tracked in **#69**).

After cutover, the highest-leverage cleanup is the **P2 authz-consolidation** (**#47, #60, #75, #87**) — collapsing the duplicated permission logic that is the root of a recurring bug family.

## components

Health legend: **stable** = solid · **fragile** = timing/correctness-sensitive, regresses easily · **debt** = works but carries known duplication/cleanup. `known_issues` is a *grouping hint* — the live issue list is the source of truth for what's open.

| id | summary | health | key_files | known_issues |
|----|---------|--------|-----------|--------------|
| auth | Entra ID + MSAL login, profile resolution, route guards | fragile | src/hooks/useAuth.tsx, src/components/ProtectedRoute.tsx, src/main.tsx | 79 |
| authz | App-layer org-scoping (no RLS); per-endpoint permission checks + shared helpers | debt | functions/shared/profile.ts, functions/learner-courses/index.ts | 17, 47, 60, 75 |
| learning | Courses, modules, lessons, quizzes, enrollments, progress, certificates, compliance PDF | stable | functions/course-player-data/, src/pages/learner/ | 18, 19, 46, 49, 71 |
| community | Posts, comments, moderation, reports | stable | functions/community-*/, src/pages/community/ | 21, 86 |
| ideas | Ideas board, votes, comments | stable | functions/idea-*/, src/pages/community/Idea* | 23 |
| org-mgmt | Organizations, memberships, invitations, seat limits | debt | functions/org-*/, functions/invitation-*/, src/components/org-admin/ | 62, 66, 80, 91 |
| resources | Resource library | stable | functions/resources/, src/pages/community/ResourceLibrary.tsx | 41 |
| storage | Azure Blob + short-lived SAS tokens for protected lesson assets | stable | functions/azure-*/, functions/shared/sas.ts | 56 |
| settings | platform_settings + org_settings | stable | functions/platform-settings*/, functions/org-settings*/ | 90 |
| frontend-shell | Routing, layout, api-client, shared hooks/components | debt | src/App.tsx, src/lib/api-client.ts, src/components/layout/ | 48, 53, 81, 87 |
| platform | Runtime / CI / deploy / secrets / DB-TLS | stable | functions/index.ts, .github/workflows/ | 25, 26, 27, 28, 29 |
| migration | Supabase→Azure cutover (the active focus); supabase/ is dead | debt | migration/, supabase/ | 13, 33, 69 |

## decisions

The living decision log. `docs/adr/` holds the original 12 ADRs as **archived history** (no longer maintained); new and amended decisions go HERE, in plain English.

1. **Frontend is a React 18 + Vite SPA** on Azure Static Web Apps — no SSR/Next. *Why:* authenticated LMS, SEO irrelevant. (was ADR-0001)
2. **TypeScript strict** is the target everywhere. *Drift:* the frontend `tsconfig.app.json` is still loose (`strict:false`) — flagged to tighten. *Why:* nullability bugs in auth are production risks. (ADR-0002)
3. **UI = shadcn/ui + Radix + Tailwind**, repo-owned. (ADR-0003)
4. **Server state = TanStack Query v5 only** — no other state lib. (ADR-0004) *Drift:* some pages still use ad-hoc `useState + callApi`; standardizing is open cleanup.
5. **Auth = multi-tenant Microsoft Entra ID via MSAL**; identity = `oid`+`tid`; no passwords stored. (ADR-0005)
6. **Backend = Azure Functions v4 on Node 20** — NOT 22 (22 crashes the Functions gRPC worker). *The old ADR-0006 said 22; that is wrong — corrected here.* (#27)
7. **DB = Azure Postgres 15, raw `pg`, no ORM; RLS dropped → ALL authorization enforced in app code.** This is the single biggest architectural fact. (ADR-0007)
8. **Protected assets = Azure Blob + short-lived, server-generated SAS tokens.** (ADR-0008)
9. **Transactional email = Resend.** (ADR-0009)
10. **Secrets never committed to git;** `VITE_`-prefixed vars are browser-bundled and must never hold secrets. (ADR-0010)
11. **SAS blob-name URL-encoding is the caller's responsibility,** not the library's. (ADR-0011)
12. **Auth is no longer a stub** — real JWKS validation lives in `functions/shared/auth.ts`. (supersedes ADR-0012)
13. **(2026-06-09) ADRs are archived.** `docs/adr/` is kept as history but not maintained; decisions live in this log going forward.
14. **(2026-06-09) Comprehension layer.** A hybrid durable-core + live-pull digest (the `orient` skill) is the chosen way to keep humans oriented — pull-based, no gates, regenerated on demand. *Verification economics is a separate, later initiative — do not conflate.*

---

### 3-ready note
This file is deliberately written as *structured prose*: `current_focus` → a scalar; the `components` table → `components[]` with fields `{id, summary, health, key_files[], known_issues[]}`; `decisions` → `decisions[]` with `{plain, why, ref}`. Graduating to a machine-readable `docs/orientation/context.yml` (the "Option 3" structured core) is then a mechanical lift — the `orient` renderer and `core-sync` reconcile stay the same; only the parse step changes. Don't graduate until the need is real (linking/health views/automation you actually want).
