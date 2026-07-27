import { test, expect } from '../fixtures/session';
import { sidebarNav, signInThroughSso } from '../fixtures/auth';

// `test` comes from ../fixtures/session, not @playwright/test: its auto fixture
// seeds `viewMode` and `preferred_language` before app boot, which is what the
// deleted beforeEach here used to do by hand. Both tests run in the fixture's
// default platform-admin view.

test('the captured session reaches the platform-admin surface', async ({ page }) => {
  await signInThroughSso(page);

  const nav = sidebarNav(page);
  await expect(nav.getByRole('link', { name: 'Platform Settings', exact: true })).toBeVisible();
  await expect(page).not.toHaveURL(/\/login/);
});

test('a deep link is honoured after signing in', async ({ page }) => {
  await signInThroughSso(page);

  await page.goto('/app/admin/platform/courses');

  await expect(page).toHaveURL(/\/app\/admin\/platform\/courses/);
  await expect(page.getByRole('heading', { name: 'Course Manager', exact: true })).toBeVisible();
});
