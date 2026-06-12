# Course-review entry point in the learner flow (#19)

**Date:** 2026-06-12
**Issue:** #19 — "No course-review entry point in the learner flow (CourseReviewDialog unreachable?)"
**Branch:** `martin/19-course-review-entry-point`
**Scope:** Frontend only.

## Problem

`CourseReviewDialog` is fully built and wired into `src/pages/learner/CoursePlayer.tsx`
(imported line 28, rendered line 683), but it is reachable through only one fragile,
transient path:

- The dialog opens only via the `showReviewDialog` state.
- `showReviewDialog` is set `true` only by the **"Leave a Review"** button inside
  `CourseCompletionDialog` (gated on `features.course_reviews_enabled`).
- `CourseCompletionDialog` opens only from `handleCompleteLesson()` at the instant the
  final lesson flips to complete (`isCourseComplete && !courseJustCompleted`).

That single path has three holes:

1. **Quiz as the last lesson, already passed/completed** → the player renders a
   **"Finish Course"** button that calls `navigate('/app/courses')` directly
   (`CoursePlayer.tsx:526`), bypassing the completion dialog entirely. This is the
   2026-06-06 sweep's "Finish Course goes straight to the courses list with no rating prompt."
2. **After the fact** — revisiting a completed course offers no entry point. `existingReview`
   is loaded and `CourseReviewDialog` even has an "Update Your Review" mode, but nothing can
   reopen it, so editing a review is impossible.
3. **`courseJustCompleted` guard** + dialog dismissal → no second chance in-session.

The backend (`/api/course-review`) and both dialogs are intentional, gated, working
functionality (cut over in Slice 1). The decision is therefore to **surface** a reliable
entry point, not remove the feature.

## Decision

Add a **persistent review entry point inside the course player**, independent of the
transient completion dialog.

- **Location:** the sidebar progress `Card`, directly under the `Progress` bar
  (around `CoursePlayer.tsx:345`).
- **Visibility condition:** render only when **both**
  - `features.course_reviews_enabled` is true, **and**
  - `progressPercent >= 20` (the learner has completed at least 20% of the course).
- **Label:** `existingReview ? 'Edit your review' : 'Rate this course'`, with the `Star`
  icon (consistent with the completion dialog's button).
- **Action:** `onClick={() => setShowReviewDialog(true)}` — opens the already-rendered
  `CourseReviewDialog`. No new dialog and no new state; reuses `showReviewDialog`.
- The existing completion-dialog "Leave a Review" path is left untouched (it still works
  when the completion dialog fires). The dialog's `onReviewSubmitted` already refetches
  `course-player-data` and updates `existingReview`, so after a first submit the button
  label flips to "Edit your review" automatically.

### Why ≥20% (not complete-only)

Per the issue owner: a learner who has engaged with the course (≥20% of lessons complete)
should be able to leave or edit a review without having to finish it first. `progressPercent`
is already computed at `CoursePlayer.tsx:293` as `(completedLessons / totalLessons) * 100`,
so the gate is `progressPercent >= 20`.

## Components & data flow

```
CoursePlayer
  state: showReviewDialog, existingReview (already present)
  derived: progressPercent (already present), features.course_reviews_enabled (already present)

  sidebar Card
    Progress bar
    [NEW] Review button   --(course_reviews_enabled && progressPercent >= 20)-->
           onClick -> setShowReviewDialog(true)

  CourseReviewDialog (already rendered)
    open = showReviewDialog
    existingReview -> "Update Your Review" mode when present
    onReviewSubmitted -> refetch -> setExistingReview -> button label flips
```

No new components, hooks, endpoints, types, or props. One additive button plus its
visibility guard in a single file.

## Out of scope (sibling-issue boundaries)

- **#18 (completion semantics):** the quiz "Finish Course" → `navigate('/app/courses')`
  behavior, `handleCompleteLesson`, `enrollment-complete`, and dashboard "Completed N"
  counting. Not touched — the new entry point makes review reachable regardless of how the
  course is finished, so the completion path needs no change here.
- **#17 (`functions/course-player-data`):** backend payload/access gate. Not touched; this
  change consumes the existing `review` field unchanged.

## Testing

- **New `src/pages/learner/CoursePlayer.test.tsx`** (mirror the RTL patterns in
  `src/pages/learner/Courses.test.tsx`):
  - Button hidden when `progressPercent < 20`.
  - Button hidden when `features.course_reviews_enabled` is false (even at ≥20%).
  - Button visible at `progressPercent >= 20` with reviews enabled.
  - Label is "Rate this course" with no `existingReview`, "Edit your review" with one.
  - Clicking the button opens `CourseReviewDialog` (dialog title visible).
- **Post-merge manual verification** on the PR-6 preview (Gate 4): take a course to ≥20%,
  see the button, open the dialog, submit a rating, confirm it persists and the label flips
  to "Edit your review" on reload.
- `npx tsc --noEmit` and `npm test` (frontend) green.

## Acceptance criteria (from #19)

> Either a reachable review flow exists (and is e2e-verified) or the dead path is removed;
> decision in WORKLOG.

Satisfied by: a reachable, persistent review entry point in the player (≥20% progress),
e2e-verified on the preview, with the surface-not-remove decision recorded in
`migration/WORKLOG.md` on merge.
