import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../fixtures/session';
import { SIGN_IN_WORST_CASE_TIMEOUT, sidebarNav, signInThroughSso } from '../fixtures/auth';
import { orgSelector } from '../fixtures/fenced-org';


test.use({ viewMode: 'learner' });

const CATALOGUE_PATH = '/app/courses';

const PLAYER_URL = /\/app\/learn\/[0-9a-f-]{36}$/;

const COURSE = 'AI Fundamentals';

const LESSON = 'Welcome Video';

const MARK_COMPLETE = 'Mark as complete';
const COMPLETED = 'Completed';

const SELECTED_ORG = /^(?!Platform-wide \(no org\)$)(?!.*e2e-).+$/;

const LESSON_WRITE_TIMEOUT = 30_000;

const SPEC_TIMEOUT = SIGN_IN_WORST_CASE_TIMEOUT + 17 * LESSON_WRITE_TIMEOUT;

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

function progressCounter(page: Page): Locator {
  return page.getByText(/^\d+\/\d+\s*·\s*\d+%$/);
}

async function expectLessonComplete(page: Page, message: string): Promise<void> {
  await expect(page.getByText(COMPLETED, { exact: true }), message).toBeVisible({
    timeout: LESSON_WRITE_TIMEOUT,
  });
  await expect(page.getByRole('button', { name: MARK_COMPLETE, exact: true }), message).toBeHidden();
}

test('a completed lesson stays completed after a reload', async ({ page, viewMode }) => {
  await signInThroughSso(page, viewMode);

  await page.goto(CATALOGUE_PATH);

  await expect(page.locator('header').getByText('Viewing as: Learner')).toBeVisible();
  const nav = sidebarNav(page);
  await expect(nav.getByRole('link', { name: 'Organizations', exact: true })).toBeHidden();
  await expect(nav.getByRole('link', { name: 'Organization', exact: true })).toBeHidden();

  await expect(
    orgSelector(page),
    'the sidebar OrgSelector never settled on a real organization this journey can drive. In ' +
      'learner view it auto-selects orgs[0] — the most recently created org ' +
      '(functions/organizations/index.ts:33) — so the usual cause is run debris: a fenced org ' +
      'stranded by a failed 02/04 teardown is the newest org, becomes orgs[0], carries the ' +
      'e2e- prefix and has an empty catalogue. Delete the stranded e2e- org and re-run. (It ' +
      'also fails if no org is ever selected, or the org list never loaded.)',
  ).toHaveText(SELECTED_ORG, { timeout: LESSON_WRITE_TIMEOUT });

  const openCourse = courseCardBody(page, COURSE).getByRole('link');
  await expect(
    openCourse,
    `no play link for a "${COURSE}" card on the learner catalogue: the course is absent from ` +
      'the organization the sidebar selector auto-selected (the most recently created one — ' +
      'check for a stranded e2e organization). This journey drives pre-existing seeded data.',
  ).toHaveCount(1, { timeout: LESSON_WRITE_TIMEOUT });
  await openCourse.click();

  await expect(page).toHaveURL(PLAYER_URL);
  await expect(heading2(page, COURSE)).toBeVisible({ timeout: LESSON_WRITE_TIMEOUT });
  await expect(heading2(page, LESSON)).toBeVisible();

  const markComplete = page.getByRole('button', { name: MARK_COMPLETE, exact: true });
  await expect(
    markComplete.or(page.getByText(COMPLETED, { exact: true })).first(),
    `the "${LESSON}" pane rendered neither the "${MARK_COMPLETE}" button nor a "${COMPLETED}" ` +
      'badge, so its footer settled into neither state and the branch below would read the ' +
      'absent button as "already complete" (CoursePlayer.tsx:809-832).',
  ).toBeVisible();

  if (await markComplete.isVisible()) {
    await markComplete.click();

    await expect(
      heading2(page, LESSON),
      'completing the lesson never advanced the player, so the progress write did not succeed',
    ).toBeHidden({ timeout: LESSON_WRITE_TIMEOUT });

    await page.getByRole('button', { name: LESSON }).click();
    await expectLessonComplete(page, `the player did not consider "${LESSON}" complete after saving`);
  }

  await page.reload();
  await expect(heading2(page, LESSON)).toBeVisible({ timeout: LESSON_WRITE_TIMEOUT });
  await expectLessonComplete(
    page,
    `"${LESSON}" is not complete after a reload — the progress was never persisted server-side`,
  );
  await expect(progressCounter(page)).toHaveText(/^[1-9]\d*\//);
});
