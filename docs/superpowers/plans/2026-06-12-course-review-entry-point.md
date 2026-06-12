# Course-review entry point Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent "Rate / edit review" button to the learner course player so the existing `CourseReviewDialog` is reliably reachable at ≥20% course progress.

**Architecture:** One additive button in `CoursePlayer.tsx`'s sidebar card, guarded by `features.course_reviews_enabled && progressPercent >= REVIEW_MIN_PROGRESS`, opening the already-rendered `CourseReviewDialog` via the existing `showReviewDialog` state. No new components, hooks, endpoints, types, or backend changes. New component test mirrors `src/pages/learner/Courses.test.tsx` mocking conventions.

**Tech Stack:** React + TypeScript, Vite, Vitest + React Testing Library, Radix Dialog (`@/components/ui/dialog`), lucide-react icons.

**Spec:** `docs/superpowers/specs/2026-06-12-course-review-entry-point-design.md`

**Run all commands from the worktree root:** `/Users/martin/AIR/AIEDU/lw-issue-19`

---

## File Structure

- **Modify** `src/pages/learner/CoursePlayer.tsx`
  - Add `Star` to the existing `lucide-react` import.
  - Add a module-scope constant `REVIEW_MIN_PROGRESS = 20`.
  - Render the review button in the sidebar `CardHeader`, immediately after the `Progress` bar.
- **Create** `src/pages/learner/CoursePlayer.test.tsx`
  - Component test: visibility thresholds, feature gate, label, dialog-opens.

No other files change. `CourseReviewDialog`, `CourseCompletionDialog`, `usePlatformSettings`, and `/api/course-review` are reused as-is.

---

### Task 1: Review entry-point button in the course player

**Files:**
- Create: `src/pages/learner/CoursePlayer.test.tsx`
- Modify: `src/pages/learner/CoursePlayer.tsx` (import line 14-24; sidebar `CardHeader` ~line 338-347; add module constant near top)

- [ ] **Step 1: Write the failing test**

Create `src/pages/learner/CoursePlayer.test.tsx` with exactly this content:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import React from 'react';

// AppLayout → passthrough (skips breadcrumbs/i18n)
vi.mock('@/components/layout/AppLayout', () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// PdfViewer → stub (avoids pulling in the pdf.js worker at import time)
vi.mock('@/components/learner/PdfViewer', () => ({
  PdfViewer: () => <div data-testid="pdf-viewer" />,
}));

// api-client + storage → no network. Wrapping a `mock`-prefixed vi.fn() in the factory
// keeps callApi's generic return type satisfied for tsc (matches CoursesManager.test.tsx).
const mockCallApi = vi.fn();
vi.mock('@/lib/api-client', () => ({
  callApi: (...args: unknown[]) => mockCallApi(...args),
}));
vi.mock('@/lib/storage', () => ({ getSignedAssetUrl: vi.fn() }));

// toast → no-op
vi.mock('@/components/ui/sonner', () => ({ toast: vi.fn() }));

// useAuth + usePlatformSettings → factory mocks (names MUST be `mock`-prefixed for hoisting)
const mockUseAuth = vi.fn();
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => mockUseAuth() }));

const mockUsePlatformSettings = vi.fn();
vi.mock('@/hooks/usePlatformSettings', () => ({
  usePlatformSettings: () => mockUsePlatformSettings(),
}));

import CoursePlayer from './CoursePlayer';

const baseAuth = {
  user: { id: 'u-1', tid: 'tid-1', email: 'test@example.com', name: 'Test User' },
  profile: { id: 'p-1', is_platform_admin: false },
  currentOrg: { id: 'org-1', name: 'Org One', slug: 'org-one' },
  isLoading: false,
};

function makeModules(lessonCount: number) {
  return [
    {
      id: 'm-1',
      title: 'Module 1',
      sort_order: 0,
      lessons: Array.from({ length: lessonCount }, (_, i) => ({
        id: `l-${i + 1}`,
        title: `Lesson ${i + 1}`,
        lesson_type: 'video',
        module_id: 'm-1',
        sort_order: i,
      })),
    },
  ];
}

function makeProgress(completedIds: string[]) {
  const map: Record<string, { status: string; completed_at: string }> = {};
  completedIds.forEach((id) => {
    map[id] = { status: 'completed', completed_at: '2026-06-12T00:00:00Z' };
  });
  return map;
}

// Configure the player payload + feature flag for a single test.
function setup(opts: {
  reviewsEnabled: boolean;
  completed: string[];
  review?: { id: string; rating: number; comment: string } | null;
}) {
  mockUseAuth.mockReturnValue(baseAuth);
  mockUsePlatformSettings.mockReturnValue({
    features: {
      certificates_enabled: false,
      quizzes_enabled: true,
      analytics_enabled: true,
      course_reviews_enabled: opts.reviewsEnabled,
      community_enabled: true,
    },
  });
  mockCallApi.mockImplementation(async (url: string) => {
    if (url === '/api/course-player-data') {
      return Promise.resolve({
        course: { id: 'c-1', title: 'Intro to AI', is_published: true },
        modules: makeModules(5),
        progressMap: makeProgress(opts.completed),
        review: opts.review ?? null,
      });
    }
    if (url === '/api/quiz-by-lesson') {
      return Promise.resolve({ quiz: null, questions: [] });
    }
    return Promise.resolve({});
  });
}

function renderPlayer() {
  return render(
    <MemoryRouter initialEntries={['/app/courses/c-1']}>
      <Routes>
        <Route path="/app/courses/:courseId" element={<CoursePlayer />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('CoursePlayer — review entry point', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('hides the review button below 20% progress', async () => {
    setup({ reviewsEnabled: true, completed: [] }); // 0/5 = 0%
    renderPlayer();
    await screen.findByText('Intro to AI'); // wait for load
    expect(screen.queryByRole('button', { name: /rate this course/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /edit your review/i })).toBeNull();
  });

  it('hides the review button when course reviews are disabled, even at >=20%', async () => {
    setup({ reviewsEnabled: false, completed: ['l-1'] }); // 1/5 = 20%
    renderPlayer();
    await screen.findByText('Intro to AI');
    expect(screen.queryByRole('button', { name: /rate this course/i })).toBeNull();
  });

  it('shows "Rate this course" at >=20% with reviews enabled and no existing review', async () => {
    setup({ reviewsEnabled: true, completed: ['l-1'], review: null }); // 20%
    renderPlayer();
    expect(await screen.findByRole('button', { name: /rate this course/i })).toBeInTheDocument();
  });

  it('shows "Edit your review" when an existing review is present', async () => {
    setup({
      reviewsEnabled: true,
      completed: ['l-1'],
      review: { id: 'r-1', rating: 4, comment: 'Nice' },
    });
    renderPlayer();
    expect(await screen.findByRole('button', { name: /edit your review/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /rate this course/i })).toBeNull();
  });

  it('opens CourseReviewDialog when the button is clicked', async () => {
    setup({ reviewsEnabled: true, completed: ['l-1'], review: null });
    renderPlayer();
    const button = await screen.findByRole('button', { name: /rate this course/i });
    fireEvent.click(button);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Rate This Course')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run src/pages/learner/CoursePlayer.test.tsx`
Expected: FAIL — the three "shows/opens" tests fail with "Unable to find an accessible element with the role 'button' and name `/rate this course/i`" (the button does not exist yet). The two "hides" tests may pass vacuously; that is fine.

- [ ] **Step 3: Add the `Star` icon import**

In `src/pages/learner/CoursePlayer.tsx`, extend the existing lucide-react import (lines 14-24) to include `Star`:

```tsx
import { 
  ChevronRight, 
  CheckCircle2, 
  Circle, 
  Play, 
  FileText, 
  HelpCircle,
  Loader2,
  ArrowLeft,
  ArrowRight,
  Star
} from 'lucide-react';
```

- [ ] **Step 4: Add the progress-threshold constant**

In `src/pages/learner/CoursePlayer.tsx`, add this module-scope constant immediately after the imports and before `export default function CoursePlayer()` (around line 29):

```tsx
// Minimum course progress (percent of lessons completed) before the review entry point appears.
const REVIEW_MIN_PROGRESS = 20;
```

- [ ] **Step 5: Render the review button in the sidebar**

In `src/pages/learner/CoursePlayer.tsx`, inside the sidebar `CardHeader` (currently lines 338-347), add the button immediately after the `<Progress ... />` element. The block becomes:

```tsx
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{course.title}</CardTitle>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Progress</span>
                  <span className="font-medium">{completedLessons}/{totalLessons}</span>
                </div>
                <Progress value={progressPercent} className="h-2" />
              </div>
              {features.course_reviews_enabled && progressPercent >= REVIEW_MIN_PROGRESS && (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3 w-full"
                  onClick={() => setShowReviewDialog(true)}
                >
                  <Star className="mr-2 h-4 w-4" />
                  {existingReview ? 'Edit your review' : 'Rate this course'}
                </Button>
              )}
            </CardHeader>
```

(`features`, `progressPercent`, `existingReview`, `setShowReviewDialog`, and `Button` are all already in scope — no other change needed.)

- [ ] **Step 6: Run the test and confirm it passes**

Run: `npx vitest run src/pages/learner/CoursePlayer.test.tsx`
Expected: PASS — 5 passed.

- [ ] **Step 7: Type-check and run the full frontend suite**

Run: `npx tsc --noEmit`
Expected: exit 0, no output.

Run: `npm test`
Expected: all test files pass (the new `CoursePlayer.test.tsx` included), exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/pages/learner/CoursePlayer.tsx src/pages/learner/CoursePlayer.test.tsx
git commit -m "fix(course-player): surface course-review entry point (#19)

Add a persistent 'Rate this course' / 'Edit your review' button in the
player sidebar, shown at >=20% progress when course reviews are enabled.
Opens the existing CourseReviewDialog via showReviewDialog — the dialog
was previously reachable only through the transient completion dialog,
so revisits and edits had no entry point.

New CoursePlayer.test.tsx covers the visibility threshold, the feature
gate, the label (rate vs edit), and that clicking opens the dialog.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Finalize the PR

**Files:** none (PR metadata + bookkeeping only).

- [ ] **Step 1: Push the branch**

Run: `git push`
Expected: branch `martin/19-course-review-entry-point` updated on origin.

- [ ] **Step 2: Update PR #97 body and mark ready for review**

Replace the claim body with a real summary (problem, the in-player ≥20% entry point, files, verification: `tsc` 0 + `npm test` green, Gate 4 deferred to post-merge preview). Then:

Run: `gh pr ready 97`
Expected: PR #97 marked ready for review.

- [ ] **Step 3: Note the surface-not-remove decision for WORKLOG**

The `migration/WORKLOG.md` append + `migration/STATUS.html` checkpoint update happen at merge via the `handoff` skill. Record there: "#19 — surfaced the course-review flow (persistent in-player entry at ≥20% progress) rather than removing it; CourseReviewDialog/`/api/course-review` were intentional Slice-1 functionality." This satisfies the issue's "decision in WORKLOG" acceptance clause.

- [ ] **Step 4: Gate 4 (post-merge, on PR-6 preview)**

After merge + deploy-from-trunk: open a course as a learner, complete ≥20% of lessons, confirm the "Rate this course" button appears, open the dialog, submit a rating, reload, confirm it persists and the button now reads "Edit your review." Record the result on the issue/PR.

---

## Notes for the implementer

- This is frontend-only. Do **not** touch `functions/course-player-data` (#17) or any completion/enrollment logic or the quiz "Finish Course" navigation (#18).
- Radix `DialogContent` carries `role="dialog"` and portals into `document.body`; `screen.findByRole('dialog')` resolves it after the click-triggered state update.
- The button label string "Rate this course" (lowercase "this") is intentionally distinct from the dialog title "Rate This Course" so the tests can target each unambiguously.
