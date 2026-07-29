import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../fixtures/session';
import { signInThroughSso } from '../fixtures/auth';

/**
 * The quiz journey: open the quiz lesson inside a real course and prove it is not a dead
 * end — the durable half of #299.
 *
 * **Read-only, so unfenced.** Nothing here submits the quiz: `handleSubmitQuiz` posts to
 * `/api/grade-quiz` (CoursePlayer.tsx:372), which inserts the `quiz_attempts` row
 * server-side (functions/grade-quiz/index.ts:57), and the
 * journey stops short of it. Opening a lesson writes nothing at all — `/api/quiz-by-lesson`
 * is a read (functions/quiz-by-lesson) and no lesson-progress call is made — so there is no
 * artefact to own, no `fencedOrg` fixture and no teardown, and `page.goto` is correct here
 * where in a fenced spec it would silently unfence the run.
 *
 * `AI Fundamentals`, its `Assessment` module and the `Knowledge Check` quiz lesson are
 * pre-existing platform data, seeded (migration/azure/02-seed.sql:52,58,68) rather than
 * created by this suite. The organization is not chosen by the journey either: in learner
 * view `OrgSelector` auto-selects `orgs[0]` when nothing is selected (OrgSelector.tsx:24-32)
 * and `/api/organizations` orders `created_at DESC` (functions/organizations/index.ts:33),
 * so it is whichever organization was created most recently — see the sibling note in
 * 05-learner-course.spec.ts, which drives the same catalogue and the same failure mode
 * (a stranded `e2e-` organization becomes `orgs[0]` and its catalogue is empty).
 *
 * **What #299 guarantees, and therefore what this asserts.** A quiz lesson has three
 * settled states, and two of them are acceptable:
 *   - a healthy quiz — `quiz && questions.length > 0` — which renders the questions and a
 *     submit button and deliberately gets NO nav footer, because it carries its own
 *     submit → next-lesson flow (CoursePlayer.tsx:632,840);
 *   - no quiz row or zero questions — the neutral "not ready yet" card, which DOES get a
 *     nav-only footer so the learner can still leave (CoursePlayer.tsx:624,840);
 *   - a failed load — the #294 error card, also with the nav footer.
 * The third is an endpoint fault rather than a content state, so it is named in the settle
 * wait (for a fast, precise diagnosis) and then thrown on instead of accepted.
 *
 * Measured against the deployed app on 2026-07-29: `/api/quiz-by-lesson` returns the quiz
 * with 3 questions, so a run takes the healthy branch. The not-ready branch was exercised
 * by hand with that endpoint stubbed to `{ quiz: null, questions: [] }` — it renders the
 * card and a footer whose Previous is enabled and whose Next is disabled — which is what
 * the assertions below encode. Both branches are kept because #299's whole point is that
 * either state is acceptable: pinning the test to the healthy one would turn a
 * deliberately-tolerated content state into a red suite.
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

/** The quiz lesson inside it — the only `quiz`-type lesson the course has. */
const QUIZ_LESSON = 'Knowledge Check';

/** The read this journey gates on, so the settle below is not guesswork. */
const QUIZ_ENDPOINT = '/api/quiz-by-lesson';

/** `coursePlayer.quizNotReady` — the #299 empty state, with a straight apostrophe. */
const QUIZ_NOT_READY = "This quiz isn't ready yet";

/** `coursePlayer.submitAnswers` — present only for a quiz with questions. */
const SUBMIT_ANSWERS = 'Submit answers';

/** `coursePlayer.quizLoadFailed` — the #294 error card's title. */
const QUIZ_LOAD_FAILED = 'Unable to load the quiz';

/** `common.previous` / `common.next` — `LessonNav`'s two buttons (CoursePlayer.tsx:58-78). */
const PREVIOUS = 'Previous';
const NEXT = 'Next';

/**
 * Budget for a first read after a boot: `/api/course-player-data`, then
 * `/api/quiz-by-lesson`. Wider than the config's 15s `expect` default, which was sized for
 * assertions on already-rendered state — a cold Azure Functions start alone can eat it.
 */
const QUIZ_READ_TIMEOUT = 30_000;

/**
 * The body of one course's card on the learner catalogue.
 *
 * Deliberately a local copy of 05-learner-course.spec.ts's helper rather than a shared
 * import: a spec importing another spec's internals couples two journeys that are meant to
 * fail independently, and this is a locator rather than logic. Its reasoning holds
 * unchanged — the card is a plain `div` with no test id and no accessible name, so what is
 * addressable is the innermost `div` holding both the title `<h3>` and the play link
 * (Courses.tsx:232,256); ancestors precede descendants in document order, so `.last()` is
 * the innermost match. Measured here: 1.
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
 * A deliberate local copy of the identical helper in 05-learner-course.spec.ts, for the same
 * reason `courseCardBody` above is one: a spec importing another spec's internals couples two
 * journeys that are meant to fail independently, and this is a locator rather than logic.
 *
 * `heading`, not text: the page renders the course title in its breadcrumb (AppLayout, via
 * CoursePlayer.tsx:440-443), so a `getByText` on it matches whether or not the player ever
 * loaded the course. The two level-2 headings this page renders are the course card's title
 * (CoursePlayer.tsx:448) and the open lesson's (CoursePlayer.tsx:534) — one element each, so
 * a name picks between them. Measured: 1 for `Knowledge Check` once that lesson is open.
 */
function heading2(page: Page, name: string): Locator {
  return page.getByRole('heading', { level: 2, name, exact: true });
}

/**
 * The lesson-list button that opens the quiz lesson.
 *
 * `exact: true` is impossible here and its absence is not laziness: the button's accessible
 * name concatenates the title with the duration badge, measured as `Knowledge Check 5 min`
 * (CoursePlayer.tsx:484-520). An anchored regex says what `exact` would have: the name must
 * *start* with the lesson title, so neither a longer title ending in it nor a button merely
 * mentioning it can match. The duration is left out of the pattern so a content edit that
 * drops `duration_minutes` — which makes that span disappear entirely
 * (CoursePlayer.tsx:515) — does not turn into a locator failure. Measured: 1.
 */
function quizLessonButton(page: Page): Locator {
  return page.getByRole('button', { name: new RegExp(`^${QUIZ_LESSON}\\b`) });
}

/** A button addressed by its exact label — `exact: true` throughout, per this tree's rule. */
function exactButton(page: Page, name: string): Locator {
  return page.getByRole('button', { name, exact: true });
}

test('a quiz lesson is never a dead end', async ({ page }) => {
  await signInThroughSso(page, 'learner');

  await page.goto(CATALOGUE_PATH);

  // By name: a positional "first card" locator would drive whatever the catalogue happened
  // to contain and still pass. The link inside the card is the play link — `Continue`, or
  // `Review course` once the course is finished (Courses.tsx:258) — and matching the role
  // alone survives both labels. It is also the enrollment check: an unenrolled card renders
  // an `Enroll` *button* and no link at all (Courses.tsx:262-275).
  const openCourse = courseCardBody(page, COURSE).getByRole('link');
  await expect(
    openCourse,
    `no play link for a "${COURSE}" card on the learner catalogue. Either the course is absent ` +
      'from the organization the sidebar selector auto-selected (the most recently created one — ' +
      'check for a stranded e2e organization), or this account is no longer enrolled in it. This ' +
      'journey drives pre-existing data and enrolls nobody.',
  ).toHaveCount(1, { timeout: QUIZ_READ_TIMEOUT });
  await openCourse.click();

  await expect(page).toHaveURL(PLAYER_URL);
  // The player loaded *this* course from the server: the heading is `course.title` out of the
  // `/api/course-player-data` response (CoursePlayer.tsx:143,448).
  await expect(heading2(page, COURSE)).toBeVisible({ timeout: QUIZ_READ_TIMEOUT });

  // No fallback and no env var: if the course has no quiz lesson this must fail loudly
  // rather than quietly assert against the video lesson the player opens on
  // (`modules[0].lessons[0]` — CoursePlayer.tsx:148-150).
  const openQuizLesson = quizLessonButton(page);
  await expect(
    openQuizLesson,
    `"${COURSE}" has no "${QUIZ_LESSON}" lesson in its lesson list, so this journey has no quiz ` +
      'surface to drive. It is seeded content (migration/azure/02-seed.sql:68) — do not point this ' +
      'spec at another course, work out why the lesson is gone.',
  ).toHaveCount(1);

  // Gating on the response, not on a spinner, and this is the whole reason the assertions
  // below mean anything. `quizLoading` initialises `false` (CoursePlayer.tsx:105) and
  // `loadQuiz` runs from an effect (:221-223), so on the first paint after the lesson opens
  // the state is `!quizLoading && !quizLoadFailed && !quiz` — which is exactly the "not ready
  // yet" condition (:624). The empty state therefore FLASHES for one paint before the request
  // is even issued, on a perfectly healthy quiz. Observed: a settle wait placed before the
  // response passed on that flash and then measured zero of all three states a moment later.
  // `waitForResponse` resolves strictly after `setQuizLoading(true)` ran, so it closes that
  // window; from here on `quizLoading` only ever goes false again with the answer in hand.
  //
  // Given the file's 30s read budget explicitly, not left on the config's 15s `actionTimeout`
  // (which is what `waitForResponse` inherits with no `timeout` — playwright.config.ts:78): a
  // cold Azure Functions start alone can eat 15s, so this — the wait every assertion below
  // rests on — was the one most likely to time out on a cold boot, with Playwright's generic
  // message. The `expect(..., message).resolves` wrapper (the suite's promise idiom, see
  // 02-fence.spec.ts:123) awaits this same 30s and names the read on timeout, so a cold start
  // reads as a slow endpoint rather than a quiz defect. The status is not asserted — any
  // response closes the flash window; a bad one is diagnosed by the `loadFailed` branch below.
  const quizLoaded = page.waitForResponse((response) => response.url().includes(QUIZ_ENDPOINT), {
    timeout: QUIZ_READ_TIMEOUT,
  });
  await openQuizLesson.click();
  await expect(
    quizLoaded,
    `${QUIZ_ENDPOINT} did not answer within ${QUIZ_READ_TIMEOUT / 1000}s after the "${QUIZ_LESSON}" lesson ` +
      'was opened. This is the quiz read every assertion below gates on; a timeout here is a cold ' +
      'Azure Functions start or a down endpoint, not a quiz-content defect.',
  ).resolves.toBeTruthy();

  await expect(heading2(page, QUIZ_LESSON)).toBeVisible();

  // One wait for every settled state the pane has, so a broken endpoint is named within
  // seconds instead of spending the whole budget on a state it was never going to reach.
  const submit = exactButton(page, SUBMIT_ANSWERS);
  const notReady = page.getByText(QUIZ_NOT_READY, { exact: true });
  const loadFailed = page.getByText(QUIZ_LOAD_FAILED, { exact: true });
  await expect(
    submit.or(notReady).or(loadFailed).first(),
    `the "${QUIZ_LESSON}" pane settled into none of its three states after ${QUIZ_ENDPOINT} ` +
      'answered — no questions, no "not ready" card and no error card, which is the empty pane ' +
      '#294 and #299 exist to rule out.',
  ).toBeVisible({ timeout: QUIZ_READ_TIMEOUT });

  // Which one arrived is the diagnosis. isVisible() is a decision, not a wait — one of the
  // three is already known visible.
  if (await loadFailed.isVisible()) {
    // Not a tolerated content state: the two acceptable outcomes are a quiz and an unauthored
    // quiz, and this is neither. `callApi`'s rejection is what sets the flag — `loadQuiz`
    // reads the endpoint through it (CoursePlayer.tsx:189) and its catch sets
    // `quizLoadFailed` (:206-215) — so the endpoint itself answered badly.
    throw new Error(
      `${QUIZ_ENDPOINT} failed for "${QUIZ_LESSON}": the player showed "${QUIZ_LOAD_FAILED}". ` +
        'Check the run report for the failed request.',
    );
  }

  if (await submit.isVisible()) {
    // The healthy quiz. Its way forward is its own submit flow, so there is no nav footer to
    // look for (CoursePlayer.tsx:840 excludes a quiz that has questions; measured: 0 Previous
    // and 0 Next on this pane).
    //
    // Reaching here already establishes what the pane rendered, and that is why neither
    // assertion below repeats it. The button is visible, and one guard renders the button, the
    // questions and the intro line together (`quiz && questions.length > 0`, :632) — so
    // `expect(submit).toBeVisible()` could not fail inside this branch, and neither could an
    // assertion on the intro line's "Answer all N questions." (:736; measured: "Answer all 3
    // questions. You need 70% to pass."). "A submit button over an empty pane" is not a state
    // this render can produce.
    //
    // What can fail is the button's own state. It is disabled until every question is answered
    // (:785) and this journey answers none — it stops short of `handleSubmitQuiz`, which posts
    // to /api/grade-quiz and has the row inserted server-side — so an enabled button here
    // means the gate that stops an empty submission is gone.
    await expect(
      submit,
      `the "${QUIZ_LESSON}" quiz offers a submit button that is already enabled, with no question ` +
        'answered. The gate is `Object.keys(answers).length !== questions.length` ' +
        '(CoursePlayer.tsx:785) — an unanswered quiz must not be submittable.',
    ).toBeDisabled();

    // And the questions have something to answer. This is the claim the intro line cannot
    // make: the options come from a nested `question.options.map` inside each question
    // (:746-778), so a payload carrying questions with no options renders the line, the
    // question texts and the button unchanged and still leaves the learner nothing to click.
    // `toBeAttached`, not `toBeVisible`: the real input is `sr-only` and the visible control is
    // an `aria-hidden` span beside it (:756-775). Measured: 12 — 3 questions x 4 options.
    //
    // The locator is page-wide rather than scoped to the quiz pane, which makes the claim
    // conditional on something outside this file: `CoursePlayer.tsx:757` is that file's only
    // `type="radio"` (verified), so every radio the page can render is a quiz option and
    // "some radio is attached" and "the questions have options" are the same statement today.
    // If the player ever grows a radio elsewhere — a filter, a preference — they stop being
    // the same statement, and this locator has to be scoped to the pane before it means
    // anything again.
    await expect(
      page.getByRole('radio').first(),
      `the "${QUIZ_LESSON}" quiz rendered questions with no answer options, so there is nothing ` +
        `to answer and the submit button can never enable. ${QUIZ_ENDPOINT} returned questions ` +
        'without options.',
    ).toBeAttached();
    return;
  }

  // The #299 state: a quiz lesson with nothing to answer. What the fix guarantees is that it
  // still has a footer, so the learner is not stranded on it.
  await expect(
    notReady,
    `the "${QUIZ_LESSON}" pane is neither a quiz nor the "${QUIZ_NOT_READY}" card`,
  ).toBeVisible();
  // `toBeEnabled` and not `toBeVisible`, because an enabled Previous is the way out itself.
  // It also cannot be satisfied by an absent element, unlike the `toHaveCount(0)`-shaped
  // negatives elsewhere in this suite: the assertion waits for the button and then checks it.
  //
  // Previous specifically, and Next only for its presence: `Knowledge Check` is the last
  // lesson of the last module (migration/azure/02-seed.sql:58,68 — the player's own counter
  // reads `…/4` and this is the 4th entry), and `LessonNav` disables Next at
  // `currentIndex >= total - 1` (CoursePlayer.tsx:74). Measured on the stubbed empty-quiz
  // branch: Previous enabled, Next present and disabled.
  await expect(
    exactButton(page, PREVIOUS),
    `"${QUIZ_LESSON}" shows the "${QUIZ_NOT_READY}" card with no way back — a dead end, which is ` +
      'the #299 regression. If the course content was reordered so this is now its first lesson, ' +
      'Previous is legitimately disabled and this assertion is the thing to revisit.',
  ).toBeEnabled();
  await expect(exactButton(page, NEXT), `the "${QUIZ_NOT_READY}" card rendered without its nav footer`).toHaveCount(1);
});
