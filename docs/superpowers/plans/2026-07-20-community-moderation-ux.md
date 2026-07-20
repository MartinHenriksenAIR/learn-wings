# Community Moderation UX Implementation Plan (#164 + #169)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a searchable scope filter to the platform moderation queue (#164) and collapse the lock/hide button pairs into single state-reflecting toggles on both moderation views (#169).

**Architecture:** `community-reports` gains an additive `LEFT JOIN` returning each target's live `is_hidden`/`is_locked`, so a single toggle can reflect true state. The per-report action bar — duplicated verbatim in both moderation pages — is extracted into one shared `ReportActions` component. The platform page adds a `Popover`+`Command` scope combobox that switches which `fetchReports` variant runs.

**Tech Stack:** Azure Functions (v4, raw `pg`) · React 18 + Vite + TypeScript strict · shadcn/ui + Radix + Tailwind · TanStack Query v5 · i18next (en + da) · Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-07-20-community-moderation-ux-design.md`

## Global Constraints

- **i18n:** every new/changed user-facing string gets keys in BOTH `src/i18n/locales/en.json` and `da.json`.
- **Backend:** no new endpoint — extend the existing `community-reports` (already uses the `endpoint()` factory, ADR-0015). 500s stay generic (ADR-0014). Contract tests mock `shared/auth`, `shared/db`, `shared/profile`; never touch a real DB.
- **Frontend:** TypeScript strict; shadcn/Radix/Tailwind only; TanStack Query v5; no new state libs. Query keys come from the `queryKeys` factory (`src/lib/query-keys.ts`). Follow the existing moderation-page pattern (inline `useQuery` + `fetchReports`); do **not** introduce a new data hook (out of scope).
- **Behavior:** "All organizations" (default scope) = today's behavior = every report across global + all orgs. No change to report review/dismiss, `ReportedContentDialog` (#160), or report creation.
- **Verification gates (all exit 0):** root `npm run lint` · `npm test` · `npx tsc --noEmit -p tsconfig.app.json` · `npm run build`; `functions/` `npm run build` · `npm test`.
- **Commits:** end each message with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Use "Works on #164/#169" — no `Closes` keyword until the final PR-body update (auto-close fires on merge).
- **Worktree:** all paths are under `.claude/worktrees/feat+community-moderation-ux-164-169/`; run every command from there.

---

### Task 1: Backend — return target hide/lock state from `community-reports`

**Files:**
- Modify: `functions/community-reports/index.ts` (the `query(...)` SELECT + joins, ~lines 54-65)
- Test: `functions/community-reports/index.test.ts`

**Interfaces:**
- Produces: `community-reports` response rows now carry `target_is_hidden: boolean | null` and `target_is_locked: boolean | null` (post→post flags, comment→comment's `is_hidden` + `null` lock, deleted target→`null`).

- [ ] **Step 1: Write the failing tests**

Append inside the `describe('community-reports', …)` block in `functions/community-reports/index.test.ts`:

```ts
it('projects target hide/lock state via post + comment joins', async () => {
  mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });
  const res = await handler(baseReq({}), {} as any);
  expect(res.status).toBe(200);
  const [sql] = mockQuery.mock.calls[0] as [string, unknown[]];
  expect(sql).toContain('LEFT JOIN community_posts tp');
  expect(sql).toContain("r.target_type = 'post' AND tp.id = r.target_id");
  expect(sql).toMatch(/CASE WHEN r\.target_type = 'post' THEN tp\.is_hidden ELSE tc\.is_hidden END AS target_is_hidden/);
  expect(sql).toMatch(/CASE WHEN r\.target_type = 'post' THEN tp\.is_locked ELSE NULL END AS target_is_locked/);
});

it('passes target_is_hidden / target_is_locked through in the response', async () => {
  mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });
  const row = { ...sampleReport, target_is_hidden: true, target_is_locked: false };
  mockQuery.mockResolvedValueOnce([row]);
  const res = await handler(baseReq({}), {} as any);
  expect(JSON.parse(res.body as string)).toEqual({ reports: [row] });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd functions && npm test -- community-reports`
Expected: the two new tests FAIL (`sql` does not contain `LEFT JOIN community_posts tp`).

- [ ] **Step 3: Implement the join + columns**

In `functions/community-reports/index.ts`, replace the `query(...)` call's SQL so the SELECT adds two columns and the FROM adds the post join. The full new statement:

```ts
  const reports = await query(
    `SELECT r.*,
      json_build_object('id', rep.id, 'full_name', rep.full_name) AS reporter,
      CASE WHEN rev.id IS NULL THEN NULL ELSE json_build_object('id', rev.id, 'full_name', rev.full_name) END AS reviewer,
      CASE WHEN r.target_type = 'comment' THEN tc.post_id ELSE NULL END AS post_id,
      CASE WHEN r.target_type = 'post' THEN tp.is_hidden ELSE tc.is_hidden END AS target_is_hidden,
      CASE WHEN r.target_type = 'post' THEN tp.is_locked ELSE NULL END AS target_is_locked
     FROM community_reports r
     JOIN profiles rep ON rep.id = r.reporter_user_id
     LEFT JOIN profiles rev ON rev.id = r.reviewed_by
     LEFT JOIN community_comments tc ON r.target_type = 'comment' AND tc.id = r.target_id
     LEFT JOIN community_posts tp ON r.target_type = 'post' AND tp.id = r.target_id
     ${whereClause} ORDER BY r.created_at DESC`,
    params,
  );
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd functions && npm test -- community-reports`
Expected: PASS (all existing + the two new tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/martin/AIR/AIEDU/learn-wings/.claude/worktrees/feat+community-moderation-ux-164-169
git add functions/community-reports/index.ts functions/community-reports/index.test.ts
git commit -m "feat(community-reports): return target hide/lock state for moderation toggles

Adds target_is_hidden / target_is_locked via a LEFT JOIN so the moderation
queue can render single state-reflecting toggles (#169).

Works on #169.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Shared `ReportActions` component (+ type + "Unhide" copy)

**Files:**
- Modify: `src/lib/community-types.ts` (add fields to `CommunityReport`, ~lines 95-101)
- Modify: `src/i18n/locales/en.json` (`moderation.showPost`, `moderation.showComment`)
- Modify: `src/i18n/locales/da.json` (same two keys)
- Create: `src/components/community/ReportActions.tsx`
- Test: `src/components/community/ReportActions.test.tsx`

**Interfaces:**
- Consumes: `CommunityReport.target_is_hidden` / `target_is_locked` (Task 1's runtime data), `canViewReportedContent` from `src/lib/community-report-link.ts`.
- Produces: `ReportActions` component + `ReportActionsReport` type + `ReportActionsProps`:
  ```ts
  export type ReportActionsReport = Pick<CommunityReport,
    'id' | 'target_type' | 'target_id' | 'status' | 'post_id' | 'target_is_hidden' | 'target_is_locked'>;
  export interface ReportActionsProps {
    report: ReportActionsReport;
    onViewContent: () => void;
    onSetHidden: (hide: boolean) => void;
    onSetLocked: (lock: boolean) => void;
    onDismiss: () => void;
    onReview: () => void;
    visibilityPending: boolean;
    lockPending: boolean;
    updatePending: boolean;
  }
  ```
  Callbacks take no report argument — the consuming page binds per-item closures (the page's `report` is the full `ReportWithDetails`; passing it back would down-narrow the type).

- [ ] **Step 1: Add the type fields**

In `src/lib/community-types.ts`, inside `interface CommunityReport`, immediately after the `post_id?: string | null;` block (line ~95), add:

```ts
  /** Target's current moderation state, joined by community-reports (#169).
   *  post target → the post's flags; comment target → the comment's is_hidden
   *  (+ null lock); NULL when the target was deleted. */
  target_is_hidden?: boolean | null;
  target_is_locked?: boolean | null;
```

- [ ] **Step 2: Update the "Unhide" copy in both locales**

In `src/i18n/locales/en.json`:
```json
    "showPost": "Unhide post",
    "showComment": "Unhide comment",
```
In `src/i18n/locales/da.json`:
```json
    "showPost": "Vis opslag igen",
    "showComment": "Vis kommentar igen",
```
(Leave `hidePost`/`hideComment`/`lockPost`/`unlockPost` unchanged.)

- [ ] **Step 3: Write the failing component test**

Create `src/components/community/ReportActions.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ReportActions, type ReportActionsReport } from './ReportActions';

// t echoes keys so assertions pin i18n keys, not translated copy.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

const basePost: ReportActionsReport = {
  id: 'r1',
  target_type: 'post',
  target_id: 't1',
  status: 'pending',
  post_id: null,
  target_is_hidden: false,
  target_is_locked: false,
};

function setup(overrides: Partial<ReportActionsReport> = {}) {
  const h = {
    onViewContent: vi.fn(),
    onSetHidden: vi.fn(),
    onSetLocked: vi.fn(),
    onDismiss: vi.fn(),
    onReview: vi.fn(),
  };
  render(
    <TooltipProvider>
      <ReportActions
        report={{ ...basePost, ...overrides }}
        {...h}
        visibilityPending={false}
        lockPending={false}
        updatePending={false}
      />
    </TooltipProvider>,
  );
  return h;
}

describe('ReportActions', () => {
  it('shows Hide when a post is visible and hides on click', () => {
    const { onSetHidden } = setup({ target_is_hidden: false });
    expect(screen.queryByRole('button', { name: 'moderation.showPost' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'moderation.hidePost' }));
    expect(onSetHidden).toHaveBeenCalledWith(true);
  });

  it('shows Unhide (showPost key) when a post is hidden and unhides on click', () => {
    const { onSetHidden } = setup({ target_is_hidden: true });
    fireEvent.click(screen.getByRole('button', { name: 'moderation.showPost' }));
    expect(onSetHidden).toHaveBeenCalledWith(false);
  });

  it('toggles lock state for posts', () => {
    const { onSetLocked } = setup({ target_is_locked: false });
    fireEvent.click(screen.getByRole('button', { name: 'moderation.lockPost' }));
    expect(onSetLocked).toHaveBeenCalledWith(true);
  });

  it('renders no lock toggle for comment targets, and a comment hide label', () => {
    setup({ target_type: 'comment', post_id: 'p9', target_is_locked: null });
    expect(screen.queryByRole('button', { name: 'moderation.lockPost' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'moderation.unlockPost' })).toBeNull();
    expect(screen.getByRole('button', { name: 'moderation.hideComment' })).toBeInTheDocument();
  });

  it('disables toggles when the target was deleted (state null)', () => {
    setup({ target_is_hidden: null, target_is_locked: null });
    expect(screen.getByRole('button', { name: 'moderation.hidePost' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'moderation.lockPost' })).toBeDisabled();
  });

  it('hides dismiss/review actions when the report is not pending', () => {
    setup({ status: 'reviewed' });
    expect(screen.queryByRole('button', { name: 'moderation.dismiss' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'moderation.markReviewed' })).toBeNull();
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npm test -- ReportActions`
Expected: FAIL — cannot resolve `./ReportActions` (component not created yet).

- [ ] **Step 5: Create the component**

Create `src/components/community/ReportActions.tsx`:

```tsx
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { canViewReportedContent } from '@/lib/community-report-link';
import type { CommunityReport } from '@/lib/community-types';
import { Eye, EyeOff, Lock, Unlock, CheckCircle, XCircle } from 'lucide-react';

/** The report fields the moderation action bar needs. Both moderation pages
 *  pass a superset (ReportWithDetails), so a Pick keeps the contract minimal. */
export type ReportActionsReport = Pick<
  CommunityReport,
  'id' | 'target_type' | 'target_id' | 'status' | 'post_id' | 'target_is_hidden' | 'target_is_locked'
>;

export interface ReportActionsProps {
  report: ReportActionsReport;
  onViewContent: () => void;
  onSetHidden: (hide: boolean) => void;
  onSetLocked: (lock: boolean) => void;
  onDismiss: () => void;
  onReview: () => void;
  visibilityPending: boolean;
  lockPending: boolean;
  updatePending: boolean;
}

/**
 * Per-report moderation action bar, shared by the platform + org moderation
 * views (#169). Lock/hide are single toggles reflecting the target's current
 * state (target_is_locked / target_is_hidden from community-reports); a null
 * state means the target was deleted, so its toggle is disabled.
 */
export function ReportActions({
  report,
  onViewContent,
  onSetHidden,
  onSetLocked,
  onDismiss,
  onReview,
  visibilityPending,
  lockPending,
  updatePending,
}: ReportActionsProps) {
  const { t } = useTranslation();
  const isPost = report.target_type === 'post';
  const isHidden = !!report.target_is_hidden;
  const isLocked = !!report.target_is_locked;
  const hideDisabled = visibilityPending || report.target_is_hidden == null;
  const lockDisabled = lockPending || report.target_is_locked == null;

  const hideLabel = isPost
    ? (isHidden ? t('moderation.showPost') : t('moderation.hidePost'))
    : (isHidden ? t('moderation.showComment') : t('moderation.hideComment'));

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            onClick={onViewContent}
            disabled={!canViewReportedContent(report)}
          >
            <Eye className="h-3.5 w-3.5" />
            {t('moderation.viewContent')}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t('moderation.viewContent')}</TooltipContent>
      </Tooltip>

      <Button
        variant="outline"
        size="sm"
        onClick={() => onSetHidden(!isHidden)}
        disabled={hideDisabled}
      >
        {isHidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
        {hideLabel}
      </Button>

      {isPost && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => onSetLocked(!isLocked)}
          disabled={lockDisabled}
        >
          {isLocked ? <Unlock className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
          {isLocked ? t('moderation.unlockPost') : t('moderation.lockPost')}
        </Button>
      )}

      {report.status === 'pending' && (
        <>
          <div className="flex-1" />
          <Button variant="secondary" size="sm" onClick={onDismiss} disabled={updatePending}>
            <XCircle className="h-3.5 w-3.5" />
            {t('moderation.dismiss')}
          </Button>
          <Button size="sm" onClick={onReview} disabled={updatePending}>
            <CheckCircle className="h-3.5 w-3.5" />
            {t('moderation.markReviewed')}
          </Button>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm test -- ReportActions`
Expected: PASS (all six tests).

- [ ] **Step 7: Typecheck + commit**

```bash
cd /Users/martin/AIR/AIEDU/learn-wings/.claude/worktrees/feat+community-moderation-ux-164-169
npx tsc --noEmit -p tsconfig.app.json   # expect exit 0
git add src/lib/community-types.ts src/i18n/locales/en.json src/i18n/locales/da.json \
        src/components/community/ReportActions.tsx src/components/community/ReportActions.test.tsx
git commit -m "feat(community): shared ReportActions bar with single hide/lock toggles

One state-reflecting toggle each for hide/unhide and lock/unlock; relabels
Show -> Unhide. Extracted so both moderation views share it (#169).

Works on #169.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Adopt `ReportActions` in `OrgCommunityModeration`

**Files:**
- Modify: `src/pages/org-admin/OrgCommunityModeration.tsx`

**Interfaces:**
- Consumes: `ReportActions` from Task 2. Existing mutations `toggleContentVisibility`, `togglePostLock`, `updateReportMutation`, `openReviewDialog`, `setViewReport` are reused unchanged.

- [ ] **Step 1: Swap imports**

In `src/pages/org-admin/OrgCommunityModeration.tsx`:
- Add: `import { ReportActions } from '@/components/community/ReportActions';`
- Remove the now-unused imports:
  - the `Tooltip, TooltipContent, TooltipTrigger` import block (from `@/components/ui/tooltip`),
  - `canViewReportedContent` (from `@/lib/community-report-link`),
  - `Eye, EyeOff, Lock, Unlock` from the `lucide-react` import (keep `Loader2, CheckCircle, XCircle, Flag, MessageSquare, FileText`).

- [ ] **Step 2: Replace the action-bar JSX**

Replace the entire action-controls block — the `<div className="flex flex-wrap items-center gap-2.5"> … </div>` that starts at the `{/* Action controls … */}` comment and ends just before `</CardContent>` — with:

```tsx
                  <ReportActions
                    report={report}
                    onViewContent={() => setViewReport(report)}
                    onSetHidden={(hide) =>
                      toggleContentVisibility.mutate({ type: report.target_type, id: report.target_id, hide })
                    }
                    onSetLocked={(lock) => togglePostLock.mutate({ postId: report.target_id, lock })}
                    onDismiss={() => updateReportMutation.mutate({ reportId: report.id, status: 'dismissed' })}
                    onReview={() => openReviewDialog(report)}
                    visibilityPending={toggleContentVisibility.isPending}
                    lockPending={togglePostLock.isPending}
                    updatePending={updateReportMutation.isPending}
                  />
```

- [ ] **Step 3: Verify gates (no page unit test — this is wiring)**

Run:
```bash
npx tsc --noEmit -p tsconfig.app.json   # exit 0 (no unused-import / type errors)
npm run lint                             # exit 0
npm test -- ReportActions                # still PASS
```
Expected: all exit 0. Manually confirm the block compiles and no `Eye/EyeOff/Lock/Unlock/Tooltip/canViewReportedContent` references remain in this file (`grep -n 'EyeOff\|canViewReportedContent\|TooltipTrigger' src/pages/org-admin/OrgCommunityModeration.tsx` → no output).

- [ ] **Step 4: Commit**

```bash
git add src/pages/org-admin/OrgCommunityModeration.tsx
git commit -m "refactor(moderation): org view uses shared ReportActions

Works on #169.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Adopt `ReportActions` in `PlatformCommunityModeration`

**Files:**
- Modify: `src/pages/platform-admin/PlatformCommunityModeration.tsx`

**Interfaces:**
- Consumes: `ReportActions` from Task 2. Mirrors Task 3 exactly (same page shape).

- [ ] **Step 1: Swap imports**

In `src/pages/platform-admin/PlatformCommunityModeration.tsx`:
- Add: `import { ReportActions } from '@/components/community/ReportActions';`
- Remove: the `Tooltip, TooltipContent, TooltipTrigger` import block; `canViewReportedContent`; and `Eye, EyeOff, Lock, Unlock` from `lucide-react` (keep `Loader2, CheckCircle, XCircle, Flag, MessageSquare, FileText`).

- [ ] **Step 2: Replace the action-bar JSX**

Replace the same action-controls block (`{/* Action controls … */}` `<div className="flex flex-wrap items-center gap-2.5"> … </div>`) with:

```tsx
                  <ReportActions
                    report={report}
                    onViewContent={() => setViewReport(report)}
                    onSetHidden={(hide) =>
                      toggleContentVisibility.mutate({ type: report.target_type, id: report.target_id, hide })
                    }
                    onSetLocked={(lock) => togglePostLock.mutate({ postId: report.target_id, lock })}
                    onDismiss={() => updateReportMutation.mutate({ reportId: report.id, status: 'dismissed' })}
                    onReview={() => openReviewDialog(report)}
                    visibilityPending={toggleContentVisibility.isPending}
                    lockPending={togglePostLock.isPending}
                    updatePending={updateReportMutation.isPending}
                  />
```

- [ ] **Step 3: Verify gates**

Run:
```bash
npx tsc --noEmit -p tsconfig.app.json   # exit 0
npm run lint                             # exit 0
npm test -- ReportActions                # still PASS
```
Confirm no stale references: `grep -n 'EyeOff\|canViewReportedContent\|TooltipTrigger' src/pages/platform-admin/PlatformCommunityModeration.tsx` → no output.

- [ ] **Step 4: Commit**

```bash
git add src/pages/platform-admin/PlatformCommunityModeration.tsx
git commit -m "refactor(moderation): platform view uses shared ReportActions

Works on #169.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Scope selector on the platform moderation view (#164)

**Files:**
- Modify: `src/lib/query-keys.ts` (`platformReports.list`, ~lines 158-166)
- Modify: `src/pages/platform-admin/PlatformCommunityModeration.tsx`
- Modify: `src/i18n/locales/en.json` (`platformModeration.*`)
- Modify: `src/i18n/locales/da.json` (`platformModeration.*`)

**Interfaces:**
- Consumes: `useOrganizations()` (already on the page for `orgsMap`), `fetchReports(orgId?, { scope?, status? })`.
- Produces: `queryKeys.platformReports.list(scope, activeTab)` — key `['platform-reports', scope, activeTab]` (keeps the `['platform-reports']` prefix so `.all` invalidation still matches).

- [ ] **Step 1: Add scope dimension to the query key**

In `src/lib/query-keys.ts`, replace the `platformReports.list` definition:

```ts
  platformReports: {
    /** ['platform-reports'] — use for invalidation prefix */
    all: ['platform-reports'] as const,
    /**
     * Full key: ['platform-reports', scope, activeTab]
     * scope is 'all' | 'global' | <orgId>; parameter order matches the query
     * in PlatformCommunityModeration.tsx.
     */
    list: (scope: string, activeTab: string) =>
      ['platform-reports', scope, activeTab] as const,
  },
```

- [ ] **Step 2: Add the scope i18n keys (both locales)**

In `src/i18n/locales/en.json`, extend the `platformModeration` block (after `"scopeOrganization": "Organization"`, add a comma to that line):

```json
    "scopeOrganization": "Organization",
    "scopeAll": "All organizations",
    "scopeSelectLabel": "Scope",
    "scopeSearchPlaceholder": "Search organizations...",
    "scopeNoResults": "No organizations found"
```

In `src/i18n/locales/da.json`, the matching block (after `"scopeOrganization": "Organisation"`, add a comma):

```json
    "scopeOrganization": "Organisation",
    "scopeAll": "Alle organisationer",
    "scopeSelectLabel": "Område",
    "scopeSearchPlaceholder": "Søg organisationer...",
    "scopeNoResults": "Ingen organisationer fundet"
```

- [ ] **Step 3: Add combobox imports + icons**

In `src/pages/platform-admin/PlatformCommunityModeration.tsx`, add:

```tsx
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
```
and add `Check, ChevronsUpDown` to the existing `lucide-react` import.

- [ ] **Step 4: Add scope state and make the query scope-aware**

Add state near the other `useState` hooks:

```tsx
  const [scope, setScope] = useState<string>('all');
  const [scopeOpen, setScopeOpen] = useState(false);
```

Replace the reports `useQuery` with the scope-aware version:

```tsx
  const { data: reports = [], isLoading } = useQuery({
    queryKey: queryKeys.platformReports.list(scope, activeTab),
    queryFn: async () => {
      const data =
        scope === 'all'
          ? await fetchReports(undefined, { status: activeTab })
          : scope === 'global'
            ? await fetchReports(undefined, { scope: 'global', status: activeTab })
            : await fetchReports(scope, { status: activeTab });
      return data as ReportWithDetails[];
    },
  });
```

- [ ] **Step 5: Render the scope combobox**

Add the active-scope label derivation just before `return (` (reuses the existing `orgsMap`):

```tsx
  const scopeLabel =
    scope === 'all'
      ? t('platformModeration.scopeAll')
      : scope === 'global'
        ? t('platformModeration.scopeGlobal')
        : orgsMap?.get(scope) ?? t('platformModeration.scopeOrganization');
```

Insert this block between the header `</div>` and the `<SlidingTabs …/>`:

```tsx
      {/* Scope filter (#164) */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-muted-foreground">
          {t('platformModeration.scopeSelectLabel')}
        </span>
        <Popover open={scopeOpen} onOpenChange={setScopeOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              role="combobox"
              aria-expanded={scopeOpen}
              className="w-[240px] justify-between"
            >
              {scopeLabel}
              <ChevronsUpDown className="ml-2 h-4 w-4 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[240px] p-0" align="start">
            <Command>
              <CommandInput placeholder={t('platformModeration.scopeSearchPlaceholder')} />
              <CommandList>
                <CommandEmpty>{t('platformModeration.scopeNoResults')}</CommandEmpty>
                <CommandGroup>
                  <CommandItem
                    value={t('platformModeration.scopeAll')}
                    onSelect={() => { setScope('all'); setScopeOpen(false); }}
                  >
                    <Check className={cn('mr-2 h-4 w-4', scope === 'all' ? 'opacity-100' : 'opacity-0')} />
                    {t('platformModeration.scopeAll')}
                  </CommandItem>
                  <CommandItem
                    value={t('platformModeration.scopeGlobal')}
                    onSelect={() => { setScope('global'); setScopeOpen(false); }}
                  >
                    <Check className={cn('mr-2 h-4 w-4', scope === 'global' ? 'opacity-100' : 'opacity-0')} />
                    {t('platformModeration.scopeGlobal')}
                  </CommandItem>
                  {(orgsData ?? []).map((org) => (
                    <CommandItem
                      key={org.id}
                      value={org.name}
                      onSelect={() => { setScope(org.id); setScopeOpen(false); }}
                    >
                      <Check className={cn('mr-2 h-4 w-4', scope === org.id ? 'opacity-100' : 'opacity-0')} />
                      {org.name}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>
```

> Note: `orgsData` is the array from `useOrganizations()` already destructured on the page as `const { data: orgsData } = useOrganizations(...)`. `cn` is already imported. If `orgsData` isn't destructured (only `orgsMap` is built), also destructure `data: orgsData` from the existing `useOrganizations` call.

- [ ] **Step 6: Verify gates**

Run:
```bash
npx tsc --noEmit -p tsconfig.app.json   # exit 0
npm run lint                             # exit 0
npm test                                 # all PASS
```

- [ ] **Step 7: Commit**

```bash
git add src/lib/query-keys.ts src/pages/platform-admin/PlatformCommunityModeration.tsx \
        src/i18n/locales/en.json src/i18n/locales/da.json
git commit -m "feat(moderation): searchable scope filter on platform queue

All organizations / Global / a specific org, via a Popover+Command combobox;
the query key gains a scope dimension (#164).

Works on #164.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Full verification sweep + PR finalize

**Files:** none (verification + PR metadata)

- [ ] **Step 1: Run every gate**

```bash
cd /Users/martin/AIR/AIEDU/learn-wings/.claude/worktrees/feat+community-moderation-ux-164-169
npm run lint
npm test
npx tsc --noEmit -p tsconfig.app.json
npm run build
cd functions && npm run build && npm test && cd ..
```
Expected: every command exits 0.

- [ ] **Step 2: Drive the UI (verify skill)**

Invoke the `verify` skill to exercise both moderation views. Because these are Entra-gated (no local DB/login), use the cache-seeded Vite harness + Playwright approach (see memory `verify_gated_ui_harness`): mount each page with a TanStack cache pre-seeded with reports carrying `target_is_hidden`/`target_is_locked`, and confirm (a) the scope combobox filters, (b) a visible post shows "Hide"/"Lock", a hidden post shows "Unhide", a locked post shows "Unlock", (c) a comment report shows no lock toggle, (d) a deleted-target report disables the toggle. Capture screenshots as PR evidence.

- [ ] **Step 3: Push + update the PR body**

```bash
git push
```
Then update PR #184's body checklist to checked, and change "Works on #164, #169." to "Closes #164, #169." so merge auto-closes both. (Do the actual merge/deploy via the `handoff` skill, not here.)

---

## Self-Review

**1. Spec coverage**
- Backend join + `target_is_hidden`/`target_is_locked` → Task 1. ✓
- Type fields → Task 2 Step 1. ✓
- Shared `ReportActions` + single toggles + "Unhide" rename → Task 2. ✓
- Both views adopt it → Tasks 3 (org) + 4 (platform). ✓
- Scope selector + query-key dimension + scope i18n → Task 5. ✓
- Testing (contract test, component test, gates) → Tasks 1, 2, 6. ✓
- "All organizations" = everything, no scope on org view, no dialog change → honored (Task 5 `scope==='all'`, org page untouched by #164). ✓

**2. Placeholder scan:** No TBD/TODO; every code step shows complete code. ✓

**3. Type consistency:** `ReportActionsReport`/`ReportActionsProps` defined in Task 2 are used verbatim in Tasks 3–4; callbacks are argument-free (matching the closure-binding decision); `platformReports.list(scope, activeTab)` defined in Task 5 Step 1 is called with `(scope, activeTab)` in Step 4. `target_is_hidden`/`target_is_locked` names match across Tasks 1, 2, and the component. ✓
