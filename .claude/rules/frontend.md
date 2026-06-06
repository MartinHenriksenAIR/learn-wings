---
paths:
  - "src/**"
---

# Frontend conventions (migration-era)

- **All backend calls in cut-over areas go through `callApi`/`callApiRaw` (`src/lib/api-client.ts`)** — never `supabase.*` in migrated files; a slice's DoD includes a zero-`supabase.*` grep gate on its files.
- **Ownership comparisons use `profile?.id`, NOT `user?.id`** — `useAuth().user.id` is the Entra OID; DB rows' `user_id` is the profiles UUID. They never match post-migration (Slice 6 drafts bug class). Audit for `user?.id` when cutting a page over.
- **Loading guards:** use the Dashboard's profile-gated three-way pattern (profile = user-context-resolved marker; explicit empty-state fork) — NOT the unguarded `!user || !currentOrg → setLoading(false)` variant.
- **Spinner state:** any handler that sets a saving/loading flag clears it in `finally` — stranded spinners were a recurring migration bug class.
- **i18n:** every new user-facing string gets keys in BOTH `en` and `da`.
- **Stack (per ADRs 0001–0004):** React 18 + Vite SPA, TypeScript strict, shadcn/ui + Radix + Tailwind, TanStack Query v5. No new state libs.
- Verify: `npm run build`, `npm test`, `npx tsc --noEmit -p tsconfig.app.json` (exit 0).
