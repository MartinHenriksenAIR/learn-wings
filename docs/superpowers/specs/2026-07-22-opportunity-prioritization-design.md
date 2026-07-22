# Opportunity Prioritization (#118) — Design

**Issue:** #118 — "Add a section in the Idea Management view (for the Org Admin) that helps them with opportunity prioritization using frameworks. Categorizes the ideas and shapes an overview."

**Status:** Approved design (brainstormed + grilled 2026-07-22). Next step: implementation plan.

## User story

As an **Org Admin**, in the Idea Management view I want to rate the ideas we've committed to by **Value** and **Effort** and see them arranged on a matrix plus a ranked "do-next" list, so I can decide what to pursue first.

## Scope summary

A new **Prioritize** tab in `OrgIdeasManagement`, holding a Value × Effort matrix, a scoring interaction, and a prioritization overview. Plus a small, coupled change to the existing Kanban board (a new "In Progress" column) that the matrix's population rule depends on. Org-admin only; learners never see scores.

Non-goals (explicitly deferred): learner-facing visibility of scores; per-business-area matrices; numeric / RICE-style scoring.

---

## Decisions (the resolved decision tree)

1. **Framework:** Value × Effort 2×2, expressed as a **3×3 grid** (3 levels per axis).
2. **Axes:** **Value** (worth to the org) and **Effort** (how hard to do). "Value" is used rather than "Impact" to avoid collision with the existing free-text `expected_impact` field.
3. **Scale:** **Low / Medium / High** per axis, stored as `smallint` 1–3, nullable.
4. **Placement:** shadcn `Tabs` — **Board** (existing Kanban) / **Prioritize** (new). Follows the `OrganizationsManager.tsx` tabs precedent.
5. **Scoring interaction:** drag a card into a grid cell (sets both scores at once) **and** a click-to-open scoring dialog (two Low/Med/High selects) as the accessible/touch fallback and for the unscored tray.
6. **Matrix population:** only ideas with status `accepted` (Backlog) or `in_progress` (In Progress). Excludes `draft`, `submitted`, `in_review`, `done`, `rejected`.
7. **Orthogonality:** Value/Effort scoring is independent of Kanban status. Scoring never changes status; changing status never changes scores.
8. **Overview:** quadrant summary (counts per band) + a ranked "Do next" list + a by-business-area rollup.
9. **Board tag:** rated ideas show a small priority-band tag on their **Board** card; unrated show nothing. Rating still only happens in the Prioritize tab.
10. **Board column split:** add an **In Progress** column between Backlog and Done (`in_progress` moves out of Backlog into its own column). Frontend-only; the status already exists. Delivered as its own commit within this PR.
11. **Backend:** dedicated `idea-prioritize` endpoint (admin-only) + two nullable `smallint` columns.

---

## Board change (commit 1, standalone)

Today `KANBAN_COLUMNS` in `OrgIdeasManagement.tsx` is 4 columns:

| Column | Statuses |
|---|---|
| Inbox | `submitted`, `in_review` |
| Backlog | `accepted`, `in_progress` |
| Done | `done` |
| Rejected | `rejected` |

Change to 5 columns:

| Column | Statuses | Drop sets status | On matrix? |
|---|---|---|---|
| Inbox | `submitted`, `in_review` | `submitted` | no |
| Backlog | `accepted` | `accepted` | **yes** |
| **In Progress** (new) | `in_progress` | `in_progress` | **yes** |
| Done | `done` | `done` | no |
| Rejected | `rejected` | `rejected` | no |

- Update `KANBAN_COLUMNS`, `COLUMN_DROP_STATUS`, and the `ideaManagement.columns.*` i18n keys (add `inProgress` in en + da).
- Grid columns bump from `xl:grid-cols-4` to `xl:grid-cols-5` (verify responsive behaviour at md/xl).
- No schema change, no data migration — existing `in_progress` ideas simply render in the new column.

---

## Data model + backend (commit 2)

### Schema
`ideas` table gains two nullable columns (following the `smallint` + CHECK precedent):

```sql
value_score  smallint CHECK (value_score  BETWEEN 1 AND 3),
effort_score smallint CHECK (effort_score BETWEEN 1 AND 3),
```

- Add to `migration/azure/01-schema.sql` (canonical schema, `ideas` table ~line 395).
- Add a numbered live-DB migration `migration/azure/04-idea-priority-scores.sql` (idempotent `ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...` + CHECK). Martin runs it in Terminal per the gated prod-migration flow.
- Existing rows stay `NULL` (unscored).

### Reads — no endpoint change needed
`functions/ideas/index.ts` and `functions/idea/index.ts` both `SELECT i.*`, so the new columns flow through automatically. Only the type needs updating.

**Field-exposure note (deliberate, not a regression):** `ideas` is gated by `requireActiveMember(orgId)`, so any active org member — including learners — already receives `admin_notes` and `rejection_reason` via `i.*` (the learner UI simply doesn't render them). `value_score`/`effort_score` ride the same path and are far less sensitive (subjective prioritization gut-calls). Org isolation is unaffected (`i.org_id = $1` scoping is enforced). We deliberately do **not** expand #118's scope to strip admin-only fields per role; that is a pre-existing, orthogonal pattern. The scores are simply never rendered outside the admin Prioritize surface.

### Write endpoint — `functions/idea-prioritize/index.ts`
Model exactly on `idea-status-update`:
- Uses the shared `endpoint('idea-prioritize', …)` factory (ADR-0015).
- Body: `{ ideaId: string, value: 1|2|3|null, effort: 1|2|3|null }`.
- Validate: `ideaId` required string; `value`/`effort` each either `null` or an integer in 1–3 (reject anything else with 400).
- Load the idea (`SELECT id, org_id FROM ideas WHERE id = $1`), 404 if missing.
- `await requireOrgAdmin(idea.org_id)` — authorship grants nothing; scoring is admin-only. Never trust a client-supplied org.
- Whitelist UPDATE of `value_score`, `effort_score` (both always set from the request, `null` clears). `updated_at` left to the DB trigger.
- Return the updated idea row (parity with `idea-status-update`).
- Register with `import './idea-prioritize/index';` in `functions/index.ts`.
- Test: `functions/idea-prioritize/index.test.ts` — valid write, null clear, out-of-range 400, non-admin 403, missing idea 404.

---

## Frontend (commit 3)

### Types & helpers
- `src/lib/community-types.ts`: add `value_score: number | null` and `effort_score: number | null` to `EnhancedIdea`.
- New `src/lib/idea-priority.ts` — the single source of truth for the framework logic (pure, unit-tested):
  - Level constants (1=Low, 2=Med, 3=High) and localized-label keys.
  - `PriorityBand = 'quick_win' | 'big_bet' | 'fill_in' | 'deprioritize'`.
  - `getBand(value, effort): PriorityBand | null` — `null` if either score missing.
    **Band rule** (presentation heuristic, easy to tune): `highValue = value >= 2`; `lowEffort = effort <= 2`.
    - Quick Win = high value, low effort
    - Big Bet = high value, high effort
    - Fill-in = low value, low effort
    - Deprioritize = low value, high effort
  - `rankIdeas(ideas)` — total order for the "Do next" list: **value desc → effort asc → vote_count desc**. Unscored ideas sort last.

### API + mutation
- `src/lib/ideas-api.ts`: `updateIdeaPriority(ideaId, value, effort)` → `POST /api/idea-prioritize`.
- In `OrgIdeasManagement`, add a `useMutation` for prioritize (mirrors the existing inline `statusMutation`), invalidating `queryKeys.ideasAdmin.all`. No new query key family (reuse `ideasAdmin`).

### Components (kept small and focused)
- `OrgIdeasManagement.tsx` — header (title + business-area filter + search) stays above a `Tabs` strip; renders `Board` (existing Kanban, now 5 cols, + priority tag on cards) and `Prioritize`.
- `src/components/community/PrioritizationMatrix.tsx` — the 3×3 grid: axis labels, value/effort shading (green→red toward high-value/low-effort), drag-and-drop into cells (reusing the board's drag idiom), and an **Unscored tray** for in-scope ideas with no scores. Dragging a card to the tray clears its scores. Clicking a card opens the scoring dialog.
- `src/components/community/IdeaScoreDialog.tsx` — two Low/Med/High selects (Value, Effort) + a "Clear scores" action; accessible/touch path.
- `src/components/community/PriorityOverview.tsx` — quadrant summary counts, the ranked "Do next" list, and the by-business-area rollup.
- `src/components/community/PriorityBadge.tsx` — the small band tag reused on Board cards and in the overview.

### Filter/search behaviour
The existing business-area filter + search live in the page header (above the tabs) and apply to whichever tab is active. The Prioritize tab further restricts to `accepted` + `in_progress` before rendering.

---

## i18n
All new strings added to **both** `src/i18n/locales/en.json` and `da.json`:
- `ideaManagement.columns.inProgress`
- `ideaManagement.tabs.board`, `ideaManagement.tabs.prioritize`
- Axis + level labels (Value/Effort, Low/Medium/High) in both languages (da: Værdi/Indsats, Lav/Middel/Høj).
- Band names (Quick Win / Big Bet / Fill-in / Deprioritize) — with Danish equivalents.
- Overview headings ("Do next", "By business area"), the unscored-tray label, and scoring-dialog strings.

---

## Testing & verification
- **Backend:** `functions/idea-prioritize/index.test.ts` (see cases above).
- **Frontend unit:** `src/lib/idea-priority.test.ts` — `getBand` for all 9 cells + null handling; `rankIdeas` ordering incl. tie-breaks and unscored-last.
- **Component:** a test that the Prioritize tab shows only `accepted`/`in_progress` ideas and that a Board card renders the band tag once scored.
- **Gates (all exit 0 before ready-for-review):** root `npm run lint` · `npm test` · `npx tsc --noEmit -p tsconfig.app.json` · `npm run build`; `functions/`: `npm run build` · `npm test`.

## Acceptance criteria
- The Kanban board shows five columns: Inbox, Backlog, In Progress, Done, Rejected; existing `in_progress` ideas appear under In Progress.
- Idea Management has Board / Prioritize tabs; the header filter + search apply to both.
- The Prioritize tab shows only `accepted` + `in_progress` ideas on a 3×3 Value × Effort grid, with an unscored tray.
- An admin can set/clear Value and Effort by dragging a card into a cell or via the scoring dialog; scores persist and round-trip through `idea-prioritize`.
- Scoring never changes an idea's Kanban status and vice versa.
- The overview shows quadrant counts, a ranked "Do next" list (value desc → effort asc → votes desc), and a by-business-area rollup.
- Rated ideas display their band tag on Board cards; unrated show none.
- Existing ideas migrate with `NULL` scores and render gracefully.
- en + da strings present; all verification gates pass.

## Commit plan (subagent-driven, sequential)
1. Board: split out the In Progress column (frontend + i18n + test).
2. Backend: schema + `04-*.sql` migration + `idea-prioritize` endpoint + test + type field.
3. Frontend: `idea-priority.ts` + tests, API/mutation, matrix/dialog/overview/badge components, tabs wiring, Board card tag, i18n.

## Touch-points (files)
- `src/pages/org-admin/OrgIdeasManagement.tsx`
- `src/components/community/PrioritizationMatrix.tsx` *(new)*, `IdeaScoreDialog.tsx` *(new)*, `PriorityOverview.tsx` *(new)*, `PriorityBadge.tsx` *(new)*
- `src/lib/idea-priority.ts` *(new)* + `idea-priority.test.ts` *(new)*
- `src/lib/ideas-api.ts`, `src/lib/community-types.ts`
- `functions/idea-prioritize/index.ts` *(new)* + `index.test.ts` *(new)*, `functions/index.ts`
- `migration/azure/01-schema.sql`, `migration/azure/04-idea-priority-scores.sql` *(new)*
- `src/i18n/locales/en.json`, `src/i18n/locales/da.json`
