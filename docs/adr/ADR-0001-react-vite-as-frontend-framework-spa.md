---
id: "ADR-0001"
title: "React + Vite as Frontend Framework (SPA)"
status: accepted
date: 2026-05-19
deciders: ['le-dawg']
tags: ['frontend', 'framework', 'build-tool']
policy:
  imports: {'disallow': ['vue', '@angular/core', 'next', 'remix'], 'prefer': ['react', 'react-dom']}
  rationales: ['React 18 + Vite chosen as SPA framework; no SSR frameworks permitted']approval_date: 2026-05-19
approval_notes: "Baseline approval"

---

## Context

learn-wings is an LMS platform requiring a responsive, component-rich UI with role-based views (platform admin, org admin, learner). The project was originally scaffolded by Lovable (an AI app builder). A framework choice was needed that supports rapid UI development, strong TypeScript integration, and fast local dev iteration.

## Decision

Use React 18 as the UI framework with Vite as the build tool, delivering a Single Page Application (SPA) hosted on Azure Static Web Apps. Don't use Next.js, Remix, or server-side rendering frameworks. Don't use Vue or Angular.

## Consequences

Positive: Fast HMR with Vite, large React ecosystem, strong TypeScript/JSX tooling, simple Azure SWA deployment. Negative: No SSR (not needed), client bundle must be kept lean. All routing is client-side via React Router.

## Alternatives

1. Next.js (SSR/SSG) — rejected: SEO not a priority for authenticated LMS; SSR adds infra complexity on Azure SWA. 2. Vue 3 — rejected: team familiarity with React ecosystem. 3. Angular — rejected: verbosity overhead for this scale. 4. Plain HTML + HTMX — rejected: component reuse requirements too high.
