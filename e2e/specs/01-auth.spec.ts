import { test, expect } from '../fixtures/session';
import { sidebarNav, signInThroughSso } from '../fixtures/auth';

// `test` comes from ../fixtures/session, not @playwright/test: its auto fixture
// seeds `viewMode` and `preferred_language` before app boot, which is what the
// deleted beforeEach here used to do by hand. Both tests run in the fixture's
// default platform-admin view.

test('the captured session reaches the platform-admin surface', async ({ page }) => {
  await signInThroughSso(page);

  const nav = sidebarNav(page);
  // The sidebar link is the whole claim, and a `not.toHaveURL(/\/login/)` beside it
  // could not fail: `AppSidebar` renders only inside `AppLayout`
  // (src/components/layout/AppLayout.tsx:59), and the login route renders `<Login />`
  // on its own (src/App.tsx:45), so this link cannot resolve on /login.
  await expect(nav.getByRole('link', { name: 'Platform Settings', exact: true })).toBeVisible();
});

test('a deep link is honoured after signing in', async ({ page }) => {
  await signInThroughSso(page);

  await page.goto('/app/admin/platform/courses');

  await expect(page).toHaveURL(/\/app\/admin\/platform\/courses/);
  await expect(page.getByRole('heading', { name: 'Course Manager', exact: true })).toBeVisible();
});
