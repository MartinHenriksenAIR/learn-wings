---
id: "ADR-0004"
title: "TanStack Query v5 for Server State Management"
status: accepted
date: 2026-05-19
deciders: ['le-dawg']
tags: ['frontend', 'state-management', 'data-fetching']
policy:
  imports: {'disallow': ['swr', '@reduxjs/toolkit', 'redux', 'zustand'], 'prefer': ['@tanstack/react-query']}
  rationales: ['TanStack Query v5 is the only server-state solution; no SWR or Redux alongside it']
approval_date: 2026-05-19
approval_notes: "Baseline approval"

---

## Context

The frontend makes frequent async calls to fetch course data, org memberships, quiz results, and user profiles. These calls need caching, background refetch, loading/error states, and optimistic updates. React's built-in state is insufficient for this; a dedicated server-state library is needed.

## Decision

Use TanStack Query (React Query) v5 for all server state: data fetching, caching, background sync, and mutation handling. Don't use Redux, Zustand, or SWR for server state. Local UI state (modals, form inputs) uses React useState/useReducer as appropriate.

## Consequences

Positive: Automatic caching with stale-while-revalidate, deduplication of parallel requests, powerful devtools, optimistic updates for quiz/progress mutations. Negative: v5 has breaking API changes from v4 (queryFn signature, useInfiniteQuery); existing code must use v5 patterns only.

## Alternatives

1. Redux Toolkit Query — rejected: more boilerplate, overkill for this scale. 2. SWR — rejected: less feature-complete (no mutation lifecycle, weaker devtools). 3. React Context + useEffect — rejected: no caching, waterfall fetches, race conditions. 4. Zustand for all state — rejected: conflates server and client state concerns.
