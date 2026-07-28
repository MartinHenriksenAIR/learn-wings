import { expect, type Locator, type Page } from '@playwright/test';
import { test as fencedOrgTest } from './fenced-org';

/**
 * Course-manager actions for write journeys, plus the fixture that removes what they
 * create.
 *
 * **Neither action helper navigates.** The caller arrives via `gotoFenced` and
 * `createCourse`/`deleteCourse` act on whatever page is open. That is not a stylistic
 * rule: `page.goto` reboots the SPA, and `currentOrg` is plain component state
 * (useAuth.tsx:49) that nothing persists, so a navigation inside a helper would drop
 * the caller's fence and leave `OrgSelector` on whatever `orgs[0]` happens to be
 * (OrgSelector.tsx:28,42). The `courseCleanup` fixture at the foot of this file does
 * navigate, and has to: it runs after the body, from wherever the body stopped, and the
 * list page is the only place a course can be deleted from. That is teardown rather
 * than a fenced write — nothing it does depends on which organization is selected.
 *
 * What the fence does and does not bound here is worth stating plainly, because the
 * course endpoints are not org-scoped: `course-create` inserts into `courses` with
 * `(title, description, level, language, thumbnail_url, created_by_user_id,
 * is_published)` and never reads an org id at all (functions/course-create/index.ts),
 * and `courses-admin` returns the whole platform list. So a course is NOT confined to
 * the fenced organization — nothing about it could be, and a leftover one is therefore
 * platform-wide: every organization's admins see it, instead of it sitting inside a
 * disposable fence that gets dropped at the end of the run. That is why deleting the
 * course is a fixture's job here just as much as it is for the organization. The RUN_ID
 * in the title (e2e/run-id.ts) is what makes a stranded course attributable;
 * `courseCleanup` is what keeps it from being stranded in the first place.
 *
 * The fence still matters to the journey: it is the organization the run owns,
 * `gotoFenced` re-asserts that the app is pointed at it, and the course-manager page
 * reads the org list for its access matrix.
 */

/** The course-manager list page (routes.ts:63) — where every helper here acts. */
export const COURSES_PATH = '/app/admin/platform/courses';

/**
 * Budget for one course write to land: an Azure Functions call plus whatever the page
 * does with the answer. Wider than the config's 15s `expect` default, which was sized
 * for assertions on already-rendered state — a cold function start alone can eat it.
 *
 * Exported, and imported by the course spec, so the journey and the helpers spend one
 * budget instead of two constants that agree by coincidence. Still deliberately not
 * imported from ./fenced-org, whose identically-valued constant is about the
 * organization endpoints: that is a separate budget which happens to agree today, and
 * this figure is about `course-create`, `course-update` and `course-delete`.
 */
export const COURSE_WRITE_TIMEOUT = 30_000;

/**
 * What the cleanup fixture may spend, in a time slot of its own.
 *
 * Having its own slot is the load-bearing part, not the number. Playwright charges a
 * fixture's setup and its teardown to the same slot, but each *fixture* gets one:
 * `isTimeExhaustedFor` reads `runnable.fixture?.slot` before falling back to the test's
 * (node_modules/playwright/lib/worker/workerProcessEntry.js:382), and that is the check
 * the teardown skip at :206 consults. So declaring a `timeout` here is what lets this
 * teardown start at `elapsed: 0` and run even though the 90s per-test cap has already
 * fired — which is the case it mainly exists for.
 *
 * Sized above the sum of the bounded waits on the path, so the slot is never the thing
 * that fires: one `page.goto` at Playwright's 30s navigation default, 30s for the list
 * to load, then up to 105s per registered title — a 15s click on the row's delete
 * trigger, the confirm dialog at the config's 15s `expect` default, a 15s confirm
 * click, and two 30s waits (the toast race and the row-count check). The course journey
 * registers two titles, so 30 + 30 + 210 = 270s is the figure to clear. A caller
 * registering many more names would have to widen this.
 */
const COURSE_CLEANUP_TIMEOUT = 10 * COURSE_WRITE_TIMEOUT;

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
 * The list page's own success toast for a delete (`coursesManager.courseDeleted`,
 * en.json:980).
 *
 * Raced against `DELETE_FAILURE` below so that a failed delete is reported as soon as
 * the app says so, instead of spending the whole budget on a dialog that is never going
 * to close. Matching the title alone is deliberate: a delete whose blob cleanup partly
 * failed renders this same title as a *destructive* toast carrying a description
 * (CoursesManager.tsx:168-172), and that is still a deleted course — the row is gone,
 * which is the only thing these helpers claim.
 */
const DELETE_SUCCESS = 'Course deleted';

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
 * Deliberately not `.first()`: this locator is the suite's way of *counting* courses
 * with a given name, and `courses.title` has no unique constraint
 * (migration/azure/01-schema.sql:177), so "how many" is a question that has to stay
 * askable. Callers that must act on one row narrow it themselves.
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
 * The first whole row for `title`, for scoping the per-row action buttons.
 *
 * The row is a plain `<div class="grid …">` with no table semantics — measured
 * `role=table` and `role=row` counts are both 0 on this page, so a `getByRole('row')`
 * locator would match nothing at all. The title button is a direct child of that div
 * (CoursesManager.tsx:450-469; measured `titleBtn.parentElement === row`), so its
 * parent is the row. Scoping is required rather than tidy: every row renders a delete
 * trigger under one shared `aria-label`, so the page-wide count is one per course
 * (measured: 11).
 *
 * `.first()` because two rows can carry the same title — nothing in the database
 * prevents it. With one row it is that row; with two it is one of them, which is what
 * lets `sweepCourses` clear duplicates a broken run left behind rather than dying on a
 * strict-mode violation while trying to tidy up. The callers' own count assertions are
 * where a duplicate gets reported.
 */
function courseRow(page: Page, title: string): Locator {
  return courseRowTitle(page, title).first().locator('..');
}

/**
 * Create a course from the course-manager list page.
 *
 * Only the title is set. Level and language keep the dialog's defaults — `basic` and
 * Danish (CoursesManager.tsx:66-67) — which `course-create` accepts, so the journey
 * does not depend on operating two Radix selects it makes no claim about.
 *
 * Safe to run twice for the same title, which a retry does. `playwright.config.ts` sets
 * `retries: 1`, RUN_ID is stable across the retry on purpose (e2e/run-id.ts) and
 * `courses.title` has no unique constraint (migration/azure/01-schema.sql:177) — so
 * submitting the dialog a second time would create a *second* course under the same
 * name, and the caller's next row click would meet a strict-mode violation reporting an
 * ambiguity instead of whatever really failed. `createFencedOrg` is idempotent for the
 * same reason; it can submit and read the duplicate-slug error back, and this one has
 * no such signal to read, so its check has to happen before the write.
 */
export async function createCourse(page: Page, opts: { title: string }): Promise<void> {
  // Explicit, rather than left to the click's own auto-wait: the list is behind a
  // spinner until /api/courses-admin and /api/organizations both answer, and a cold
  // start outlasts the config's `actionTimeout`, which is sized for clicks on
  // rendered UI. It is also what makes the count below mean anything — during the
  // spinner there are no rows at all, so an unloaded list would read as "not created
  // yet" and the create would run a second time.
  await expect(newCourseButton(page), 'the course list never finished loading, so nothing can be created on it').toBeVisible(
    { timeout: COURSE_WRITE_TIMEOUT },
  );

  const row = courseRowTitle(page, opts.title);
  const alreadyThere = await row.count();
  if (alreadyThere === 1) {
    // A previous attempt at this same title already created it. Adopting it is what
    // makes the retry a retry of the journey rather than a second write.
    return;
  }
  if (alreadyThere > 1) {
    // Reported here, where the count is still the whole story, rather than left to
    // surface as a strict-mode violation at the caller's next click on this row.
    throw new Error(
      `${alreadyThere} courses are already named ${opts.title}, so this run cannot tell which one ` +
        'is its own. Delete all but one by hand — they are live rows in the production database.',
    );
  }

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
  // detected by waiting for the row. No failure path closes this dialog: the closers
  // are the write's success (`setCreateOpen(false)`, CoursesManager.tsx:120), the
  // Cancel button (CoursesManager.tsx:354), the `X` inside `DialogContent` and Radix's
  // own Escape/outside-click dismissal, which `DialogContent` leaves at its defaults
  // (src/components/ui/dialog.tsx:36-48) — and this helper triggers none of them. So a
  // failed create leaves the dialog open with a destructive toast, and an open Radix
  // dialog takes the rest of the page out of the accessibility tree: with it open, the
  // page-wide count of row buttons is 0 (measured). The row could never appear, and a
  // plain wait for it would spend the whole budget on a write that already failed and
  // said why.
  //
  // The toast is matched by text, not role: it is rendered by sonner outside the
  // dialog, and `getByText` reads the DOM rather than the accessibility tree, so
  // `aria-hidden` cannot hide it the way it hides the row.
  const failure = page.getByText(CREATE_FAILURE, { exact: true });
  await expect(
    row.or(failure).first(),
    `neither a row for ${opts.title} nor a failure toast appeared, so course-create neither ` +
      'succeeded nor said why — check the run report for a failed request.',
  ).toBeVisible({ timeout: COURSE_WRITE_TIMEOUT });

  // Which one arrived is the diagnosis. isVisible() is a decision, not a wait — one
  // of the two is already known visible.
  if (await failure.first().isVisible()) {
    throw new Error(`course-create failed for ${opts.title}: the app showed "${CREATE_FAILURE}".`);
  }

  // Exactly one, not merely present. The `.first()` above is what lets the race work
  // under strict mode, and it is satisfied by two identically-named rows as happily as
  // by one — so this is the assertion that would catch a duplicate this helper somehow
  // created anyway, and name it as a count at its source.
  await expect(
    row,
    `${opts.title} was created but the list does not show exactly one row for it`,
  ).toHaveCount(1, { timeout: COURSE_WRITE_TIMEOUT });
}

/**
 * Click a row's delete trigger, confirm, and wait for the app to report an outcome.
 *
 * Throws on the failure toast, returns once the confirmation dialog has closed. Shared
 * by `deleteCourse` and by the cleanup sweep, which differ only in what they assert
 * about the list afterwards.
 */
async function confirmRowDelete(page: Page, title: string): Promise<void> {
  await courseRow(page, title).getByRole('button', { name: DELETE_AFFORDANCE, exact: true }).click();

  const confirmDialog = page.getByRole('alertdialog');
  await expect(confirmDialog, `the delete confirmation for ${title} did not open`).toBeVisible();
  // Scoped to the dialog: the trigger just clicked carries this same accessible name
  // (see DELETE_AFFORDANCE). Radix does take the trigger out of the accessibility
  // tree while the modal is open — the page-wide count with it open was measured at 1
  // — so the scope is what makes this click independent of that behaviour rather than
  // dependent on it.
  await confirmDialog.getByRole('button', { name: DELETE_AFFORDANCE, exact: true }).click();

  // One wait for both outcomes, so a failed delete is reported when the app says so
  // rather than after the full budget: `setDeleteOpen(false)` sits on the mutation's
  // success path only (CoursesManager.tsx:173), so on failure the dialog simply stays
  // open — waiting for it to close was previously the only wait here, and it could
  // only ever end in a timeout. Both toasts are matched by text for the same reason
  // the create's is: sonner renders outside the dialog and `getByText` reads the DOM,
  // so the `aria-hidden` an open dialog puts on the rest of the page cannot hide them.
  const deleted = page.getByText(DELETE_SUCCESS, { exact: true });
  const failure = page.getByText(DELETE_FAILURE, { exact: true });
  await expect(
    deleted.or(failure).first(),
    `deleting ${title} produced neither "${DELETE_SUCCESS}" nor "${DELETE_FAILURE}", so ` +
      'course-delete neither succeeded nor said why — check the run report for a failed request.',
  ).toBeVisible({ timeout: COURSE_WRITE_TIMEOUT });

  // Which one arrived is the diagnosis. isVisible() is a decision, not a wait — one of
  // the two is already known visible.
  //
  // The success branch is the weaker of the two, and only here: toasts live for the
  // Toaster's 5s duration (src/components/ui/sonner.tsx:50), so two deletes inside 5s
  // — which only happens when the sweep below clears duplicates — can settle this race
  // on the previous delete's toast. That costs this call its fast failure, nothing
  // more: the dialog wait and the callers' count assertions are what actually decide
  // whether the row is gone.
  if (await failure.first().isVisible()) {
    throw new Error(`course-delete failed for ${title}: the app showed "${DELETE_FAILURE}".`);
  }

  // Load-bearing ordering, not politeness. While this dialog is open the row is
  // aria-hidden and so invisible to a role locator, which would satisfy an absence
  // check for the wrong reason and call a failed delete a success. Waiting for the
  // dialog to go first means the page is back in the accessibility tree before absence
  // is allowed to mean anything.
  await expect(confirmDialog, `the delete confirmation for ${title} stayed open`).toBeHidden({
    timeout: COURSE_WRITE_TIMEOUT,
  });
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
  await confirmRowDelete(page, title);

  await expect(
    courseRowTitle(page, title),
    `${title} is still listed after a delete the app reported as successful, which means the list ` +
      'held more than one course under that name — they are live rows in the production database.',
  ).toHaveCount(0, { timeout: COURSE_WRITE_TIMEOUT });
}

/**
 * Remove every course still listed under any of `titles`.
 *
 * Navigates, unlike the action helpers above, because it runs as teardown from wherever
 * the body stopped (see this module's header).
 *
 * Tolerant of every state a body can leave behind: the course may already be gone —
 * the journey deletes it itself, and this is then only a check — may be there once, or
 * may be there more than once if an earlier attempt stranded one.
 */
async function sweepCourses(page: Page, titles: readonly string[]): Promise<void> {
  await page.goto(COURSES_PATH);
  // The counts below only mean something once the list is up: `CoursesManager` renders
  // a bare `PageSpinner` while either query is loading (CoursesManager.tsx:270-276),
  // and counting during it would read 0 and report a clean sweep on a page that had not
  // arrived yet.
  await expect(
    newCourseButton(page),
    "the course list never loaded, so this run's courses could not be swept — check them by hand",
  ).toBeVisible({ timeout: COURSE_WRITE_TIMEOUT });

  for (const title of titles) {
    // Bounded by the count that was read, not by "until empty": each pass removes one
    // row, so a delete that stops working ends the loop instead of spinning it. A
    // delete the app reports as failed throws out of `confirmRowDelete` rather than
    // being retried here.
    for (let remaining = await courseRowTitle(page, title).count(); remaining > 0; remaining -= 1) {
      await confirmRowDelete(page, title);
      await expect(
        courseRowTitle(page, title),
        `${title} did not leave the list after a delete the app reported as successful`,
      ).toHaveCount(remaining - 1, { timeout: COURSE_WRITE_TIMEOUT });
    }
  }
}

/**
 * What the cleanup fixture is holding: the titles this run may have written.
 *
 * A mutable box rather than a return value, for the same reason `fenceDelete` uses one
 * (fenced-org.ts:398): it is how the body tells the teardown what it has committed to,
 * *before* it writes. Empty means nothing was created, so nothing to sweep — the state
 * a body that never reached its first write has to leave behind, and the guard that
 * keeps a failed sign-in from being reported as a cleanup timeout.
 *
 * A list rather than one title, because a course's name is not fixed for its lifetime:
 * the journey renames the course it creates, so either name can be the one left behind.
 */
export type PendingCourses = { titles: string[] };

/**
 * `test` with a teardown that deletes the courses the body registered.
 *
 * Extends the fenced-org `test`, so one import gives a spec both the fence and this —
 * the same layering `fenced-org.ts` applies to the session `test`.
 *
 * **Teardown is Playwright's, not the body's, and that is the whole point.** A course
 * created in a test body and deleted at the end of it survives every failure in
 * between. The per-test cap makes that a routine outcome rather than a freak one:
 * `playwright.config.ts:53` sets it to `SIGN_IN_WORST_CASE_TIMEOUT + 25_000` = 90s,
 * while the bounded waits along the course journey sum to several times that — so a run
 * that is slow rather than hung gets cut off mid-body. And when the cap trips, every
 * await left in the body rejects at once, which is why a `finally` in the spec could
 * not click its way through a cleanup either (#319 is this same failure for the
 * organization). A fixture's teardown runs whether the body passed, failed or was cut
 * off.
 *
 * **Its own `timeout` is load-bearing.** Playwright reads the *fixture's* time slot
 * when deciding whether to skip a teardown, not the test's — `isTimeExhaustedFor`
 * prefers `runnable.fixture?.slot`
 * (node_modules/playwright/lib/worker/workerProcessEntry.js:382), and that is the check
 * guarding the teardown at :206 — so this slot starts at `elapsed: 0` however much the
 * body spent. `teardownScope` also runs each fixture's teardown independently and
 * collects their errors separately, so this one still runs when the `fencedOrg` fixture
 * itself failed, and anything it throws is reported as an after-hooks error beside the
 * real failure rather than in place of it.
 *
 * **A leftover course is platform-wide.** `course-create` takes no organization id, so
 * a stranded course is not contained the way a row inside a disposable fenced org would
 * be — it shows up in every organization's course list. That is what makes this a
 * fixture rather than a convention that bodies tidy up after themselves.
 *
 * A body registers its titles before its first write:
 * `courseCleanup.titles.push(title, editedTitle)`. Nothing is swept that was not
 * registered — this fixture makes no attempt to find `e2e-` courses by pattern,
 * because a pattern sweep would delete a concurrent run's course, and one process
 * having exclusive claim on its own artefacts is the same property `workers: 1` exists
 * to protect (playwright.config.ts:43).
 *
 * Playwright's second argument is called `use` in its own docs; it is named `runTest`
 * here because `react-hooks/rules-of-hooks` reads `use(...)` inside a named
 * non-component function as a misplaced React hook and fails the lint gate.
 */
export const test = fencedOrgTest.extend<{ courseCleanup: PendingCourses }>({
  courseCleanup: [
    async ({ page }, runTest) => {
      const pending: PendingCourses = { titles: [] };
      try {
        await runTest(pending);
      } finally {
        // Nothing registered means nothing was written — and navigating anyway would
        // trade a real diagnosis (an expired capture, a refused view) for a timeout
        // against a list page that never signed in.
        if (pending.titles.length > 0) {
          await sweepCourses(page, pending.titles);
        }
      }
    },
    { timeout: COURSE_CLEANUP_TIMEOUT, title: "this run's courses, removed" },
  ],
});

export { expect };
