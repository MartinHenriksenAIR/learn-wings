---
paths:
  - "src/**"
---

# Frontend conventions (migration-era)

- **All backend calls in cut-over areas go through `callApi`/`callApiRaw` (`src/lib/api-client.ts`)** — never `supabase.*` in migrated files; a slice's DoD includes a zero-`supabase.*` grep gate on its files.
- **Data fetching goes through a shared TanStack Query hook** in `src/hooks/` (one per endpoint, modeled on `useOrganizations.ts`: `callApi` in the `queryFn`, a defensive `Array.isArray` guard; hooks gate internally on their required param, e.g. `enabled: !!orgId` — expose an optional `enabled`/`staleTime` override ONLY where a caller actually needs it, e.g. `useOrganizations`, `useLearnerCourses`, `useLearnerDashboard`, `useUserProgress`) — do NOT hand-roll `useState`/`useEffect`/`callApi` reads in a page or component. Every query key comes from the `queryKeys` factory in `src/lib/query-keys.ts` (its header states when a family gets an `all` prefix). Mutations use `useMutation`/`useToastMutation` and `invalidateQueries` the affected factory keys — never an imperative `fetchData()` refetch. Site-specific reshaping/filtering/derivation stays at the call site via `useMemo`. (#132; the `endpoint()` factory is the backend analogue — ADR-0015.)
- **Ownership comparisons use `profile?.id`, NOT `user?.id`** — `useAuth().user.id` is the Entra OID; DB rows' `user_id` is the profiles UUID. They never match post-migration (Slice 6 drafts bug class). Audit for `user?.id` when cutting a page over.
- **Loading guards:** use the Dashboard's profile-gated three-way pattern (profile = user-context-resolved marker; explicit empty-state fork) — NOT the unguarded `!user || !currentOrg → setLoading(false)` variant.
- **Spinner state:** any handler that sets a saving/loading flag clears it in `finally` — stranded spinners were a recurring migration bug class.
- **i18n:** every new user-facing string gets keys in BOTH `en` and `da`.
- **Stack (per ADRs 0001–0004):** React 18 + Vite SPA, TypeScript strict, shadcn/ui + Radix + Tailwind, TanStack Query v5. No new state libs.
- Verify: `npm run verify` (exit 0).

## Design system (#494)

- **Semantic tokens only.** Style with the theme classes backed by the token vars in `src/index.css` (canvas/surface, interactive, neutral + navy ramps, green/amber/red/peri families, radius xs–xl, shadow overlay/float, motion fast/base/slow + standard/exit/celebrate). Never raw hex, never arbitrary values (`bg-[#…]`, `rounded-[…]`, `shadow-[…]`), never `style=` props (dynamic geometry is the rare allowlisted exception), never new `.css` files — `scripts/design-gates.mjs` enforces all of this in `verify`.
- **Never invent component tokens.** A component needs no `--button-bg`; derive from the semantic layer.
- **`legacy-*` is a burn-down namespace.** It exists only so pre-redesign surfaces keep rendering. Rebuilding a surface must reduce the legacy count (then refresh the baseline: `node scripts/design-gates.mjs --update-baseline` in the same PR) and must never add a legacy usage.
- **Empty states** go through `EmptyState` and its tiers (`blank` / `done` / `no-results` / `coming-soon`) — no bespoke empty markup.
- **Icons:** lucide only, sizes 16/20/24, stroke 2. **Weights:** 400/600/800 only. **Copy:** sentence case.
