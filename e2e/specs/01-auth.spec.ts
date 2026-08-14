import { test, expect } from '../fixtures/session';
import { SIGN_IN_WORST_CASE_TIMEOUT, sidebarNav, signInThroughSso } from '../fixtures/auth';


const COLD_START_BUDGET = 30_000;

const SPEC_TIMEOUT = SIGN_IN_WORST_CASE_TIMEOUT + 4 * COLD_START_BUDGET;

test.describe.configure({ timeout: SPEC_TIMEOUT });

test('the captured session reaches the platform-admin surface', async ({ page }) => {
  await signInThroughSso(page);

  const nav = sidebarNav(page);
  await expect(nav.getByRole('link', { name: 'Platform Settings', exact: true })).toBeVisible();
});

test('a deep link is honoured after signing in', async ({ page }) => {
  await signInThroughSso(page);

  await page.goto('/app/admin/platform/courses');

  await expect(page).toHaveURL(/\/app\/admin\/platform\/courses/);
  await expect(page.getByRole('heading', { name: 'Course Manager', exact: true })).toBeVisible();
});
