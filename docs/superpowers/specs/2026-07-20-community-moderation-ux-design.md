# Community Moderation UX — Design (#164 + #169)

Combined UX pass on the Community Moderation surfaces. The two issues edit the
same platform moderation view and the shared `moderation.*` i18n keys, so they
ship as one PR (draft #184) to avoid a rebase/re-touch of the same file.

- **#164** — scope selector with search (Platform Admin view)
- **#169** — single state-reflecting toggles for lock & hide (Platform + Org views)

## Goals

- A moderator on the **Platform Admin → Community Moderation** view can filter
  the report queue to **All organizations** (default), **Global**, or a
  **specific organization**, via a searchable dropdown.
- The lock and hide controls on **both** moderation views become **single
  toggles that reflect and flip the current state**, instead of the paired
  Hide/Show and Lock/Unlock buttons shown today regardless of state.

## Non-goals

- No URL/query-param persistence of the chosen scope (component state only;
  in-page `?tab=` sync is a separately-deferred item).
- No scope selector on the Org view — that view is inherently single-org.
- No change to the report review/dismiss flow, the `ReportedContentDialog`
  (#160), or the report-creation path.

## Current state (as explored)

- `src/pages/platform-admin/PlatformCommunityModeration.tsx` and
  `src/pages/org-admin/OrgCommunityModeration.tsx` are near-duplicates. The
  per-report **action bar** (View content · Hide · Show · Lock · Unlock ·
  Dismiss · Mark reviewed) is copied verbatim in both.
- `fetchReports(orgId?, { scope?: 'global', status? })` in
  `src/lib/community-api.ts` **already** exposes every filter #164 needs.
- The `community-reports` backend already authorizes and filters by `orgId`
  (platform admin OR org admin), `scope: 'global'` (platform admin only), or
  neither (everything — platform admin only). It rejects `orgId + scope`
  together.
- **Gap for #169:** the report payload is `r.*` (from `community_reports`) plus
  `reporter`/`reviewer`/`post_id`. It does **not** carry the target's current
  `is_hidden`/`is_locked`. Those live on `community_posts.is_hidden` +
  `is_locked` and `community_comments.is_hidden`. This is precisely why the UI
  shows two blind buttons today. A single state-reflecting toggle therefore
  requires the queue to know the target's live state.

## Decisions

1. **Source #169 toggle state from the backend (authoritative).** Extend the
   `community-reports` response with the target's current state via a
   `LEFT JOIN`, rather than guessing client-side (misleading) or fetching each
   target separately (N+1). A moderation queue that displays stale/guessed
   state is a correctness defect; returning the entity's true state from the
   server is the industry-standard, production-ready choice. *(Owner-confirmed:
   "best practice / most production-ready".)*
2. **Extract a shared `ReportActions` component.** #169 would otherwise edit the
   duplicated action bar in two files; extracting it to one component removes
   that duplication as part of the work. *(Owner-approved.)*
3. **Stateful button, not a Switch, for the toggles.** Keeps the existing
   action-bar look and reads clearly for a discrete moderation action
   (label + icon reflect state; click fires the opposite). *(Owner-approved.)*
4. **"All organizations" = everything (incl. global).** Preserves today's
   default behavior with no backend change, per #164's own wording. The label
   stays "All organizations"; the slight breadth (it also shows global reports)
   is noted here deliberately.

## Design

### Backend — `functions/community-reports/index.ts` (additive)

Add to the existing query:

- A `LEFT JOIN community_posts tp ON r.target_type = 'post' AND tp.id = r.target_id`
  (the comment `LEFT JOIN community_comments tc …` already exists for `post_id`).
- Two computed columns in the `SELECT`:
  - `target_is_hidden`:
    `CASE WHEN r.target_type = 'post' THEN tp.is_hidden ELSE tc.is_hidden END`
    → the post's or comment's current hidden flag; `NULL` when the target was
    deleted.
  - `target_is_locked`:
    `CASE WHEN r.target_type = 'post' THEN tp.is_locked ELSE NULL END`
    → post lock state; always `NULL` for comment targets (comments have no
    lock).

Authorization, filtering, ordering, and every other field are unchanged. The
response is only consumed by `fetchReports` (the two moderation views), so the
additive fields are backward-compatible.

### Types — `src/lib/community-types.ts`

Add to `CommunityReport`:

```ts
target_is_hidden?: boolean | null;
target_is_locked?: boolean | null;
```

### Shared component — `src/components/community/ReportActions.tsx` (new)

Renders the per-report action bar. Props:

- `report` (with `target_type`, `target_id`, `target_is_hidden`, `target_is_locked`, `status`, and the `canViewReportedContent` inputs),
- `onViewContent(report)`,
- `onToggleHidden({ type, id, hide })`,
- `onToggleLocked({ postId, lock })`,
- `onDismiss(report)`, `onReview(report)`,
- pending flags (`visibilityPending`, `lockPending`, `updatePending`).

Behavior:

- **View content** button — unchanged (`canViewReportedContent(report)` gate +
  tooltip).
- **Hide/Unhide toggle** (post or comment): when `target_is_hidden` is falsy →
  "Hide post/comment" (EyeOff), click calls `onToggleHidden({ hide: true })`;
  when truthy → "Unhide post/comment" (Eye), click calls
  `{ hide: false }`. Disabled while `visibilityPending`, or when
  `target_is_hidden == null` (target deleted).
- **Lock/Unlock toggle** (posts only): unlocked → "Lock comments" (Lock),
  `{ lock: true }`; locked → "Unlock comments" (Unlock), `{ lock: false }`.
  Disabled while `lockPending`, or when `target_is_locked == null`.
- **Dismiss / Mark reviewed** — unchanged, rendered when `status === 'pending'`.

Both pages replace their inline action-bar block with `<ReportActions …/>`,
wiring their existing mutations. The mutation definitions, review dialog, and
`ReportedContentDialog` stay in the pages.

### #164 — scope selector — `PlatformCommunityModeration.tsx`

- New state `scope: string` — `'all'` (default) | `'global'` | `<orgId>`.
- Searchable combobox in the header, modeled on `CoursesManager`'s
  `Popover` + `Command` (`CommandInput`/`CommandList`/`CommandGroup`/
  `CommandItem`/`CommandEmpty`) with a `Check` marking the active item. Items:
  **All organizations** → **Global** → each org (from the `useOrganizations()`
  hook already on the page). Trigger label reflects the active scope.
- The query keys on scope + status; the `queryFn` maps scope → `fetchReports`:
  - `'all'` → `fetchReports(undefined, { status })`
  - `'global'` → `fetchReports(undefined, { scope: 'global', status })`
  - `<orgId>` → `fetchReports(orgId, { status })`
- Query key: extend `queryKeys.platformReports.list` to include the scope
  dimension (e.g. `list(scope, status)`), so each scope caches independently and
  the existing `platformReports.all` invalidation still clears them.
- The Org view is untouched by #164.

### i18n — `src/i18n/locales/en.json` + `da.json`

- `moderation.showPost` → "Unhide post" / da equivalent.
- `moderation.showComment` → "Unhide comment" / da equivalent.
- `lockPost` / `unlockPost` already read "Lock comments" / "Unlock comments" —
  kept.
- New scope-selector keys under `platformModeration.*`: `scopeAll`
  ("All organizations"), `scopeSelectLabel`, `scopeSearchPlaceholder`,
  `scopeNoResults`. Reuse existing `scopeGlobal`.
- Every new/changed key added in **both** en and da.

## Testing

- **`functions/community-reports/index.test.ts`** — extend: assert the response
  carries `target_is_hidden` / `target_is_locked` (from the mocked query row);
  existing 401/403/authz cases unchanged.
- **`src/components/community/ReportActions.test.tsx`** (new) — render with a
  hidden vs. visible target and assert the toggle's label/icon and that click
  fires the opposite action; lock toggle only present for posts; toggles
  disabled when target state is null. (Follows the `OrgAnalytics.test.tsx`
  precedent from #174.)
- **Gates (all exit 0):** root `npm run lint · npm test · npx tsc --noEmit -p
  tsconfig.app.json · npm run build`; `functions/` `npm run build · npm test`.

## Files touched

- `functions/community-reports/index.ts` — add join + two computed columns
- `functions/community-reports/index.test.ts` — assert new fields
- `src/lib/community-types.ts` — add `target_is_hidden` / `target_is_locked`
- `src/components/community/ReportActions.tsx` — new shared action bar
- `src/components/community/ReportActions.test.tsx` — new test
- `src/pages/platform-admin/PlatformCommunityModeration.tsx` — scope selector + use `ReportActions`
- `src/pages/org-admin/OrgCommunityModeration.tsx` — use `ReportActions`
- `src/lib/query-keys.ts` — scope dimension on `platformReports.list`
- `src/i18n/locales/en.json`, `src/i18n/locales/da.json` — label + scope keys

## Risks / edge cases

- **Deleted target** (comment/post removed): joined state is `NULL` →
  hide/lock toggles disabled; View content already gated by
  `canViewReportedContent` (#86 orphaned-comment case preserved).
- **Stale toggle after action**: mutations already `invalidateQueries` the
  reports family, so the refetched row carries fresh `target_is_*` and the
  toggle updates. No optimistic state needed.
- **Scope + query-key invalidation**: adding a scope dimension must keep the
  `platformReports.all` prefix so existing invalidations still match.
