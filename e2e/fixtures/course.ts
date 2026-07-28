import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Course-manager actions for write journeys.
 *
 * **Neither helper navigates.** The caller arrives via `gotoFenced` and these act on
 * whatever page is open. That is not a stylistic rule: `page.goto` reboots the SPA,
 * and `currentOrg` is plain component state (useAuth.tsx:49) that nothing persists,
 * so a navigation inside a helper would drop the caller's fence and leave
 * `OrgSelector` on whatever `orgs[0]` happens to be (OrgSelector.tsx:28,42).
 *
 * What the fence does and does not bound here is worth stating plainly, because the
 * course endpoints are not org-scoped: `course-create` inserts into `courses` with
 * `(title, description, level, language, thumbnail_url, created_by_user_id,
 * is_published)` and never reads an org id at all (functions/course-create/index.ts),
 * and `courses-admin` returns the whole platform list. So a course is NOT confined to
 * the fenced organization — nothing about it could be. What keeps these writes
 * identifiable and reversible is the RUN_ID in their title (e2e/run-id.ts) plus the
 * caller deleting what it made. The fence still matters to the journey: it is the
 * organization the run owns, `gotoFenced` re-asserts that the app is pointed at it,
 * and the course-manager page reads the org list for its access matrix.
 */

/**
 * Budget for one course write to land: an Azure Functions call plus whatever the
 * page does with the answer. Wider than the config's 15s `expect` default, which was
 * sized for assertions on already-rendered state — a cold function start alone can
 * eat it. Deliberately not imported from ./fenced-org, whose identically-valued
 * constant is about the organization endpoints; these are separate budgets that
 * happen to agree today.
 */
const WRITE_TIMEOUT = 30_000;

/** `coursesManager.newCourse` — the create-dialog trigger. */
const NEW_COURSE = 'New Course';

/** `coursesManager.titlePlaceholder` — the create dialog's title field. */
const TITLE_PLACEHOLDER = 'Course title';

/** `coursesManager.create` — the create dialog's submit button. */
const CREATE_CONFIRM = 'Create';

/**
 * The accessible name shared by the row's delete trigger and the confirm button in
 * the dialog it opens.
 *
 * Measured against the live app, not inferred: the row's icon button carries
 * `aria-label={t('coursesManager.deleteCourse')}` (CoursesManager.tsx:505) and the
 * `AlertDialogAction` renders `t('courseDelete.confirm')`
 * (DeleteCourseDialog.tsx:55) — two different keys whose English values are both
 * "Delete course". So the name cannot tell the trigger from its own confirmation,
 * which is why the confirm click below is scoped to the `alertdialog`. The editor
 * page's delete button is a third string, `courseEditor.deleteCourse` = "Delete
 * Course" — a different capitalisation that `exact: true` keeps distinct.
 */
const DELETE_AFFORDANCE = 'Delete course';

/** The destructive-toast titles `useToastMutation` renders for these two writes. */
const CREATE_FAILURE = 'Failed to create course';
const DELETE_FAILURE = 'Failed to delete course';

/**
 * The create-dialog trigger, which doubles as the course list's loaded signal.
 *
 * `CoursesManager` returns a bare `PageSpinner` while either the course list or the
 * org list is loading (CoursesManager.tsx:270-276), so this button existing is what
 * separates a loaded list from one that has not arrived.
 *
 * `.first()` because the page renders this same string twice when the list is empty:
 * the header's `DialogTrigger` (CoursesManager.tsx:303) and the `EmptyState` action
 * (CoursesManager.tsx:436). Both open the one create dialog — the trigger through
 * Radix, the empty-state button through `setCreateOpen(true)` — so which one is
 * clicked carries no meaning. Prod has 11 courses today and the measured count is 1;
 * `.first()` is here so that an empty list is an empty list rather than a strict-mode
 * violation.
 */
function newCourseButton(page: Page): Locator {
  return page.getByRole('button', { name: NEW_COURSE, exact: true }).first();
}

/**
 * A course's row-title cell on the course-manager list.
 *
 * A `<button>`, not a link: each row renders the title as a button that calls
 * `navigate()` to the editor (CoursesManager.tsx:454-469). Unlike the organizations
 * list — whose row button concatenates every cell into its accessible name — this
 * one wraps only the thumbnail and the title, and the thumbnail is `alt=""`
 * (CoursesManager.tsx:462), so the accessible name is the title and nothing else.
 * That makes `exact: true` a real equality test here.
 *
 * Exported because it is this journey's oracle as well as its locator: "the list
 * shows a row for this course" is the claim both the helpers and the spec make, and
 * two copies of it would drift. It is also deliberately narrower than
 * `getByText(title)` — the editor page renders the title as breadcrumb text
 * (CourseEditor.tsx:526), which a text locator matches (measured: 1) and this one
 * does not (measured: 0). An assertion that must only hold on the list has to be
 * unsatisfiable on the editor, or re-navigating to the list proves nothing.
 */
export function courseRowTitle(page: Page, title: string): Locator {
  return page.getByRole('button', { name: title, exact: true });
}

/**
 * The whole row for `title`, for scoping the per-row action buttons.
 *
 * The row is a plain `<div class="grid …">` with no table semantics — measured
 * `role=table` and `role=row` counts are both 0 on this page, so a `getByRole('row')`
 * locator would match nothing at all. The title button is a direct child of that div
 * (CoursesManager.tsx:450-469; measured `titleBtn.parentElement === row`), so its
 * parent is the row. Scoping is required rather than tidy: every row renders a delete
 * trigger under one shared `aria-label`, so the page-wide count is one per course
 * (measured: 11).
 */
function courseRow(page: Page, title: string): Locator {
  return courseRowTitle(page, title).locator('..');
}

/**
 * Create a course from the course-manager list page.
 *
 * Only the title is set. Level and language keep the dialog's defaults — `basic` and
 * Danish (CoursesManager.tsx:66-67) — which `course-create` accepts, so the journey
 * does not depend on operating two Radix selects it makes no claim about.
 */
export async function createCourse(page: Page, opts: { title: string }): Promise<void> {
  // Explicit, rather than left to the click's own auto-wait: the list is behind a
  // spinner until /api/courses-admin and /api/organizations both answer, and a cold
  // start outlasts the config's `actionTimeout`, which is sized for clicks on
  // rendered UI.
  await expect(newCourseButton(page), 'the course list never finished loading, so nothing can be created on it').toBeVisible(
    { timeout: WRITE_TIMEOUT },
  );
  await newCourseButton(page).click();

  const dialog = page.getByRole('dialog');
  // By placeholder, because the field has no accessible name to match on: the
  // dialog's `<Label>Title</Label>` and its `<Input>` are siblings with no `htmlFor`
  // and no `id` (CoursesManager.tsx:324-325), so they are not associated —
  // `getByLabel('Title')` resolves to 0 elements here (measured). The placeholder is
  // `coursesManager.titlePlaceholder`, and it is what gives the field the accessible
  // name "Course title" that the ARIA snapshot shows.
  await dialog.getByPlaceholder(TITLE_PLACEHOLDER, { exact: true }).fill(opts.title);
  await dialog.getByRole('button', { name: CREATE_CONFIRM, exact: true }).click();

  // One wait for both outcomes the dialog has, because the failing one cannot be
  // detected by waiting for the row. `handleCreate`'s success path is the only thing
  // that closes the dialog (CoursesManager.tsx:120); on failure it stays open with a
  // destructive toast, and an open Radix dialog takes the rest of the page out of the
  // accessibility tree — with it open, the page-wide count of row buttons is 0
  // (measured). So the row could never appear, and a plain wait for it would spend
  // the whole budget on a write that already failed and said why.
  //
  // The toast is matched by text, not role: it is rendered by sonner outside the
  // dialog, and `getByText` reads the DOM rather than the accessibility tree, so
  // `aria-hidden` cannot hide it the way it hides the row.
  const row = courseRowTitle(page, opts.title);
  const failure = page.getByText(CREATE_FAILURE, { exact: true });
  await expect(
    row.or(failure).first(),
    `neither a row for ${opts.title} nor a failure toast appeared, so course-create neither ` +
      'succeeded nor said why — check the run report for a failed request.',
  ).toBeVisible({ timeout: WRITE_TIMEOUT });

  // Which one arrived is the diagnosis. isVisible() is a decision, not a wait — one
  // of the two is already known visible.
  if (await failure.first().isVisible()) {
    throw new Error(`course-create failed for ${opts.title}: the app showed "${CREATE_FAILURE}".`);
  }
}

/**
 * Delete a course from the course-manager list page.
 *
 * Confirms only that the row left the page, which is a claim about this page's own
 * state: the mutation's success path drops the course from the TanStack cache with
 * `setQueryData` and issues no refetch (CoursesManager.tsx:175-180). Proving the row
 * is gone from the *database* takes a fresh boot, which is the caller's job — it owns
 * navigation, and `gotoFenced` is how it re-reads the list.
 */
export async function deleteCourse(page: Page, title: string): Promise<void> {
  await courseRow(page, title).getByRole('button', { name: DELETE_AFFORDANCE, exact: true }).click();

  const confirmDialog = page.getByRole('alertdialog');
  await expect(confirmDialog, `the delete confirmation for ${title} did not open`).toBeVisible();
  // Scoped to the dialog: the trigger just clicked carries this same accessible name
  // (see DELETE_AFFORDANCE). Radix does take the trigger out of the accessibility
  // tree while the modal is open — the page-wide count with it open was measured at 1
  // — so the scope is what makes this click independent of that behaviour rather than
  // dependent on it.
  await confirmDialog.getByRole('button', { name: DELETE_AFFORDANCE, exact: true }).click();

  // Load-bearing ordering, not politeness. While this dialog is open the row is
  // aria-hidden and so invisible to a role locator, which would satisfy the absence
  // check below for the wrong reason and call a failed delete a success. Waiting for
  // the dialog to go first means the page is back in the accessibility tree before
  // absence is allowed to mean anything.
  await expect(confirmDialog, `the delete confirmation for ${title} stayed open`).toBeHidden({ timeout: WRITE_TIMEOUT });

  await expect(
    courseRowTitle(page, title),
    `${title} is still listed after its deletion was confirmed — check the run report for a ` +
      `"${DELETE_FAILURE}" toast, and delete the course by hand if the request really failed.`,
  ).toHaveCount(0, { timeout: WRITE_TIMEOUT });
}
