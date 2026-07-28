import type { Locator, Page } from '@playwright/test';
import { assertFenced, expect, gotoFenced, test } from '../fixtures/fenced-org';
import { courseRowTitle, createCourse, deleteCourse } from '../fixtures/course';
import { e2eName } from '../run-id';

/**
 * The first journey in this suite that writes to the production database.
 *
 * Two things keep that acceptable, and they are different things. The organization
 * this run creates is bounded by the `fencedOrg` fixture, which deletes it in
 * Playwright's teardown rather than in a body `finally` — a test timeout rejects every
 * await left in the body, so a `finally` cannot click its way through a cleanup and
 * the row survives the run (#319). The *course* is not bounded that way and cannot be:
 * `course-create` takes no org id (functions/course-create/index.ts) and
 * `courses-admin` returns the whole platform list, so a course belongs to no
 * organization. What bounds the course is that its title carries this run's id
 * (e2e/run-id.ts) and this body deletes it — and, if the body dies before it can, the
 * name is what makes the leftover attributable.
 *
 * Every navigation here goes through `gotoFenced`, never `page.goto`. `currentOrg` is
 * plain component state (useAuth.tsx:49) that nothing persists, so a bare navigation
 * boots the app with nothing selected and `OrgSelector` auto-selects `orgs[0]`
 * instead (OrgSelector.tsx:24-32). That does not misdirect a course write, which has
 * no org to misdirect; it would silently unfence the run, so that the fence assertions
 * this suite relies on stop meaning anything from that point on.
 */

// Mandatory: the `fencedOrg` fixture refuses platform view outright, because
// `OrgSelector` renders null there (OrgSelector.tsx:46-48) and the fence could not be
// selected. The platform-admin course pages still render in org-admin view, because
// `requirePlatformAdmin` reads the raw `isPlatformAdmin` (ProtectedRoute.tsx:80).
test.use({ viewMode: 'org_admin' });

const COURSES_PATH = '/app/admin/platform/courses';

/** `/app/admin/platform/courses/:courseId` — a uuid (routes.ts:64). */
const COURSE_EDITOR_URL = /\/app\/admin\/platform\/courses\/[0-9a-f-]{36}$/;

/** `courseEditor.saveChanges` and `courseEditor.saved` — one button, two labels. */
const SAVE_CHANGES = 'Save changes';
const SAVED = 'Saved';

/**
 * Budget for a course write to land, matching the helpers' own.
 *
 * Wider than the config's 15s `expect` default because a cold Azure Functions start
 * alone can eat it, and every wait it guards here is on a round-trip rather than on
 * already-rendered state.
 */
const WRITE_TIMEOUT = 30_000;

/**
 * The course editor's title field.
 *
 * Located by intersection because the field offers nothing else to match on. Its
 * `<Label>Title</Label>` and its `<Input>` are siblings carrying neither `htmlFor` nor
 * `id` (CourseEditor.tsx:554-555), so they are not associated and `getByLabel('Title')`
 * resolves to 0 elements (measured); the field has no placeholder either. And
 * `input[type="text"]` matches 0 as well, which is the trap worth recording: shadcn's
 * `Input` forwards `type={type}` and this call site passes none, so the attribute is
 * absent from the DOM while the IDL property still reports `"text"` — a devtools
 * inspection says "text" and the CSS attribute selector still misses.
 *
 * What is left is a fact that was measured rather than assumed: the editor has two
 * textboxes (this input and the description `<textarea>`) and two inputs (this one and
 * the thumbnail's `type="file"`), so exactly one element is both. This locator is only
 * unique on this page — the list page's search box is also an input with the textbox
 * role — which is why the caller pins the page with `toHaveValue` before filling.
 */
function courseTitleField(page: Page): Locator {
  return page.locator('input').and(page.getByRole('textbox'));
}

/** `SaveButton` shows `idleLabel` until `flashed('course')`, then `doneLabel`. */
function saveButton(page: Page, label: string): Locator {
  return page.getByRole('button', { name: label, exact: true });
}

test('a course can be created, edited, found and deleted', async ({ page, fencedOrg }) => {
  const title = e2eName('course');
  const editedTitle = `${title}-edited`;

  await gotoFenced(page, fencedOrg, COURSES_PATH);
  // The row `createCourse` waits for is not an optimistic one: the create's success
  // path invalidates the admin-list key (CoursesManager.tsx:122) and the row renders
  // from that refetch, so its presence is already a server read.
  await createCourse(page, { title });

  // Into the editor by clicking the row, which is a react-router `navigate()`
  // (CoursesManager.tsx:456) — an in-app transition, not a reload — so no `gotoFenced`
  // is needed or wanted here. The fence assertion below is what establishes that:
  // `OrgSelector` remounts with the new page's `AppLayout`, and both of its
  // auto-select effects are guarded by `!currentOrg` (OrgSelector.tsx:27,41), so an
  // already-chosen org survives the remount.
  await courseRowTitle(page, title).click();
  await expect(page).toHaveURL(COURSE_EDITOR_URL);
  await assertFenced(page, fencedOrg);

  // The editor loaded *this* course, from the server: the field is seeded from the
  // `course-structure-admin` response (CourseEditor.tsx:160-168), so its value is the
  // stored title rather than anything this test typed. It also pins the locator to the
  // editor page — on the list page the same locator resolves to the empty search box.
  await expect(courseTitleField(page)).toHaveValue(title, { timeout: WRITE_TIMEOUT });

  await courseTitleField(page).fill(editedTitle);
  await saveButton(page, SAVE_CHANGES).click();
  // The app's own success signal for a routine save: the in-button morph, fired from
  // the mutation's onSuccess (CourseEditor.tsx:198-200). There is no toast by design.
  // Waited for before navigating away, and that is load-bearing rather than tidy — a
  // navigation issued while the request is in flight aborts it, which is how an
  // earlier sweep of the organizations flow re-clicked the same undeleted row five
  // times (see deleteFencedOrg). The morph reverts after 1600ms (useFlash.ts:12), so
  // this is a window rather than a resting state; the wide timeout is for reaching it
  // through a cold start, not for the window itself.
  await expect(saveButton(page, SAVED), 'the course save never reported success').toBeVisible({
    timeout: WRITE_TIMEOUT,
  });

  // Back through the fence, which is a real navigation: it boots a fresh JS context
  // with an empty TanStack cache, so the list below can only have come from
  // /api/courses-admin. This is the assertion that makes the edit a persisted one.
  //
  // Asserted on the row button, not on the title as text, because only the button form
  // is unsatisfiable anywhere else: the editor page renders the title in its
  // breadcrumb (CourseEditor.tsx:526), so `getByText(editedTitle)` matches there too
  // (measured: 1 on the editor, versus 0 for the button) and would have gone on
  // passing with this navigation removed — proving that the title was typed, not that
  // it was stored.
  await gotoFenced(page, fencedOrg, COURSES_PATH);
  await expect(courseRowTitle(page, editedTitle)).toBeVisible({ timeout: WRITE_TIMEOUT });
  // And that the edit renamed the course rather than adding a second one.
  await expect(courseRowTitle(page, title)).toHaveCount(0);

  await deleteCourse(page, editedTitle);

  // `deleteCourse` can only vouch for this page — the delete drops the row from the
  // TanStack cache with `setQueryData` and issues no refetch (CoursesManager.tsx:
  // 175-180). One more boot through the fence is what turns "the row left the page"
  // into "the row left the database", and it is also this run's own debris check.
  await gotoFenced(page, fencedOrg, COURSES_PATH);
  await expect(
    courseRowTitle(page, editedTitle),
    `${editedTitle} survived its deletion — it is a live row in the production database, delete it by hand`,
  ).toHaveCount(0, { timeout: WRITE_TIMEOUT });
});
