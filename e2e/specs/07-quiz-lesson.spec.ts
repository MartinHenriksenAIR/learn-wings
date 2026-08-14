import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../fixtures/session';
import { SIGN_IN_WORST_CASE_TIMEOUT, signInThroughSso } from '../fixtures/auth';


test.use({ viewMode: 'learner' });

const CATALOGUE_PATH = '/app/courses';

const PLAYER_URL = /\/app\/learn\/[0-9a-f-]{36}$/;

const COURSE = 'AI Fundamentals';

const QUIZ_LESSON = 'Knowledge Check';

const QUIZ_ENDPOINT = '/api/quiz-by-lesson';

const QUIZ_NOT_READY = "This quiz isn't ready yet";

const SUBMIT_ANSWERS = 'Submit answers';

const QUIZ_LOAD_FAILED = 'Unable to load the quiz';

const PREVIOUS = 'Previous';
const NEXT = 'Next';

const QUIZ_READ_TIMEOUT = 30_000;

const SPEC_TIMEOUT = SIGN_IN_WORST_CASE_TIMEOUT + 11 * QUIZ_READ_TIMEOUT;

test.describe.configure({ timeout: SPEC_TIMEOUT });

function courseCardBody(page: Page, title: string): Locator {
  return page
    .locator('div')
    .filter({ has: page.getByRole('heading', { level: 3, name: title, exact: true }) })
    .filter({ has: page.getByRole('link') })
    .last();
}

function heading2(page: Page, name: string): Locator {
  return page.getByRole('heading', { level: 2, name, exact: true });
}

function quizLessonButton(page: Page): Locator {
  return page.getByRole('button', { name: new RegExp(`^${QUIZ_LESSON}\\b`) });
}

function exactButton(page: Page, name: string): Locator {
  return page.getByRole('button', { name, exact: true });
}

test('a quiz lesson is never a dead end', async ({ page }) => {
  await signInThroughSso(page, 'learner');

  await page.goto(CATALOGUE_PATH);

  const openCourse = courseCardBody(page, COURSE).getByRole('link');
  await expect(
    openCourse,
    `no play link for a "${COURSE}" card on the learner catalogue: the course is absent from ` +
      'the organization the sidebar selector auto-selected (the most recently created one — ' +
      'check for a stranded e2e organization). This journey drives pre-existing seeded data.',
  ).toHaveCount(1, { timeout: QUIZ_READ_TIMEOUT });
  await openCourse.click();

  await expect(page).toHaveURL(PLAYER_URL);
  await expect(heading2(page, COURSE)).toBeVisible({ timeout: QUIZ_READ_TIMEOUT });

  const openQuizLesson = quizLessonButton(page);
  await expect(
    openQuizLesson,
    `"${COURSE}" has no "${QUIZ_LESSON}" lesson in its lesson list, so this journey has no quiz ` +
      'surface to drive. It is seeded content (migration/azure/02-seed.sql:68) — do not point this ' +
      'spec at another course, work out why the lesson is gone.',
  ).toHaveCount(1);

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

  const submit = exactButton(page, SUBMIT_ANSWERS);
  const notReady = page.getByText(QUIZ_NOT_READY, { exact: true });
  const loadFailed = page.getByText(QUIZ_LOAD_FAILED, { exact: true });
  await expect(
    submit.or(notReady).or(loadFailed).first(),
    `the "${QUIZ_LESSON}" pane settled into none of its three states after ${QUIZ_ENDPOINT} ` +
      'answered — no questions, no "not ready" card and no error card, which is the empty pane ' +
      '#294 and #299 exist to rule out.',
  ).toBeVisible({ timeout: QUIZ_READ_TIMEOUT });

  if (await loadFailed.isVisible()) {
    throw new Error(
      `${QUIZ_ENDPOINT} failed for "${QUIZ_LESSON}": the player showed "${QUIZ_LOAD_FAILED}". ` +
        'Check the run report for the failed request.',
    );
  }

  if (await submit.isVisible()) {
    await expect(
      submit,
      `the "${QUIZ_LESSON}" quiz offers a submit button that is already enabled, with no question ` +
        'answered. The gate is `Object.keys(answers).length !== questions.length` ' +
        '(CoursePlayer.tsx:785) — an unanswered quiz must not be submittable.',
    ).toBeDisabled();

    await expect(
      page.getByRole('radio').first(),
      `the "${QUIZ_LESSON}" quiz rendered questions with no answer options, so there is nothing ` +
        `to answer and the submit button can never enable. ${QUIZ_ENDPOINT} returned questions ` +
        'without options.',
    ).toBeAttached();
    return;
  }

  await expect(
    notReady,
    `the "${QUIZ_LESSON}" pane is neither a quiz nor the "${QUIZ_NOT_READY}" card`,
  ).toBeVisible();
  await expect(
    exactButton(page, PREVIOUS),
    `"${QUIZ_LESSON}" shows the "${QUIZ_NOT_READY}" card with no way back — a dead end, which is ` +
      'the #299 regression. If the course content was reordered so this is now its first lesson, ' +
      'Previous is legitimately disabled and this assertion is the thing to revisit.',
  ).toBeEnabled();
  await expect(exactButton(page, NEXT), `the "${QUIZ_NOT_READY}" card rendered without its nav footer`).toHaveCount(1);
});
