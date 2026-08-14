import { expect, type Locator, type Page } from '@playwright/test';
import { test as fencedOrgTest } from './fenced-org';


export const COURSES_PATH = '/app/admin/platform/courses';

export const COURSE_WRITE_TIMEOUT = 30_000;

const COURSE_CLEANUP_TIMEOUT = 10 * COURSE_WRITE_TIMEOUT;

const NEW_COURSE = 'New Course';

const TITLE_PLACEHOLDER = 'Course title';

const CREATE_CONFIRM = 'Create';

const DELETE_AFFORDANCE = 'Delete course';

const CREATE_FAILURE = 'Failed to create course';
const DELETE_FAILURE = 'Failed to delete course';

const DELETE_SUCCESS = 'Course deleted';

function newCourseButton(page: Page): Locator {
  return page.getByRole('button', { name: NEW_COURSE, exact: true }).first();
}

export function courseRowTitle(page: Page, title: string): Locator {
  return page.getByRole('button', { name: title, exact: true });
}

function courseRow(page: Page, title: string): Locator {
  return courseRowTitle(page, title).first().locator('..');
}

export async function createCourse(page: Page, opts: { title: string }): Promise<void> {
  await expect(newCourseButton(page), 'the course list never finished loading, so nothing can be created on it').toBeVisible(
    { timeout: COURSE_WRITE_TIMEOUT },
  );

  const row = courseRowTitle(page, opts.title);
  const alreadyThere = await row.count();
  if (alreadyThere === 1) {
    return;
  }
  if (alreadyThere > 1) {
    throw new Error(
      `${alreadyThere} courses are already named ${opts.title}, so this run cannot tell which one ` +
        'is its own. Delete all but one by hand — they are live rows in the production database.',
    );
  }

  await newCourseButton(page).click();

  const dialog = page.getByRole('dialog');
  await dialog.getByPlaceholder(TITLE_PLACEHOLDER, { exact: true }).fill(opts.title);
  await dialog.getByRole('button', { name: CREATE_CONFIRM, exact: true }).click();

  const failure = page.getByText(CREATE_FAILURE, { exact: true });
  await expect(
    row.or(failure).first(),
    `neither a row for ${opts.title} nor a failure toast appeared, so course-create neither ` +
      'succeeded nor said why — check the run report for a failed request.',
  ).toBeVisible({ timeout: COURSE_WRITE_TIMEOUT });

  if (await failure.first().isVisible()) {
    throw new Error(`course-create failed for ${opts.title}: the app showed "${CREATE_FAILURE}".`);
  }

  await expect(
    row,
    `${opts.title} was created but the list does not show exactly one row for it`,
  ).toHaveCount(1, { timeout: COURSE_WRITE_TIMEOUT });
}

async function confirmRowDelete(page: Page, title: string): Promise<void> {
  await courseRow(page, title).getByRole('button', { name: DELETE_AFFORDANCE, exact: true }).click();

  const confirmDialog = page.getByRole('alertdialog');
  await expect(confirmDialog, `the delete confirmation for ${title} did not open`).toBeVisible();
  await confirmDialog.getByRole('button', { name: DELETE_AFFORDANCE, exact: true }).click();

  const deleted = page.getByText(DELETE_SUCCESS, { exact: true });
  const failure = page.getByText(DELETE_FAILURE, { exact: true });
  await expect(
    deleted.or(failure).first(),
    `deleting ${title} produced neither "${DELETE_SUCCESS}" nor "${DELETE_FAILURE}", so ` +
      'course-delete neither succeeded nor said why — check the run report for a failed request.',
  ).toBeVisible({ timeout: COURSE_WRITE_TIMEOUT });

  if (await failure.first().isVisible()) {
    throw new Error(`course-delete failed for ${title}: the app showed "${DELETE_FAILURE}".`);
  }

  await expect(confirmDialog, `the delete confirmation for ${title} stayed open`).toBeHidden({
    timeout: COURSE_WRITE_TIMEOUT,
  });
}

export async function deleteCourse(page: Page, title: string): Promise<void> {
  await confirmRowDelete(page, title);

  await expect(
    courseRowTitle(page, title),
    `${title} is still listed after a delete the app reported as successful, which means the list ` +
      'held more than one course under that name — they are live rows in the production database.',
  ).toHaveCount(0, { timeout: COURSE_WRITE_TIMEOUT });
}

async function sweepCourses(page: Page, titles: readonly string[]): Promise<void> {
  await page.goto(COURSES_PATH);
  await expect(
    newCourseButton(page),
    "the course list never loaded, so this run's courses could not be swept — check them by hand",
  ).toBeVisible({ timeout: COURSE_WRITE_TIMEOUT });

  for (const title of titles) {
    for (let remaining = await courseRowTitle(page, title).count(); remaining > 0; remaining -= 1) {
      await confirmRowDelete(page, title);
      await expect(
        courseRowTitle(page, title),
        `${title} did not leave the list after a delete the app reported as successful`,
      ).toHaveCount(remaining - 1, { timeout: COURSE_WRITE_TIMEOUT });
    }
  }
}

export type PendingCourses = { titles: string[] };

export const test = fencedOrgTest.extend<{ courseCleanup: PendingCourses }>({
  courseCleanup: [
    async ({ page }, use) => {
      const pending: PendingCourses = { titles: [] };
      try {
        await use(pending);
      } finally {
        if (pending.titles.length > 0) {
          await sweepCourses(page, pending.titles);
        }
      }
    },
    { timeout: COURSE_CLEANUP_TIMEOUT, title: "this run's courses, removed" },
  ],
});

export { expect };
