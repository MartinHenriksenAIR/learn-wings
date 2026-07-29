import type { Locator, Page } from '@playwright/test';
import { assertFenced, gotoFenced } from '../fixtures/fenced-org';
import {
  COURSES_PATH,
  COURSE_WRITE_TIMEOUT,
  courseRowTitle,
  createCourse,
  deleteCourse,
  expect,
  test,
} from '../fixtures/course';
import { e2eName } from '../run-id';

/**
 * The first journey in this suite that writes to the production database.
 *
 * Neither write is cleaned up by this body, and that is deliberate. The organization is
 * bounded by the `fencedOrg` fixture and the course by `courseCleanup`, both of which
 * delete in Playwright's teardown rather than in a body `finally` — a test timeout
 * rejects every await left in the body, so a `finally` cannot click its way through a
 * cleanup and the row survives the run (#319). The `deleteCourse` call below is the
 * journey's own assertion that deleting works, not the safety net; the fixture is the
 * safety net, and it is idempotent so that the two do not collide.
 *
 * The two writes are bounded in different ways, though. The organization is contained:
 * it is a disposable object this run owns, and everything scoped to it goes with it. The
 * course is not and cannot be — `course-create` takes no org id
 * (functions/course-create/index.ts) and `courses-admin` returns the whole platform
 * list, so a course belongs to no organization and a stranded one is visible to every
 * organization on the platform. What makes it attributable is the run id in its title
 * (e2e/run-id.ts); what makes it short-lived is the fixture.
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

/**
 * What one run of this journey may spend, replacing the config's per-test cap.
 *
 * That cap is `SIGN_IN_WORST_CASE_TIMEOUT + 25_000` — 90s, sized for a spec whose only long
 * wait is sign-in itself (playwright.config.ts). This body's own bounded waits sum to 795s:
 * three `gotoFenced` calls at 105s each (315s — a `page.goto` at Playwright's 30s navigation
 * default, then `selectFencedOrg`'s 30s OrgSelector-visible wait and its three 15s
 * actions/asserts, e2e/fixtures/fenced-org.ts); `createCourse` at 135s (a 30s list-loaded
 * wait, three 15s actions and two 30s write waits, e2e/fixtures/course.ts); `deleteCourse`
 * at 135s (two 15s clicks, a 15s dialog-open assert and three 30s waits); and 210s of the
 * body's own inline waits — the row click, the editor-URL assert and `assertFenced` at 15s
 * each, the title-field `toHaveValue` at 30s, the title fill and Save click at 15s each, the
 * "Saved" morph at 30s, the post-edit count-1 at 30s and count-0 at 15s, and the post-delete
 * count-0 at 30s. Sign-in and the fence's create/delete are not in that sum: they run in the
 * `fencedOrg`/`fenceDelete` fixtures, which carry their own timeouts.
 *
 * At 90s a cold start therefore trips the cap while one of those waits is still running, and
 * the run prints Playwright's generic "Test timeout exceeded" instead of the message that
 * wait carries — and here that would also strand the course and the fence's diagnosis behind
 * a generic message. Twenty-seven course-write budgets (810s) sits above the 795s the path
 * can spend, so this cap is never the thing that fires — a ceiling on a pathological run
 * where every wait spends its whole budget, not an expectation.
 */
const SPEC_TIMEOUT = 27 * COURSE_WRITE_TIMEOUT;

test.describe.configure({ timeout: SPEC_TIMEOUT });

/** `/app/admin/platform/courses/:courseId` — a uuid (routes.ts:64). */
const COURSE_EDITOR_URL = /\/app\/admin\/platform\/courses\/[0-9a-f-]{36}$/;

/** `courseEditor.saveChanges` and `courseEditor.saved` — one button, two labels. */
const SAVE_CHANGES = 'Save changes';
const SAVED = 'Saved';

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

test('a course can be created, edited, found and deleted', async ({ page, fencedOrg, courseCleanup }) => {
  const title = e2eName('course');
  const editedTitle = `${title}-edited`;

  // Registered before the first write, and both names at once, because the rename below
  // means either can be the one left behind. This is what gives the course a teardown
  // owner: the fixture deletes whatever of these is still listed, whether this body
  // passed, failed or was cut off by the per-test cap.
  courseCleanup.titles.push(title, editedTitle);

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
  await expect(courseTitleField(page)).toHaveValue(title, { timeout: COURSE_WRITE_TIMEOUT });

  await courseTitleField(page).fill(editedTitle);
  await saveButton(page, SAVE_CHANGES).click();
  // The app's own success signal for a routine save: the in-button morph, fired from
  // the mutation's onSuccess (CourseEditor.tsx:198-200). There is no toast by design.
  // Waited for before navigating away, and that is load-bearing rather than tidy — a
  // navigation issued while the request is in flight aborts it, which is how an
  // earlier sweep of the organizations flow re-clicked the same undeleted row five
  // times (see deleteFencedOrg). The morph reverts after 1600ms (useFlash.ts:9), so
  // this is a window rather than a resting state; the wide timeout is for reaching it
  // through a cold start, not for the window itself.
  await expect(saveButton(page, SAVED), 'the course save never reported success').toBeVisible({
    timeout: COURSE_WRITE_TIMEOUT,
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
  //
  // Counted rather than merely found, because "exactly one" is the stronger claim and
  // the one that stays honest: a second row under this name — which a stranded course
  // from an earlier attempt would produce — is reported here as a count, instead of
  // becoming a strict-mode violation inside `deleteCourse` that names an ambiguity
  // rather than a duplicate.
  await gotoFenced(page, fencedOrg, COURSES_PATH);
  await expect(courseRowTitle(page, editedTitle)).toHaveCount(1, { timeout: COURSE_WRITE_TIMEOUT });
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
  ).toHaveCount(0, { timeout: COURSE_WRITE_TIMEOUT });
});
