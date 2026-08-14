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


test.use({ viewMode: 'org_admin' });

const SPEC_TIMEOUT = 27 * COURSE_WRITE_TIMEOUT;

test.describe.configure({ timeout: SPEC_TIMEOUT });

const COURSE_EDITOR_URL = /\/app\/admin\/platform\/courses\/[0-9a-f-]{36}$/;

const SAVE_CHANGES = 'Save changes';
const SAVED = 'Saved';

function courseTitleField(page: Page): Locator {
  return page.locator('input').and(page.getByRole('textbox'));
}

function saveButton(page: Page, label: string): Locator {
  return page.getByRole('button', { name: label, exact: true });
}

test('a course can be created, edited, found and deleted', async ({ page, fencedOrg, courseCleanup }) => {
  const title = e2eName('course');
  const editedTitle = `${title}-edited`;

  courseCleanup.titles.push(title, editedTitle);

  await gotoFenced(page, fencedOrg, COURSES_PATH);
  await createCourse(page, { title });

  await courseRowTitle(page, title).click();
  await expect(page).toHaveURL(COURSE_EDITOR_URL);
  await assertFenced(page, fencedOrg);

  await expect(courseTitleField(page)).toHaveValue(title, { timeout: COURSE_WRITE_TIMEOUT });

  await courseTitleField(page).fill(editedTitle);
  await saveButton(page, SAVE_CHANGES).click();
  await expect(saveButton(page, SAVED), 'the course save never reported success').toBeVisible({
    timeout: COURSE_WRITE_TIMEOUT,
  });

  await gotoFenced(page, fencedOrg, COURSES_PATH);
  await expect(courseRowTitle(page, editedTitle)).toHaveCount(1, { timeout: COURSE_WRITE_TIMEOUT });
  await expect(courseRowTitle(page, title)).toHaveCount(0);

  await deleteCourse(page, editedTitle);

  await gotoFenced(page, fencedOrg, COURSES_PATH);
  await expect(
    courseRowTitle(page, editedTitle),
    `${editedTitle} survived its deletion — it is a live row in the production database, delete it by hand`,
  ).toHaveCount(0, { timeout: COURSE_WRITE_TIMEOUT });
});
