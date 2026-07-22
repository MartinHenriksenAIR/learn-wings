# Opportunity Prioritization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Org Admins a Value × Effort prioritization surface in the Idea Management view — a 3×3 matrix, drag/dialog scoring, and a ranked overview — plus a new "In Progress" Kanban column.

**Architecture:** A new **Prioritize** tab in `OrgIdeasManagement` reuses the page's existing `ideas` query (no new fetch). Two nullable score columns on `ideas` are written by a dedicated admin-only `idea-prioritize` endpoint and read for free via the existing `SELECT i.*`. All framework logic (band derivation, ranking) lives in one pure module, `src/lib/idea-priority.ts`, so it's unit-tested independently of the UI.

**Tech Stack:** React 18 + Vite + TypeScript (strict), shadcn/ui + Radix + Tailwind, TanStack Query v5, i18next (en+da), Vitest + Testing Library; Azure Functions v4 (`endpoint()` factory), raw `pg`, PostgreSQL 15.

## Global Constraints

- Backend: new endpoints MUST use `endpoint()`/`adminEndpoint()` from `functions/shared/endpoint.ts` and be imported in the `functions/index.ts` barrel (ADR-0015; fleet guard `functions/registration-names.test.ts`). `@azure/functions` pinned `4.5.0`; Node `~20`. No module-load-time code that can throw. 500 bodies stay generic (factory handles it).
- Backend authz: use `ctx.requireOrgAdmin(orgId)` with the **idea row's** `org_id`, never client-supplied. Endpoint tests mock `shared/auth`, `shared/db`, `shared/profile`; never touch a real DB.
- Frontend: all backend calls go through `callApi` (`src/lib/api-client.ts`); mutations use `useMutation` + `invalidateQueries` on factory keys from `src/lib/query-keys.ts` (reuse `queryKeys.ideasAdmin.all` — no new key family). Ownership comparisons use `profile?.id`, never `user?.id`. Any handler that sets a loading flag clears it in `finally`.
- i18n: every new user-facing string gets keys in BOTH `src/i18n/locales/en.json` and `src/i18n/locales/da.json`.
- Scores: two nullable `smallint` columns, `value_score` and `effort_score`, each constrained `BETWEEN 1 AND 3` (1=Low, 2=Medium, 3=High). Axis names are **Value** and **Effort** (never "Impact" — avoids clash with `expected_impact`).
- Scoring is orthogonal to Kanban status: writing scores never changes `status`; changing `status` never changes scores.
- Verification gates (all exit 0 before ready-for-review): root `npm run lint` · `npm test` · `npx tsc --noEmit -p tsconfig.app.json` · `npm run build`; `functions/`: `npm run build` · `npm test`.
- Every `git commit` message ends with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

### Task 1: Board — split out the "In Progress" column

Frontend-only. `in_progress` currently hides inside the Backlog column; give it its own column between Backlog and Done. No schema/data change (the status already exists).

**Files:**
- Modify: `src/pages/org-admin/OrgIdeasManagement.tsx` (`KANBAN_COLUMNS`, `COLUMN_DROP_STATUS`, grid class)
- Modify: `src/i18n/locales/en.json`, `src/i18n/locales/da.json` (`ideaManagement.columns.inProgress`)

**Interfaces:**
- Produces: a 5-column board — `inbox | backlog | inProgress | done | rejected`. Backlog now holds only `accepted`; the new In Progress column holds only `in_progress`.

- [ ] **Step 1: Add the i18n key (en + da).** In `en.json`, inside `ideaManagement.columns`, add `"inProgress": "In Progress"` between `backlog` and `done`. In `da.json` add `"inProgress": "I gang"` in the same spot.

- [ ] **Step 2: Update the column definitions.** In `OrgIdeasManagement.tsx`, change `KANBAN_COLUMNS` so `backlog` holds only `accepted`, and insert an `inProgress` column before `done`:

```tsx
const KANBAN_COLUMNS: KanbanColumn[] = [
  { key: 'inbox', label: 'Inbox', icon: <Inbox className="h-[15px] w-[15px]" />, iconColor: 'text-primary', statuses: ['submitted', 'in_review'] },
  { key: 'backlog', label: 'Backlog', icon: <FileText className="h-[15px] w-[15px]" />, iconColor: 'text-warning', statuses: ['accepted'] },
  { key: 'inProgress', label: 'In Progress', icon: <Loader2 className="h-[15px] w-[15px]" />, iconColor: 'text-primary', statuses: ['in_progress'] },
  { key: 'done', label: 'Done', icon: <CheckCircle className="h-[15px] w-[15px]" />, iconColor: 'text-success', statuses: ['done'] },
  { key: 'rejected', label: 'Rejected', icon: <XCircle className="h-[15px] w-[15px]" />, iconColor: 'text-[#c43d3d]', statuses: ['rejected'] },
];
```

(`Loader2` is already imported in this file.)

- [ ] **Step 3: Update the drop-target status map.** Add the `inProgress` entry:

```tsx
const COLUMN_DROP_STATUS: Record<string, IdeaStatusExtended> = {
  inbox: 'submitted',
  backlog: 'accepted',
  inProgress: 'in_progress',
  done: 'done',
  rejected: 'rejected',
};
```

- [ ] **Step 4: Widen the grid.** In the board grid container, change `xl:grid-cols-4` to `xl:grid-cols-5` (leave `md:grid-cols-2` as is). The column header still reads `t(\`ideaManagement.columns.${column.key}\`)`, which now resolves `inProgress`.

- [ ] **Step 5: Verify the board renders 5 columns.** Run: `npm run build` and `npx tsc --noEmit -p tsconfig.app.json`. Expected: both exit 0.

- [ ] **Step 6: Commit.**

```bash
git add src/pages/org-admin/OrgIdeasManagement.tsx src/i18n/locales/en.json src/i18n/locales/da.json
git commit -m "$(printf 'feat(ideas): split out In Progress kanban column (#118)\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 2: Schema + live-DB migration + type field

Add the two score columns to the canonical schema and a numbered idempotent migration for the live DB, and surface them on the `EnhancedIdea` type.

**Files:**
- Modify: `migration/azure/01-schema.sql` (`ideas` table, ~line 395)
- Create: `migration/azure/04-idea-priority-scores.sql`
- Modify: `src/lib/community-types.ts` (`EnhancedIdea`)

**Interfaces:**
- Produces: `ideas.value_score` and `ideas.effort_score` (nullable `smallint`, 1–3); `EnhancedIdea.value_score: number | null`, `EnhancedIdea.effort_score: number | null`.

- [ ] **Step 1: Add the columns to the canonical schema.** In `migration/azure/01-schema.sql`, in the `CREATE TABLE public.ideas (...)` block, add these two lines immediately after `success_metrics   text,`:

```sql
  value_score         smallint CHECK (value_score BETWEEN 1 AND 3),
  effort_score        smallint CHECK (effort_score BETWEEN 1 AND 3),
```

- [ ] **Step 2: Create the live-DB migration.** Create `migration/azure/04-idea-priority-scores.sql`:

```sql
-- 04-idea-priority-scores.sql
-- #118 opportunity prioritization: Value x Effort scores on ideas.
-- Idempotent; safe to re-run. Existing rows keep NULL (unscored).
ALTER TABLE public.ideas
  ADD COLUMN IF NOT EXISTS value_score  smallint,
  ADD COLUMN IF NOT EXISTS effort_score smallint;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ideas_value_score_check') THEN
    ALTER TABLE public.ideas ADD CONSTRAINT ideas_value_score_check CHECK (value_score BETWEEN 1 AND 3);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ideas_effort_score_check') THEN
    ALTER TABLE public.ideas ADD CONSTRAINT ideas_effort_score_check CHECK (effort_score BETWEEN 1 AND 3);
  END IF;
END $$;
```

- [ ] **Step 3: Add the fields to the type.** In `src/lib/community-types.ts`, in the `EnhancedIdea` interface, add after `success_metrics: string | null;`:

```ts
  // Prioritization scores (#118) — admin-set Value/Effort, 1=Low 2=Med 3=High, null=unscored
  value_score: number | null;
  effort_score: number | null;
```

- [ ] **Step 4: Verify types compile.** Run: `npx tsc --noEmit -p tsconfig.app.json`. Expected: exit 0. (No test yet — pure schema/type; the migration is run by the repo owner in Terminal per the gated prod-migration flow. Do NOT attempt to run it against any DB here.)

- [ ] **Step 5: Commit.**

```bash
git add migration/azure/01-schema.sql migration/azure/04-idea-priority-scores.sql src/lib/community-types.ts
git commit -m "$(printf 'feat(ideas): add value_score/effort_score columns (#118)\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 3: `idea-prioritize` endpoint

Admin-only write path for the two scores. Modeled exactly on `idea-status-update`.

**Files:**
- Create: `functions/idea-prioritize/index.ts`
- Create: `functions/idea-prioritize/index.test.ts`
- Modify: `functions/index.ts` (barrel import)

**Interfaces:**
- Consumes: `endpoint` from `functions/shared/endpoint.ts`; `queryOne` from `functions/shared/db`.
- Produces: `POST /api/idea-prioritize` with body `{ ideaId: string, value: 1|2|3|null, effort: 1|2|3|null }` → `200 { idea }` | `400` | `403` | `404`. Both `value` and `effort` are required in the body (omitted → 400).

- [ ] **Step 1: Write the failing test.** Create `functions/idea-prioritize/index.test.ts` (mirrors the `idea-status-update` test harness):

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuthenticate, MockAuthError, mockQueryOne, mockGetProfile, mockIsOrgAdmin } = vi.hoisted(() => {
  class MockAuthError extends Error {}
  return {
    mockAuthenticate: vi.fn(), MockAuthError,
    mockQueryOne: vi.fn(),
    mockGetProfile: vi.fn(), mockIsOrgAdmin: vi.fn(),
  };
});
vi.mock('../shared/auth', () => ({ authenticate: mockAuthenticate, AuthError: MockAuthError }));
vi.mock('../shared/db', () => ({ query: vi.fn(), queryOne: mockQueryOne }));
vi.mock('../shared/profile', () => ({ getProfile: mockGetProfile, isActiveMember: vi.fn(), isOrgAdmin: mockIsOrgAdmin, isOrgAdminOfAny: vi.fn() }));

import handler from './index';

const baseReq = (body: unknown) => ({
  method: 'POST',
  headers: { get: (k: string) => (k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok') },
  json: async () => body,
}) as any;

const ideaRow = { id: 'idea-1', org_id: 'org-1' };

describe('idea-prioritize', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ id: 'oid-1', tid: 'tid-1', email: 'u@x.com' });
    mockGetProfile.mockResolvedValue({ id: 'p1', is_platform_admin: false });
    mockIsOrgAdmin.mockResolvedValue(false);
  });

  it('handles OPTIONS preflight', async () => {
    const req = { method: 'OPTIONS', headers: { get: () => 'https://ai-uddannelse.dk' } } as any;
    const res = await handler(req, {} as any);
    expect(res.status).toBe(204);
  });

  it('returns 401 when bearer token is invalid', async () => {
    mockAuthenticate.mockRejectedValueOnce(new MockAuthError('Missing Bearer token'));
    const res = await handler(baseReq({ ideaId: 'idea-1', value: 3, effort: 1 }), {} as any);
    expect(res.status).toBe(401);
  });

  it('returns 400 when ideaId is missing', async () => {
    const res = await handler(baseReq({ value: 3, effort: 1 }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'ideaId is required' });
  });

  it('returns 400 when value is out of range', async () => {
    const res = await handler(baseReq({ ideaId: 'idea-1', value: 4, effort: 1 }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'value must be an integer 1-3 or null' });
  });

  it('returns 400 when effort is missing (undefined)', async () => {
    const res = await handler(baseReq({ ideaId: 'idea-1', value: 3 }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'effort must be an integer 1-3 or null' });
  });

  it('returns 404 when idea not found', async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    const res = await handler(baseReq({ ideaId: 'idea-999', value: 3, effort: 1 }), {} as any);
    expect(res.status).toBe(404);
  });

  it('returns 403 when a plain member tries to score', async () => {
    mockQueryOne.mockResolvedValueOnce(ideaRow);
    mockIsOrgAdmin.mockResolvedValueOnce(false);
    const res = await handler(baseReq({ ideaId: 'idea-1', value: 3, effort: 1 }), {} as any);
    expect(res.status).toBe(403);
  });

  it('happy path: org admin scores (isOrgAdmin called with idea org_id; both columns set)', async () => {
    mockQueryOne.mockResolvedValueOnce(ideaRow);            // load
    mockIsOrgAdmin.mockResolvedValueOnce(true);
    const updated = { ...ideaRow, value_score: 3, effort_score: 1 };
    mockQueryOne.mockResolvedValueOnce(updated);            // UPDATE RETURNING
    const res = await handler(baseReq({ ideaId: 'idea-1', value: 3, effort: 1 }), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ idea: updated });
    expect(mockIsOrgAdmin).toHaveBeenCalledWith('p1', 'org-1');
    const [sql, params] = mockQueryOne.mock.calls[1] as [string, unknown[]];
    expect(sql).toContain('UPDATE ideas');
    expect(sql).toContain('value_score =');
    expect(sql).toContain('effort_score =');
    expect(params).toEqual([3, 1, 'idea-1']);
  });

  it('clears scores when value and effort are null', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });
    mockQueryOne.mockResolvedValueOnce(ideaRow);
    mockQueryOne.mockResolvedValueOnce({ ...ideaRow, value_score: null, effort_score: null });
    const res = await handler(baseReq({ ideaId: 'idea-1', value: null, effort: null }), {} as any);
    expect(res.status).toBe(200);
    const [, params] = mockQueryOne.mock.calls[1] as [string, unknown[]];
    expect(params).toEqual([null, null, 'idea-1']);
  });

  it('platform admin scores without calling isOrgAdmin', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });
    mockQueryOne.mockResolvedValueOnce(ideaRow);
    mockQueryOne.mockResolvedValueOnce({ ...ideaRow, value_score: 2, effort_score: 2 });
    const res = await handler(baseReq({ ideaId: 'idea-1', value: 2, effort: 2 }), {} as any);
    expect(res.status).toBe(200);
    expect(mockIsOrgAdmin).not.toHaveBeenCalled();
  });

  it('returns 500 on db error', async () => {
    mockQueryOne.mockRejectedValueOnce(new Error('connection refused'));
    const res = await handler(baseReq({ ideaId: 'idea-1', value: 3, effort: 1 }), { error: vi.fn() } as any);
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Internal server error' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.** Run: `cd functions && npx vitest run idea-prioritize`. Expected: FAIL (module `./index` not found / no default export).

- [ ] **Step 3: Write the endpoint.** Create `functions/idea-prioritize/index.ts`:

```ts
import { queryOne } from '../shared/db';
import { endpoint } from '../shared/endpoint';

interface IdeaRow {
  id: string;
  org_id: string;
}

// null (clear) or an integer 1-3. Anything else → invalid.
function isValidScore(v: unknown): v is number | null {
  return v === null || (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 3);
}

export default endpoint('idea-prioritize', async ({ req, reply, requireOrgAdmin }) => {
  const body = await req.json() as { ideaId?: unknown; value?: unknown; effort?: unknown };
  const { ideaId, value, effort } = body;

  if (!ideaId || typeof ideaId !== 'string') {
    return reply(400, { error: 'ideaId is required' });
  }
  if (!isValidScore(value)) {
    return reply(400, { error: 'value must be an integer 1-3 or null' });
  }
  if (!isValidScore(effort)) {
    return reply(400, { error: 'effort must be an integer 1-3 or null' });
  }

  // Load idea (org_id is the authz anchor — never client-supplied).
  const idea = await queryOne<IdeaRow>(
    `SELECT id, org_id FROM ideas WHERE id = $1`,
    [ideaId],
  );
  if (!idea) return reply(404, { error: 'Idea not found' });

  // Authorization: platform admin OR org admin of the IDEA's org. Scoring is
  // admin-only and orthogonal to status; authorship grants nothing here.
  await requireOrgAdmin(idea.org_id);

  const updated = await queryOne(
    `UPDATE ideas SET value_score = $1, effort_score = $2 WHERE id = $3 RETURNING *`,
    [value, effort, ideaId],
  );

  return reply(200, { idea: updated });
});
```

- [ ] **Step 4: Register in the barrel.** In `functions/index.ts`, add (in the alphabetical idea-* cluster, next to `import './idea-status-update/index';`):

```ts
import './idea-prioritize/index';
```

- [ ] **Step 5: Run the tests to verify they pass.** Run: `cd functions && npx vitest run idea-prioritize registration-names`. Expected: both PASS (the endpoint tests + the fleet guard confirming the barrel import + route/folder parity).

- [ ] **Step 6: Commit.**

```bash
git add functions/idea-prioritize functions/index.ts
git commit -m "$(printf 'feat(ideas): idea-prioritize endpoint (#118)\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 4: Framework logic (`idea-priority.ts`) + API function

The pure module every UI piece depends on, plus the thin `callApi` wrapper.

**Files:**
- Create: `src/lib/idea-priority.ts`
- Create: `src/lib/idea-priority.test.ts`
- Modify: `src/lib/ideas-api.ts` (`updateIdeaPriority`)
- Modify: `src/lib/ideas-api.test.ts` (one case)

**Interfaces:**
- Produces:
  - `type PriorityBand = 'quick_win' | 'big_bet' | 'fill_in' | 'deprioritize'`
  - `getBand(value: number | null, effort: number | null): PriorityBand | null`
  - `rankIdeas<T extends ScoredIdea>(ideas: T[]): T[]` where `ScoredIdea = { value_score: number | null; effort_score: number | null; vote_count?: number | null }`
  - `PRIORITIZABLE_STATUSES: readonly ['accepted', 'in_progress']`
  - `updateIdeaPriority(ideaId: string, value: number | null, effort: number | null): Promise<EnhancedIdea>`

- [ ] **Step 1: Write the failing test.** Create `src/lib/idea-priority.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { getBand, rankIdeas } from './idea-priority';

describe('getBand', () => {
  it('returns null when either score is missing', () => {
    expect(getBand(null, 1)).toBeNull();
    expect(getBand(3, null)).toBeNull();
    expect(getBand(null, null)).toBeNull();
  });

  // Band rule: highValue = value >= 2 ; lowEffort = effort <= 2
  it('quick_win = high value, low effort', () => {
    expect(getBand(3, 1)).toBe('quick_win');
    expect(getBand(2, 2)).toBe('quick_win');
    expect(getBand(3, 2)).toBe('quick_win');
    expect(getBand(2, 1)).toBe('quick_win');
  });
  it('big_bet = high value, high effort', () => {
    expect(getBand(3, 3)).toBe('big_bet');
    expect(getBand(2, 3)).toBe('big_bet');
  });
  it('fill_in = low value, low effort', () => {
    expect(getBand(1, 1)).toBe('fill_in');
    expect(getBand(1, 2)).toBe('fill_in');
  });
  it('deprioritize = low value, high effort', () => {
    expect(getBand(1, 3)).toBe('deprioritize');
  });
});

describe('rankIdeas', () => {
  const mk = (id: string, v: number | null, e: number | null, votes = 0) =>
    ({ id, value_score: v, effort_score: e, vote_count: votes });

  it('orders value desc, then effort asc, then votes desc; unscored last', () => {
    const ideas = [
      mk('unscored', null, null, 99),
      mk('lowval', 1, 1, 0),
      mk('bigbet', 3, 3, 0),
      mk('quickwin', 3, 1, 0),
      mk('qw-tie-lowvotes', 3, 1, 1),
      mk('qw-tie-hivotes', 3, 1, 5),
    ];
    const order = rankIdeas(ideas).map((i) => i.id);
    // both quickwin(votes 0) tie on value+effort with the two tie rows → votes desc
    expect(order).toEqual(['qw-tie-hivotes', 'qw-tie-lowvotes', 'quickwin', 'bigbet', 'lowval', 'unscored']);
  });

  it('does not mutate the input array', () => {
    const ideas = [mk('a', 1, 1), mk('b', 3, 1)];
    const copy = [...ideas];
    rankIdeas(ideas);
    expect(ideas).toEqual(copy);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.** Run: `npx vitest run src/lib/idea-priority`. Expected: FAIL (module not found).

- [ ] **Step 3: Write the module.** Create `src/lib/idea-priority.ts`:

```ts
import type { IdeaStatusExtended } from './community-types';

/** Statuses that appear on the prioritization matrix (Backlog + In Progress). */
export const PRIORITIZABLE_STATUSES: readonly IdeaStatusExtended[] = ['accepted', 'in_progress'];

/** Score levels: 1=Low, 2=Medium, 3=High. */
export type ScoreLevel = 1 | 2 | 3;

export type PriorityBand = 'quick_win' | 'big_bet' | 'fill_in' | 'deprioritize';

/**
 * Collapse the 3-level Value/Effort scores into one of four named bands.
 * Presentation heuristic (tunable): highValue = value >= 2; lowEffort = effort <= 2.
 * Returns null if either score is unset.
 */
export function getBand(value: number | null, effort: number | null): PriorityBand | null {
  if (value == null || effort == null) return null;
  const highValue = value >= 2;
  const lowEffort = effort <= 2;
  if (highValue && lowEffort) return 'quick_win';
  if (highValue && !lowEffort) return 'big_bet';
  if (!highValue && lowEffort) return 'fill_in';
  return 'deprioritize';
}

interface ScoredIdea {
  value_score: number | null;
  effort_score: number | null;
  vote_count?: number | null;
}

/**
 * Total order for the "Do next" list: value desc → effort asc → votes desc.
 * Unscored ideas (either score null) sort last. Pure — never mutates input.
 */
export function rankIdeas<T extends ScoredIdea>(ideas: T[]): T[] {
  return [...ideas].sort((a, b) => {
    const aScored = a.value_score != null && a.effort_score != null;
    const bScored = b.value_score != null && b.effort_score != null;
    if (aScored !== bScored) return aScored ? -1 : 1;
    if (!aScored) return 0;
    if (b.value_score! !== a.value_score!) return b.value_score! - a.value_score!;
    if (a.effort_score! !== b.effort_score!) return a.effort_score! - b.effort_score!;
    return (b.vote_count ?? 0) - (a.vote_count ?? 0);
  });
}
```

- [ ] **Step 4: Run the test to verify it passes.** Run: `npx vitest run src/lib/idea-priority`. Expected: PASS.

- [ ] **Step 5: Add the API function.** In `src/lib/ideas-api.ts`, after `updateIdeaStatus`, add:

```ts
// Set (or clear) an idea's Value/Effort prioritization scores (admin only).
// value/effort are 1-3 (Low/Med/High) or null to clear. Server derives org from the idea row.
export async function updateIdeaPriority(
  ideaId: string,
  value: number | null,
  effort: number | null,
): Promise<EnhancedIdea> {
  const res = await callApi<{ idea: EnhancedIdea }>('/api/idea-prioritize', { ideaId, value, effort });
  return res.idea;
}
```

- [ ] **Step 6: Add an API test case.** In `src/lib/ideas-api.test.ts`, following the existing `callApi`-mock style used for the other idea functions, add a case asserting `updateIdeaPriority('idea-1', 3, 1)` calls `callApi` with `'/api/idea-prioritize'` and `{ ideaId: 'idea-1', value: 3, effort: 1 }` and returns `res.idea`. (Match the mock setup already at the top of that file; add `updateIdeaPriority` to the import.)

- [ ] **Step 7: Run the lib tests.** Run: `npx vitest run src/lib/idea-priority src/lib/ideas-api`. Expected: PASS.

- [ ] **Step 8: Commit.**

```bash
git add src/lib/idea-priority.ts src/lib/idea-priority.test.ts src/lib/ideas-api.ts src/lib/ideas-api.test.ts
git commit -m "$(printf 'feat(ideas): priority band/ranking logic + updateIdeaPriority api (#118)\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 5: i18n keys + `PriorityBadge` component

Add every remaining new string (en+da) and the small band tag reused on Board cards and in the overview.

**Files:**
- Modify: `src/i18n/locales/en.json`, `src/i18n/locales/da.json`
- Create: `src/components/community/PriorityBadge.tsx`
- Create: `src/components/community/PriorityBadge.test.tsx`

**Interfaces:**
- Produces: `<PriorityBadge value={number|null} effort={number|null} className?={string} />` — renders a localized band tag, or `null` when unscored. New i18n namespace keys under `ideaManagement`: `tabs.*`, `levels.*`, `bands.*`, `prioritize.*`, `scoreDialog.*`.

- [ ] **Step 1: Add the i18n keys (en).** In `src/i18n/locales/en.json`, inside `ideaManagement` (after the `dialog` object), add:

```json
"tabs": { "board": "Board", "prioritize": "Prioritize" },
"levels": { "low": "Low", "medium": "Medium", "high": "High" },
"bands": {
  "quick_win": "Quick Win",
  "big_bet": "Big Bet",
  "fill_in": "Fill-in",
  "deprioritize": "Deprioritize"
},
"prioritize": {
  "title": "Prioritize opportunities",
  "description": "Rate committed ideas by value and effort to decide what to do next.",
  "axisValue": "Value",
  "axisEffort": "Effort",
  "unscored": "Unscored",
  "unscoredHint": "Drag a card onto the grid, or click it to rate.",
  "empty": "No committed ideas to prioritize yet. Accept ideas from the Backlog to see them here.",
  "doNext": "Do next",
  "byBusinessArea": "By business area",
  "count_one": "{{count}} idea",
  "count_other": "{{count}} ideas",
  "scoreFailed": "Failed to save priority"
},
"scoreDialog": {
  "title": "Rate opportunity",
  "valueLabel": "Value",
  "effortLabel": "Effort",
  "clear": "Clear scores"
}
```

- [ ] **Step 2: Add the i18n keys (da).** In `src/i18n/locales/da.json`, inside `ideaManagement`, add the same structure with Danish copy:

```json
"tabs": { "board": "Tavle", "prioritize": "Prioritér" },
"levels": { "low": "Lav", "medium": "Middel", "high": "Høj" },
"bands": {
  "quick_win": "Hurtig gevinst",
  "big_bet": "Stor satsning",
  "fill_in": "Udfyldning",
  "deprioritize": "Nedprioritér"
},
"prioritize": {
  "title": "Prioritér muligheder",
  "description": "Vurder besluttede idéer efter værdi og indsats for at afgøre, hvad der skal gøres først.",
  "axisValue": "Værdi",
  "axisEffort": "Indsats",
  "unscored": "Ikke vurderet",
  "unscoredHint": "Træk et kort ind i gitteret, eller klik for at vurdere.",
  "empty": "Ingen besluttede idéer at prioritere endnu. Accepter idéer fra backlog for at se dem her.",
  "doNext": "Gør nu",
  "byBusinessArea": "Efter forretningsområde",
  "count_one": "{{count}} idé",
  "count_other": "{{count}} idéer",
  "scoreFailed": "Kunne ikke gemme prioritet"
},
"scoreDialog": {
  "title": "Vurder mulighed",
  "valueLabel": "Værdi",
  "effortLabel": "Indsats",
  "clear": "Ryd vurdering"
}
```

- [ ] **Step 3: Write the failing test.** Create `src/components/community/PriorityBadge.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PriorityBadge } from './PriorityBadge';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

describe('PriorityBadge', () => {
  it('renders the band label for a scored idea', () => {
    render(<PriorityBadge value={3} effort={1} />);
    expect(screen.getByText('ideaManagement.bands.quick_win')).toBeInTheDocument();
  });
  it('renders nothing when unscored', () => {
    const { container } = render(<PriorityBadge value={null} effort={2} />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 4: Run the test to verify it fails.** Run: `npx vitest run src/components/community/PriorityBadge`. Expected: FAIL (module not found).

- [ ] **Step 5: Write the component.** Create `src/components/community/PriorityBadge.tsx`:

```tsx
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { getBand, type PriorityBand } from '@/lib/idea-priority';

const BAND_STYLES: Record<PriorityBand, string> = {
  quick_win: 'bg-success/15 text-success',
  big_bet: 'bg-primary/15 text-primary',
  fill_in: 'bg-warning/15 text-warning',
  deprioritize: 'bg-muted text-muted-foreground',
};

interface Props {
  value: number | null;
  effort: number | null;
  className?: string;
}

export function PriorityBadge({ value, effort, className }: Props) {
  const { t } = useTranslation();
  const band = getBand(value, effort);
  if (!band) return null;
  return (
    <span
      className={cn(
        'rounded-[7px] px-[9px] py-[3px] text-[10.5px] font-bold',
        BAND_STYLES[band],
        className,
      )}
    >
      {t(`ideaManagement.bands.${band}`)}
    </span>
  );
}
```

- [ ] **Step 6: Run the test to verify it passes.** Run: `npx vitest run src/components/community/PriorityBadge`. Expected: PASS.

- [ ] **Step 7: Commit.**

```bash
git add src/i18n/locales/en.json src/i18n/locales/da.json src/components/community/PriorityBadge.tsx src/components/community/PriorityBadge.test.tsx
git commit -m "$(printf 'feat(ideas): priority i18n + PriorityBadge (#118)\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 6: `IdeaScoreDialog` component

The accessible/touch path for setting scores (and clearing them).

**Files:**
- Create: `src/components/community/IdeaScoreDialog.tsx`

**Interfaces:**
- Consumes: `updateIdeaPriority` is NOT called here — the parent owns the mutation. This is a controlled dialog.
- Produces:
  ```ts
  interface IdeaScoreDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    ideaTitle?: string;
    value: number | null;
    effort: number | null;
    onSave: (value: number, effort: number) => void;
    onClear: () => void;
    isPending?: boolean;
  }
  ```

- [ ] **Step 1: Write the component.** Create `src/components/community/IdeaScoreDialog.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';

interface IdeaScoreDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ideaTitle?: string;
  value: number | null;
  effort: number | null;
  onSave: (value: number, effort: number) => void;
  onClear: () => void;
  isPending?: boolean;
}

const LEVELS = [
  { value: '3', key: 'high' },
  { value: '2', key: 'medium' },
  { value: '1', key: 'low' },
] as const;

export function IdeaScoreDialog({
  open, onOpenChange, ideaTitle, value, effort, onSave, onClear, isPending,
}: IdeaScoreDialogProps) {
  const { t } = useTranslation();
  const [localValue, setLocalValue] = useState<string>('');
  const [localEffort, setLocalEffort] = useState<string>('');

  // Re-seed the selects each time the dialog opens for a (possibly different) idea.
  useEffect(() => {
    if (open) {
      setLocalValue(value != null ? String(value) : '');
      setLocalEffort(effort != null ? String(effort) : '');
    }
  }, [open, value, effort]);

  const renderSelect = (
    current: string,
    onChange: (v: string) => void,
    placeholder: string,
  ) => (
    <Select value={current} onValueChange={onChange}>
      <SelectTrigger>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {LEVELS.map((l) => (
          <SelectItem key={l.value} value={l.value}>
            {t(`ideaManagement.levels.${l.key}`)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('ideaManagement.scoreDialog.title')}</DialogTitle>
          {ideaTitle && <DialogDescription>{ideaTitle}</DialogDescription>}
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4 py-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">{t('ideaManagement.scoreDialog.valueLabel')}</label>
            {renderSelect(localValue, setLocalValue, t('ideaManagement.levels.medium'))}
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">{t('ideaManagement.scoreDialog.effortLabel')}</label>
            {renderSelect(localEffort, setLocalEffort, t('ideaManagement.levels.medium'))}
          </div>
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            variant="ghost"
            onClick={onClear}
            disabled={isPending || (value == null && effort == null)}
          >
            {t('ideaManagement.scoreDialog.clear')}
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={() => onSave(Number(localValue), Number(localEffort))}
              disabled={isPending || !localValue || !localEffort}
            >
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('common.save')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Verify it compiles.** Run: `npx tsc --noEmit -p tsconfig.app.json`. Expected: exit 0. (No standalone test — this dialog is exercised via the matrix in Task 7 and manual verification; it holds no framework logic of its own.)

- [ ] **Step 3: Commit.**

```bash
git add src/components/community/IdeaScoreDialog.tsx
git commit -m "$(printf 'feat(ideas): IdeaScoreDialog for value/effort scoring (#118)\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 7: `PrioritizationMatrix` component

The 3×3 grid + unscored tray + drag/drop + click-to-score. Owns the `IdeaScoreDialog`.

**Files:**
- Create: `src/components/community/PrioritizationMatrix.tsx`
- Create: `src/components/community/PrioritizationMatrix.test.tsx`

**Interfaces:**
- Consumes: `EnhancedIdea`, `getBand`/`PRIORITIZABLE_STATUSES` from `idea-priority`, `IdeaScoreDialog`, `PriorityBadge`.
- Produces:
  ```ts
  interface PrioritizationMatrixProps {
    ideas: EnhancedIdea[];                 // the page's non-draft list; filtered internally
    onScore: (ideaId: string, value: number | null, effort: number | null) => void;
    isScoring?: boolean;
  }
  ```
  Internally filters to `PRIORITIZABLE_STATUSES`. Grid rows top→bottom = Value High→Low; columns left→right = Effort Low→High (so top-left cell = high value/low effort = Quick Win).

- [ ] **Step 1: Write the failing test.** Create `src/components/community/PrioritizationMatrix.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PrioritizationMatrix } from './PrioritizationMatrix';
import type { EnhancedIdea } from '@/lib/community-types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

const idea = (over: Partial<EnhancedIdea>): EnhancedIdea => ({
  id: 'x', org_id: 'o', user_id: 'u', category_id: null, course_context_id: null,
  lesson_context_id: null, title: 'T', description: null, problem_statement: null,
  proposed_solution: null, expected_impact: null, status: 'accepted', submitted_at: null,
  created_at: '', updated_at: '', business_area: null, tags: [], current_process: null,
  pain_points: null, affected_roles: null, frequency_volume: null, proposed_improvement: null,
  desired_process: null, data_inputs: null, systems_involved: null, constraints_risks: null,
  success_metrics: null, admin_notes: null, rejection_reason: null, value_score: null,
  effort_score: null, ...over,
});

describe('PrioritizationMatrix', () => {
  it('shows only accepted + in_progress ideas', () => {
    render(
      <PrioritizationMatrix
        ideas={[
          idea({ id: 'a', title: 'Accepted one', status: 'accepted' }),
          idea({ id: 'b', title: 'Wip one', status: 'in_progress' }),
          idea({ id: 'c', title: 'Inbox one', status: 'submitted' }),
          idea({ id: 'd', title: 'Done one', status: 'done' }),
        ]}
        onScore={vi.fn()}
      />,
    );
    expect(screen.getByText('Accepted one')).toBeInTheDocument();
    expect(screen.getByText('Wip one')).toBeInTheDocument();
    expect(screen.queryByText('Inbox one')).not.toBeInTheDocument();
    expect(screen.queryByText('Done one')).not.toBeInTheDocument();
  });

  it('puts unscored in-scope ideas in the unscored tray', () => {
    render(
      <PrioritizationMatrix
        ideas={[idea({ id: 'u', title: 'Needs score', status: 'accepted', value_score: null, effort_score: null })]}
        onScore={vi.fn()}
      />,
    );
    const tray = screen.getByTestId('unscored-tray');
    expect(tray).toHaveTextContent('Needs score');
  });

  it('places a scored idea in the matching grid cell', () => {
    render(
      <PrioritizationMatrix
        ideas={[idea({ id: 's', title: 'Quick win idea', status: 'accepted', value_score: 3, effort_score: 1 })]}
        onScore={vi.fn()}
      />,
    );
    // cell test id encodes value/effort: cell-<value>-<effort>
    const cell = screen.getByTestId('cell-3-1');
    expect(cell).toHaveTextContent('Quick win idea');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.** Run: `npx vitest run src/components/community/PrioritizationMatrix`. Expected: FAIL (module not found).

- [ ] **Step 3: Write the component.** Create `src/components/community/PrioritizationMatrix.tsx`:

```tsx
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { TrendingUp } from 'lucide-react';
import type { EnhancedIdea } from '@/lib/community-types';
import { PRIORITIZABLE_STATUSES } from '@/lib/idea-priority';
import { IdeaScoreDialog } from './IdeaScoreDialog';

interface PrioritizationMatrixProps {
  ideas: EnhancedIdea[];
  onScore: (ideaId: string, value: number | null, effort: number | null) => void;
  isScoring?: boolean;
}

const VALUE_ROWS = [3, 2, 1] as const;   // top → bottom: High, Med, Low
const EFFORT_COLS = [1, 2, 3] as const;  // left → right: Low, Med, High

// Green (good: high value / low effort) → red (bad). Sum-based tint.
function cellTint(value: number, effort: number): string {
  const goodness = value - effort; // -2 .. +2
  if (goodness >= 2) return 'bg-success/10';
  if (goodness === 1) return 'bg-success/[0.06]';
  if (goodness === 0) return 'bg-warning/[0.06]';
  if (goodness === -1) return 'bg-[#c43d3d]/[0.06]';
  return 'bg-[#c43d3d]/10';
}

export function PrioritizationMatrix({ ideas, onScore, isScoring }: PrioritizationMatrixProps) {
  const { t } = useTranslation();
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dialogIdea, setDialogIdea] = useState<EnhancedIdea | null>(null);

  const inScope = useMemo(
    () => ideas.filter((i) => PRIORITIZABLE_STATUSES.includes(i.status)),
    [ideas],
  );
  const unscored = inScope.filter((i) => i.value_score == null || i.effort_score == null);
  const scoredAt = (v: number, e: number) =>
    inScope.filter((i) => i.value_score === v && i.effort_score === e);

  const drop = (value: number | null, effort: number | null) => {
    if (draggedId) onScore(draggedId, value, effort);
    setDraggedId(null);
  };

  const card = (idea: EnhancedIdea) => (
    <div
      key={idea.id}
      draggable
      onDragStart={() => setDraggedId(idea.id)}
      onDragEnd={() => setDraggedId(null)}
      onClick={() => setDialogIdea(idea)}
      className={cn(
        'cursor-grab rounded-lg border border-[#e4e6ee] bg-card px-2.5 py-2 text-[12px] font-bold leading-tight',
        'transition-shadow hover:shadow-[0_6px_16px_rgba(20,24,46,0.10)]',
        draggedId === idea.id && 'opacity-40',
      )}
    >
      <p className="line-clamp-2">{idea.title}</p>
      <span className="mt-1 inline-flex items-center gap-1 text-[10.5px] font-semibold text-muted-foreground">
        <TrendingUp className="h-[10px] w-[10px]" />
        {idea.vote_count || 0}
      </span>
    </div>
  );

  if (inScope.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-[#d6d8e0] p-8 text-center text-sm text-muted-foreground">
        {t('ideaManagement.prioritize.empty')}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Unscored tray */}
      <div
        data-testid="unscored-tray"
        onDragOver={(e) => e.preventDefault()}
        onDrop={() => drop(null, null)}
        className="rounded-2xl bg-[#eceef3] p-3"
      >
        <div className="mb-2 flex items-center gap-2 px-1">
          <span className="text-[12.5px] font-extrabold tracking-[0.02em]">
            {t('ideaManagement.prioritize.unscored')}
          </span>
          <span className="ml-auto rounded-[7px] bg-card px-[9px] py-0.5 text-[11px] font-extrabold text-muted-foreground">
            {unscored.length}
          </span>
        </div>
        {unscored.length === 0 ? (
          <p className="px-1 pb-1 text-xs text-muted-foreground">{t('ideaManagement.prioritize.unscoredHint')}</p>
        ) : (
          <div className="flex flex-wrap gap-2">{unscored.map(card)}</div>
        )}
      </div>

      {/* 3x3 grid with axis labels */}
      <div className="grid grid-cols-[auto_1fr] gap-2">
        {/* Value axis label (vertical) */}
        <div className="flex items-center">
          <span className="rotate-180 text-[11px] font-extrabold uppercase tracking-wide text-muted-foreground [writing-mode:vertical-rl]">
            {t('ideaManagement.prioritize.axisValue')} →
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {VALUE_ROWS.map((v) =>
            EFFORT_COLS.map((e) => (
              <div
                key={`${v}-${e}`}
                data-testid={`cell-${v}-${e}`}
                onDragOver={(ev) => ev.preventDefault()}
                onDrop={() => drop(v, e)}
                className={cn('min-h-[110px] rounded-xl p-2', cellTint(v, e))}
              >
                <div className="flex flex-col gap-1.5">{scoredAt(v, e).map(card)}</div>
              </div>
            )),
          )}
          {/* Effort axis label (horizontal), spanning the 3 columns */}
          <div className="col-span-3 pt-1 text-center text-[11px] font-extrabold uppercase tracking-wide text-muted-foreground">
            {t('ideaManagement.prioritize.axisEffort')} →
          </div>
        </div>
      </div>

      <IdeaScoreDialog
        open={dialogIdea != null}
        onOpenChange={(o) => !o && setDialogIdea(null)}
        ideaTitle={dialogIdea?.title}
        value={dialogIdea?.value_score ?? null}
        effort={dialogIdea?.effort_score ?? null}
        isPending={isScoring}
        onSave={(value, effort) => {
          if (dialogIdea) onScore(dialogIdea.id, value, effort);
          setDialogIdea(null);
        }}
        onClear={() => {
          if (dialogIdea) onScore(dialogIdea.id, null, null);
          setDialogIdea(null);
        }}
      />
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes.** Run: `npx vitest run src/components/community/PrioritizationMatrix`. Expected: PASS (3 tests).

- [ ] **Step 5: Commit.**

```bash
git add src/components/community/PrioritizationMatrix.tsx src/components/community/PrioritizationMatrix.test.tsx
git commit -m "$(printf 'feat(ideas): PrioritizationMatrix grid + unscored tray (#118)\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 8: `PriorityOverview` component

Quadrant counts + ranked "Do next" list + by-business-area rollup.

**Files:**
- Create: `src/components/community/PriorityOverview.tsx`
- Create: `src/components/community/PriorityOverview.test.tsx`

**Interfaces:**
- Consumes: `EnhancedIdea`, `getBand`/`rankIdeas`/`PRIORITIZABLE_STATUSES`, `PriorityBadge`, `BUSINESS_AREAS`.
- Produces:
  ```ts
  interface PriorityOverviewProps { ideas: EnhancedIdea[]; }
  ```
  Filters to `PRIORITIZABLE_STATUSES` internally.

- [ ] **Step 1: Write the failing test.** Create `src/components/community/PriorityOverview.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { PriorityOverview } from './PriorityOverview';
import type { EnhancedIdea } from '@/lib/community-types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

const idea = (over: Partial<EnhancedIdea>): EnhancedIdea => ({
  id: 'x', org_id: 'o', user_id: 'u', category_id: null, course_context_id: null,
  lesson_context_id: null, title: 'T', description: null, problem_statement: null,
  proposed_solution: null, expected_impact: null, status: 'accepted', submitted_at: null,
  created_at: '', updated_at: '', business_area: null, tags: [], current_process: null,
  pain_points: null, affected_roles: null, frequency_volume: null, proposed_improvement: null,
  desired_process: null, data_inputs: null, systems_involved: null, constraints_risks: null,
  success_metrics: null, admin_notes: null, rejection_reason: null, value_score: null,
  effort_score: null, ...over,
});

describe('PriorityOverview', () => {
  it('ranks scored ideas value desc → effort asc in the Do next list', () => {
    render(
      <PriorityOverview
        ideas={[
          idea({ id: 'a', title: 'Big bet', value_score: 3, effort_score: 3 }),
          idea({ id: 'b', title: 'Quick win', value_score: 3, effort_score: 1 }),
        ]}
      />,
    );
    const list = screen.getByTestId('do-next-list');
    const items = within(list).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Quick win');
    expect(items[1]).toHaveTextContent('Big bet');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.** Run: `npx vitest run src/components/community/PriorityOverview`. Expected: FAIL (module not found).

- [ ] **Step 3: Write the component.** Create `src/components/community/PriorityOverview.tsx`:

```tsx
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { TrendingUp } from 'lucide-react';
import type { EnhancedIdea } from '@/lib/community-types';
import { BUSINESS_AREAS } from '@/lib/community-types';
import { getBand, rankIdeas, PRIORITIZABLE_STATUSES, type PriorityBand } from '@/lib/idea-priority';
import { PriorityBadge } from './PriorityBadge';

interface PriorityOverviewProps {
  ideas: EnhancedIdea[];
}

const BANDS: PriorityBand[] = ['quick_win', 'big_bet', 'fill_in', 'deprioritize'];

export function PriorityOverview({ ideas }: PriorityOverviewProps) {
  const { t } = useTranslation();

  const inScope = useMemo(
    () => ideas.filter((i) => PRIORITIZABLE_STATUSES.includes(i.status)),
    [ideas],
  );

  const bandCounts = useMemo(() => {
    const counts: Record<PriorityBand, number> = { quick_win: 0, big_bet: 0, fill_in: 0, deprioritize: 0 };
    for (const i of inScope) {
      const band = getBand(i.value_score, i.effort_score);
      if (band) counts[band] += 1;
    }
    return counts;
  }, [inScope]);

  const ranked = useMemo(() => rankIdeas(inScope), [inScope]);

  const areaCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const i of inScope) {
      if (!i.business_area) continue;
      map.set(i.business_area, (map.get(i.business_area) ?? 0) + 1);
    }
    return BUSINESS_AREAS
      .map((a) => ({ ...a, count: map.get(a.value) ?? 0 }))
      .filter((a) => a.count > 0)
      .sort((a, b) => b.count - a.count);
  }, [inScope]);

  if (inScope.length === 0) return null;

  return (
    <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-3">
      {/* Quadrant summary */}
      <div className="rounded-2xl border border-[#e4e6ee] bg-card p-4">
        <div className="grid grid-cols-2 gap-2">
          {BANDS.map((band) => (
            <div key={band} className="rounded-xl bg-[#f3f4f8] p-3">
              <div className="text-[22px] font-extrabold leading-none">{bandCounts[band]}</div>
              <div className="mt-1 text-[11.5px] font-bold text-muted-foreground">
                {t(`ideaManagement.bands.${band}`)}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Do next */}
      <div className="rounded-2xl border border-[#e4e6ee] bg-card p-4">
        <h3 className="mb-3 text-[13px] font-extrabold tracking-[0.02em]">
          {t('ideaManagement.prioritize.doNext')}
        </h3>
        <ol data-testid="do-next-list" className="space-y-2">
          {ranked.map((idea, idx) => (
            <li key={idea.id} className="flex items-center gap-2 text-[13px]">
              <span className="w-4 shrink-0 text-right font-bold text-muted-foreground">{idx + 1}</span>
              <span className="flex-1 truncate font-semibold">{idea.title}</span>
              <PriorityBadge value={idea.value_score} effort={idea.effort_score} />
              <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-muted-foreground">
                <TrendingUp className="h-[11px] w-[11px]" />
                {idea.vote_count || 0}
              </span>
            </li>
          ))}
        </ol>
      </div>

      {/* By business area */}
      <div className="rounded-2xl border border-[#e4e6ee] bg-card p-4">
        <h3 className="mb-3 text-[13px] font-extrabold tracking-[0.02em]">
          {t('ideaManagement.prioritize.byBusinessArea')}
        </h3>
        <ul className="space-y-2">
          {areaCounts.map((a) => (
            <li key={a.value} className="flex items-center justify-between text-[13px]">
              <span className="font-semibold">{a.label}</span>
              <span className="text-muted-foreground">{t('ideaManagement.prioritize.count', { count: a.count })}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes.** Run: `npx vitest run src/components/community/PriorityOverview`. Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/components/community/PriorityOverview.tsx src/components/community/PriorityOverview.test.tsx
git commit -m "$(printf 'feat(ideas): PriorityOverview summary/do-next/by-area (#118)\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 9: Wire the Prioritize tab + Board card tag into `OrgIdeasManagement`

Integrate everything: header above tabs, Board/Prioritize tabs, the prioritize mutation, and the band tag on Board cards.

**Files:**
- Modify: `src/pages/org-admin/OrgIdeasManagement.tsx`

**Interfaces:**
- Consumes: `Tabs`/`TabsList`/`TabsTrigger`/`TabsContent`, `PrioritizationMatrix`, `PriorityOverview`, `PriorityBadge`, `updateIdeaPriority`, `queryKeys.ideasAdmin.all`.

- [ ] **Step 1: Add imports.** At the top of `OrgIdeasManagement.tsx`, add:

```tsx
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PrioritizationMatrix } from '@/components/community/PrioritizationMatrix';
import { PriorityOverview } from '@/components/community/PriorityOverview';
import { PriorityBadge } from '@/components/community/PriorityBadge';
```
and add `updateIdeaStatus, updateIdeaPriority` to the existing `@/lib/ideas-api` import (append `updateIdeaPriority`).

- [ ] **Step 2: Add tab state + prioritize mutation.** Inside the component, after the existing `statusMutation`, add:

```tsx
const [activeTab, setActiveTab] = useState<'board' | 'prioritize'>('board');

const prioritizeMutation = useMutation({
  mutationFn: ({ ideaId, value, effort }: { ideaId: string; value: number | null; effort: number | null }) =>
    updateIdeaPriority(ideaId, value, effort),
  onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.ideasAdmin.all }),
  onError: () => toast.error(t('ideaManagement.prioritize.scoreFailed')),
});
```

- [ ] **Step 3: Add the band tag to Board cards.** In the existing card render (the `columnIdeas.map(...)` block), inside the top badge row (after the `business_area` chip, before the "Open →" hint span), add:

```tsx
<PriorityBadge value={idea.value_score} effort={idea.effort_score} />
```

- [ ] **Step 4: Wrap the board + prioritize surfaces in Tabs.** Keep the header block (title, business-area `Select`, search `Input`) exactly where it is. Replace the block that currently renders the loading/empty/kanban (`{isLoading ? ... : ideas.length === 0 ? ... : (<div className="grid ...board...">)}`) with a `Tabs` wrapper. The **Board** tab holds the exact existing loading/empty/kanban JSX; the **Prioritize** tab holds the matrix + overview:

```tsx
<Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'board' | 'prioritize')}>
  <TabsList className="mb-4">
    <TabsTrigger value="board">{t('ideaManagement.tabs.board')}</TabsTrigger>
    <TabsTrigger value="prioritize">{t('ideaManagement.tabs.prioritize')}</TabsTrigger>
  </TabsList>

  <TabsContent value="board">
    {/* ← the existing isLoading / empty / kanban-grid block goes here verbatim */}
  </TabsContent>

  <TabsContent value="prioritize">
    {isLoading ? (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    ) : (
      <>
        <p className="mb-4 text-sm text-muted-foreground">{t('ideaManagement.prioritize.description')}</p>
        <PrioritizationMatrix
          ideas={ideas}
          isScoring={prioritizeMutation.isPending}
          onScore={(ideaId, value, effort) => prioritizeMutation.mutate({ ideaId, value, effort })}
        />
        <PriorityOverview ideas={ideas} />
      </>
    )}
  </TabsContent>
</Tabs>
```

(`ideas` is the existing `allIdeas.filter((i) => i.status !== 'draft')` list; the matrix/overview narrow it to `accepted`+`in_progress` themselves.)

- [ ] **Step 5: Run the full frontend gates.** Run:
```bash
npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm run build && npx vitest run src/lib/idea-priority src/components/community
```
Expected: all exit 0; the priority/component tests pass.

- [ ] **Step 6: Commit.**

```bash
git add src/pages/org-admin/OrgIdeasManagement.tsx
git commit -m "$(printf 'feat(ideas): wire Prioritize tab + board priority tags (#118)\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 10: Full verification + PR ready

**Files:** none (verification + docs).

- [ ] **Step 1: Run every gate.** Run, from the worktree root:
```bash
npm run lint && npm test && npx tsc --noEmit -p tsconfig.app.json && npm run build
```
then:
```bash
cd functions && npm run build && npm test && cd ..
```
Expected: all exit 0.

- [ ] **Step 2: Drive the feature (verify skill).** Use the `verify` skill / the repo's cache-seeded harness pattern (memory: "Verify gated UI via cache-seeded harness") to mount `OrgIdeasManagement` with a seeded TanStack cache containing a mix of `accepted`/`in_progress`/`submitted`/`done` ideas (some scored, some not). Confirm with Playwright: five board columns incl. In Progress; the Prioritize tab shows only accepted+in_progress on the grid + unscored tray; scoring via the dialog persists (mock the mutation) and a band tag appears on the Board card; the Do-next list is ordered. Capture a screenshot.

- [ ] **Step 3: Update bookkeeping.** Append a dated entry to `migration/WORKLOG.md` (append-only) summarizing #118, and update `migration/STATUS.html`'s checkpoint "In flight"/"Done" lines. Note the `04-idea-priority-scores.sql` live-DB migration as an owner action to run. Commit:
```bash
git add migration/WORKLOG.md migration/STATUS.html
git commit -m "$(printf 'docs: WORKLOG + STATUS for opportunity prioritization (#118)\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

- [ ] **Step 4: Push + mark PR ready.** Run:
```bash
git push origin feat/opportunity-prioritization-118
gh pr ready 212
```
Update the PR #212 body to describe the delivered feature and flag the `04-*.sql` migration as a required owner action before/at deploy. Delete the consumed spec + plan per the docs policy (ephemeral working notes) in the same or a follow-up commit if the team prefers keeping them until merge.

---

## Self-Review

**Spec coverage:**
- Board In Progress column → Task 1. ✅
- Value×Effort 3×3, Low/Med/High, nullable smallint → Tasks 2, 4, 7. ✅
- Tabs (Board/Prioritize) → Task 9. ✅
- Drag-to-cell + dialog fallback + unscored tray → Task 7. ✅
- Matrix population accepted+in_progress; orthogonal to status → `PRIORITIZABLE_STATUSES` (Task 4), enforced in Tasks 7/8; endpoint never touches status (Task 3). ✅
- Overview: quadrant counts + Do-next ranking + by-business-area → Task 8. ✅
- Board priority tag → Tasks 5, 9. ✅
- Backend: dedicated `idea-prioritize` + 2 nullable columns + `04-*.sql`; reads via `i.*` unchanged → Tasks 2, 3. ✅
- Field-exposure note (deliberate) → recorded in spec; no code needed. ✅
- i18n en+da; tests; verification gates → Tasks 5/others, Task 10. ✅

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every test step shows the assertion. ✅

**Type consistency:** `getBand(value, effort)`, `rankIdeas`, `PRIORITIZABLE_STATUSES`, `PriorityBand`, `updateIdeaPriority(ideaId, value, effort)`, `<PriorityBadge value effort />`, `onScore(ideaId, value, effort)` — names/signatures match across Tasks 4→5→7→8→9. Endpoint body `{ ideaId, value, effort }` matches the API function and the frontend mutation. ✅
