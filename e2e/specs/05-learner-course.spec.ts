import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../fixtures/session';
import { SIGN_IN_WORST_CASE_TIMEOUT, sidebarNav, signInThroughSso } from '../fixtures/auth';
import { orgSelector } from '../fixtures/fenced-org';

/**
 * The learner journey: open a course, complete a lesson if it is still outstanding, and
 * prove the progress reached the database rather than a component's `useState`.
 *
 * It is a one-time write plus an ongoing persistence read, not a write exercised on every
 * run: `/api/lesson-progress` upserts and the app offers no un-complete, so only the first
 * run against a fresh account performs the write, and every later run re-reads the persisted
 * row across a reload without writing again (see "Re-running is safe but not symmetric"
 * below). The suite's design doc labels this row the same way — a write once, then a read.
 *
 * It writes to the production database, and unlike 04-course-lifecycle it is not fenced.
 * The only write that changes a row is `/api/lesson-progress`, which upserts a single row
 * keyed `(org_id, user_id, lesson_id)` for the signed-in account, with `profile.id` taken
 * from the token and never from the client (functions/lesson-progress/index.ts). Opening
 * the course also calls `/api/course-player-data`, which upserts this account's enrollment
 * (implicit enrollment, #357) — but for the seeded, already-enrolled account that is
 * `ON CONFLICT DO NOTHING`, so it adds no row. So the
 * artefact is this account's own progress, not an organization-scoped object a run can
 * own and drop: there is no fenced organization here, no `fencedOrg` fixture and no
 * teardown. `page.goto` is therefore fine, where in 04 it would silently unfence the run.
 *
 * The row is org-scoped all the same, and the journey does not choose the organization:
 * in learner view `OrgSelector` renders and auto-selects `orgs[0]` once per mount when
 * nothing is selected (OrgSelector.tsx:24-32), and `/api/organizations` orders
 * `created_at DESC` for a platform admin (functions/organizations/index.ts:33) — so it is
 * whichever organization was created most recently. Which one that is does not matter to
 * this journey as long as that organization has access to the course, and the catalogue
 * assertion below says so when it does not. The realistic way it stops being true is
 * debris: a fenced organization stranded by a failed 02/04 teardown would be `orgs[0]` and
 * its catalogue is empty — a course is visible to an organization only through an
 * `org_course_access` row with `access = 'enabled'`
 * (functions/shared/course-visibility.ts), and creating an organization writes none.
 *
 * `AI Fundamentals` and its `Welcome Video` lesson are pre-existing seeded platform data
 * (migration/azure/02-seed.sql:52,62), not artefacts of this suite. There is no enroll
 * step: every catalogue card is a link into the player and opening a course auto-creates
 * the enrollment server-side (implicit enrollment, #357), so the play link exists for
 * every course and this journey needs no prior enrollment.
 *
 * Re-running is safe but not symmetric, and the body says where. The endpoint upserts, so
 * the *state* after every run is identical; the *journey* is not repeatable, because a
 * completed lesson's footer replaces the button with a badge (CoursePlayer.tsx:809-832)
 * and the app offers no way to un-complete a lesson. So the first run performs the write
 * and later runs find it already done — see the branch below. Resetting the progress to
 * make every run write would mean deleting a real person's progress, which this suite
 * does not do.
 */

test.use({ viewMode: 'learner' });

/**
 * The learner catalogue (`routes.learner.courses`).
 *
 * Not called `COURSES_PATH`: that name is taken, by a different page —
 * e2e/fixtures/course.ts exports it for the *platform* course-manager route
 * (/app/admin/platform/courses). One name for two routes is how a reader ends up
 * expecting the wrong one.
 */
const CATALOGUE_PATH = '/app/courses';

/** `routes.learner.coursePlayerPattern` — `/app/learn/:courseId`, a uuid. */
const PLAYER_URL = /\/app\/learn\/[0-9a-f-]{36}$/;

/** The course this journey drives, by name — never "the first card in the list". */
const COURSE = 'AI Fundamentals';

/**
 * The lesson this journey completes.
 *
 * The course's first lesson, which matters twice over: the player opens on
 * `modules[0].lessons[0]` (CoursePlayer.tsx:148-150), so a reload lands back on this
 * lesson without any navigation, and the same lesson is driven on every run — so runs do
 * not eat through the course one lesson at a time.
 */
const LESSON = 'Welcome Video';

/** `coursePlayer.markAsComplete` and `coursePlayer.completed` — one footer slot, two states. */
const MARK_COMPLETE = 'Mark as complete';
const COMPLETED = 'Completed';

/**
 * The `OrgSelector` trigger text this journey requires: a real organization's name.
 *
 * A regex rather than a fixed string, because the journey does not choose the org — in
 * learner view `OrgSelector` auto-selects `orgs[0]`, the most recently created org
 * (OrgSelector.tsx:24-32; functions/organizations/index.ts:33) — so which name it lands on
 * is not fixed and cannot be asserted literally. What it *can* assert is that the trigger is
 * neither of the two states that mean "wrong org", and this pattern matches only once it is
 * neither:
 *
 *  - the `Platform-wide (no org)` placeholder (OrgSelector.tsx:86), shown until auto-select
 *    commits and forever when the org list is empty. Excluded so a single retrying matcher
 *    waits *past* that transient rather than passing on it — a bare `not.toContainText('e2e-')`
 *    would pass on the placeholder before the org name lands, and miss the debris below.
 *  - an `e2e-`-prefixed name (`e2eName`, e2e/run-id.ts), which is run debris: a fenced org
 *    stranded by a failed 02/04 teardown is the newest org, so it becomes `orgs[0]`, and its
 *    catalogue is empty — the one wrong org that turns this journey red against healthy code
 *    with a message nobody would connect to a stray organization (#329).
 *
 * `toHaveText` also fails on a missing element, so this one assertion is its own anchor too:
 * it covers the loading spinner (no combobox yet, OrgSelector.tsx:50), the placeholder
 * transient and the debris case, and passes only once the trigger has settled on a real
 * organization's name.
 */
const SELECTED_ORG = /^(?!Platform-wide \(no org\)$)(?!.*e2e-).+$/;

/**
 * Budget for one lesson-progress write to land, or for the first read after a boot.
 *
 * Wider than the config's 15s `expect` default, which was sized for assertions on
 * already-rendered state: a cold Azure Functions start alone can eat it. Sibling of
 * `COURSE_WRITE_TIMEOUT` in e2e/fixtures/course.ts and deliberately not imported from
 * it — that figure is about the course-admin endpoints, this one about
 * `/api/lesson-progress` and `/api/course-player-data`.
 */
const LESSON_WRITE_TIMEOUT = 30_000;

/**
 * What one run of this journey may spend, replacing the config's per-test cap.
 *
 * That cap is `SIGN_IN_WORST_CASE_TIMEOUT + 25_000` — 90s, sized for a spec whose only long
 * wait is sign-in itself (playwright.config.ts). The caps on this journey's path sum to 545s:
 * sign-in's own worst case (65s) plus the `page.goto('/login')` inside it, which that figure
 * deliberately excludes (30s); seven `LESSON_WRITE_TIMEOUT` waits (210s) — the six on the
 * lesson path plus the org-selection assertion below; two more navigations at Playwright's 30s
 * default, the catalogue `goto` and the reload (60s); and twelve assertions and clicks left on
 * the config's 15s `expect`/`actionTimeout` defaults (180s).
 *
 * So at 90s a cold start trips the per-test cap while one of those waits is still running, and
 * the run prints Playwright's generic "Test timeout exceeded" instead of the message that wait
 * carries — which is the whole reason each of them carries one.
 *
 * Seventeen write budgets (510s) plus sign-in's own worst case comes to 575s, above that sum —
 * sized the way the fence fixtures size their phase budgets (e2e/fixtures/fenced-org.ts), so
 * that this cap is never the thing that fires and a failure is always diagnosed by the
 * assertion it happened in. It is a ceiling on a pathological run where every wait spends its
 * whole budget, not an expectation: measured warm, the journey finishes in seconds.
 */
const SPEC_TIMEOUT = SIGN_IN_WORST_CASE_TIMEOUT + 17 * LESSON_WRITE_TIMEOUT;

test.describe.configure({ timeout: SPEC_TIMEOUT });

/**
 * The body of one course's card on the learner catalogue.
 *
 * The card is a plain `div` with no test id and no accessible name, so it cannot be
 * addressed directly: its title is an `<h3>` and its play link sits in a sibling row
 * further down (Courses.tsx:232,256). What is addressable is the innermost `div` holding
 * both — matched here as "contains this course's h3 *and* contains a link". Every
 * ancestor of the h3 that also holds a link matches too (the grid holds every card), and
 * ancestors precede descendants in document order, so `.last()` is the innermost one.
 *
 * `.last()` also keeps this single-valued if the same course is rendered twice: a
 * level-matched course is repeated in the "For you" grid above the full catalogue
 * (Courses.tsx:353), which happens once the account has an `assessment_level`. Both
 * copies are the same course and link to the same player, so picking either is correct.
 * Measured today: 1 — this account has no assessment level, so no recommended grid.
 */
function courseCardBody(page: Page, title: string): Locator {
  return page
    .locator('div')
    .filter({ has: page.getByRole('heading', { level: 3, name: title, exact: true }) })
    .filter({ has: page.getByRole('link') })
    .last();
}

/**
 * The open lesson's pane heading.
 *
 * `heading`, not text: the page renders the course title in its breadcrumb
 * (AppLayout, via CoursePlayer.tsx:440-443), which is page chrome — measured, the
 * header's own text on this page reads "Toggle Sidebar / Home / Course Overview / AI
 * Fundamentals / Viewing as: Learner" — so a `getByText` on the course title matches
 * whether or not the player ever loaded the course. The two headings this
 * page does render at level 2 are the course card's title (CoursePlayer.tsx:448) and the
 * open lesson's (CoursePlayer.tsx:534) — one element each, so a name picks between them.
 */
function heading2(page: Page, name: string): Locator {
  return page.getByRole('heading', { level: 2, name, exact: true });
}

/**
 * The course's completed-lesson counter in the player's sidebar card
 * (CoursePlayer.tsx:451-453) — e.g. `1/4 · 25%`.
 *
 * Matched on its shape because the span carries no label and no test id. The enclosing
 * row prefixes the `Progress` label, so its text does not match this anchored pattern and
 * only the value span does (measured: 1 element). Counted per course, not platform-wide:
 * the numbers come from this course's lessons only (CoursePlayer.tsx:402-405).
 */
function progressCounter(page: Page): Locator {
  return page.getByText(/^\d+\/\d+\s*·\s*\d+%$/);
}

/**
 * Assert the open lesson pane says the lesson is complete.
 *
 * Both halves are needed and neither is redundant. The badge is the positive claim, and
 * it anchors the negative: `toBeHidden` is also satisfied by an element that does not
 * exist, so the absent button alone would pass on a page that never rendered. The button
 * is the other half of the same footer slot (CoursePlayer.tsx:809-832), so its absence is
 * what rules out "the footer rendered, still offering to complete the lesson".
 *
 * Page-scoped rather than scoped to the pane: the player renders one lesson pane, the
 * badge's own text is exactly `Completed` and nothing else on the page carries it
 * (measured: 0 before completing, and the sidebar's per-lesson tick is an `aria-hidden`
 * icon with no text). The caller pins which lesson the pane is showing.
 */
async function expectLessonComplete(page: Page, message: string): Promise<void> {
  await expect(page.getByText(COMPLETED, { exact: true }), message).toBeVisible({
    timeout: LESSON_WRITE_TIMEOUT,
  });
  await expect(page.getByRole('button', { name: MARK_COMPLETE, exact: true }), message).toBeHidden();
}

test('a completed lesson stays completed after a reload', async ({ page, viewMode }) => {
  // The view comes from the fixture rather than being repeated as a literal, so
  // `test.use({ viewMode })` above and the landmark this waits for cannot drift apart —
  // seeding one view and waiting for another's sidebar link fails after the full sign-in
  // budget with a message accusing a healthy capture (e2e/fixtures/auth.ts).
  await signInThroughSso(page, viewMode);

  await page.goto(CATALOGUE_PATH);

  // Learner view specifically, not merely "signed in". `signInThroughSso` waited on the
  // `Dashboard` link, which org-admin view renders too (see SIDEBAR_LANDMARK in
  // e2e/fixtures/auth.ts), so this narrows it — and the positive comes first because
  // `toBeHidden()` is also satisfied by an element that does not exist, so either negative
  // below would pass on a page that never rendered.
  //
  // The chip is that anchor and the positive claim at once: it renders only for a platform
  // admin outside platform view (AppLayout.tsx:54,91-96), so its presence establishes that
  // AppLayout is up, and its text names the view — `viewModeLabels[viewMode]`, so "Learner"
  // is `viewMode` itself rather than an inference from it.
  //
  // The negatives then say the same of the sidebar, which is a separate component reading
  // the same state: no `Organizations` rules out the platform group — the view an unseeded
  // `viewMode` falls back to (useAuth.tsx:53-57) — and no `Organization` rules out the
  // org-admin analytics link, whose group a learner does not get (AppSidebar.tsx:193-203).
  // `exact: true` is load-bearing on both: `Organization` is a substring of `Organizations`.
  await expect(page.locator('header').getByText('Viewing as: Learner')).toBeVisible();
  const nav = sidebarNav(page);
  await expect(nav.getByRole('link', { name: 'Organizations', exact: true })).toBeHidden();
  await expect(nav.getByRole('link', { name: 'Organization', exact: true })).toBeHidden();

  // Which organization this journey is operating in. It does not choose it — `OrgSelector`
  // auto-selects `orgs[0]` (see the file header and SELECTED_ORG) — so it asserts that
  // auto-selection landed on a real org rather than run debris. Without this, leftover `e2e-`
  // debris silently reroutes the journey to an empty catalogue and the play-link assertion
  // below goes red against healthy code with a cause nobody would guess (#329). Reusing the
  // exported `orgSelector` keeps that locator defined once, in the fence's own module.
  await expect(
    orgSelector(page),
    'the sidebar OrgSelector never settled on a real organization this journey can drive. In ' +
      'learner view it auto-selects orgs[0] — the most recently created org ' +
      '(functions/organizations/index.ts:33) — so the usual cause is run debris: a fenced org ' +
      'stranded by a failed 02/04 teardown is the newest org, becomes orgs[0], carries the ' +
      'e2e- prefix and has an empty catalogue. Delete the stranded e2e- org and re-run. (It ' +
      'also fails if no org is ever selected, or the org list never loaded.)',
  ).toHaveText(SELECTED_ORG, { timeout: LESSON_WRITE_TIMEOUT });

  // By name: a positional "first card" locator would drive whatever the catalogue
  // happened to contain and still pass. The link inside the card is the play link —
  // `Start course`, `Continue`, or `Review course` depending on how far this account has
  // got — and matching the role alone survives every label. Every card renders exactly one
  // (opening a course starts it; enrollment is implicit, #357), so this asserts the course
  // is present in the selected org, not that the account was enrolled beforehand.
  const openCourse = courseCardBody(page, COURSE).getByRole('link');
  await expect(
    openCourse,
    `no play link for a "${COURSE}" card on the learner catalogue: the course is absent from ` +
      'the organization the sidebar selector auto-selected (the most recently created one — ' +
      'check for a stranded e2e organization). This journey drives pre-existing seeded data.',
  ).toHaveCount(1, { timeout: LESSON_WRITE_TIMEOUT });
  await openCourse.click();

  await expect(page).toHaveURL(PLAYER_URL);
  // The player loaded *this* course from the server: the heading is `course.title` out of
  // the `/api/course-player-data` response (CoursePlayer.tsx:143,448).
  await expect(heading2(page, COURSE)).toBeVisible({ timeout: LESSON_WRITE_TIMEOUT });
  await expect(heading2(page, LESSON)).toBeVisible();

  // Either state is a valid starting point — the write only happens on the run that finds
  // the lesson outstanding (see the file header). Settled with one wait so a slow first
  // paint cannot be read as "already complete".
  const markComplete = page.getByRole('button', { name: MARK_COMPLETE, exact: true });
  await expect(
    markComplete.or(page.getByText(COMPLETED, { exact: true })).first(),
    `the "${LESSON}" pane rendered neither the "${MARK_COMPLETE}" button nor a "${COMPLETED}" ` +
      'badge, so its footer settled into neither state and the branch below would read the ' +
      'absent button as "already complete" (CoursePlayer.tsx:809-832).',
  ).toBeVisible();

  if (await markComplete.isVisible()) {
    await markComplete.click();

    // The player advances to the next lesson, and only after `/api/lesson-progress` has
    // resolved: a rejected write returns early with a toast and leaves this lesson open
    // (CoursePlayer.tsx:302-311), so the pane moving is how "the endpoint accepted it"
    // becomes visible without asserting on network traffic. It also fails, rather than
    // hanging, in the one case where the app does not advance — this lesson completing the
    // whole course, which opens the celebration dialog instead (CoursePlayer.tsx:334-351).
    // That needs the course's other three lessons already done, which no run of this spec
    // does.
    await expect(
      heading2(page, LESSON),
      'completing the lesson never advanced the player, so the progress write did not succeed',
    ).toBeHidden({ timeout: LESSON_WRITE_TIMEOUT });

    // Back to the lesson to read its own state. `exact` is impossible here and its absence
    // is not laziness: the sidebar button's accessible name concatenates the title and the
    // duration ("Welcome Video 5 min" — CoursePlayer.tsx:513-518). The substring is
    // unambiguous anyway (measured: 1 button).
    await page.getByRole('button', { name: LESSON }).click();
    await expectLessonComplete(page, `the player did not consider "${LESSON}" complete after saving`);
  }

  // The reload is the whole point of the test, and it is what the assertion above cannot
  // do: it starts a new JS context, and the player holds `progress` in `useState` seeded
  // from `/api/course-player-data` on mount (CoursePlayer.tsx:92,145) with nothing
  // persisted client-side. So a badge here can only have come from the `lesson_progress`
  // row. Verified by construction: with `/api/lesson-progress` stubbed to a fake 200 the
  // pre-reload assertions still pass and this one fails.
  await page.reload();
  await expect(heading2(page, LESSON)).toBeVisible({ timeout: LESSON_WRITE_TIMEOUT });
  await expectLessonComplete(
    page,
    `"${LESSON}" is not complete after a reload — the progress was never persisted server-side`,
  );
  // The counter agrees that at least one of this course's lessons is done. NOT independent
  // evidence of the badge: both read the same `progress` map — the badge as a single-key
  // lookup (CoursePlayer.tsx:809), the counter as a filter over the course's lessons
  // (:404) — and the map is seeded once from the reload's `/api/course-player-data`
  // response (:145). What it adds is the aggregate that lookup cannot make: the persisted
  // row is counted among *this course's* lessons, where the map itself spans every course in
  // the organization (#18). Stated positively on purpose: a negated `not.toHaveText` is also
  // satisfied by an element that never resolved, which is the same trap the `toBeHidden`
  // above needs anchoring against.
  await expect(progressCounter(page)).toHaveText(/^[1-9]\d*\//);
});
