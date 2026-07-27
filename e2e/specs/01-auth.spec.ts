import { test, expect } from '@playwright/test';
import { sidebarNav, signInThroughSso } from '../fixtures/auth';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('preferred_language', 'en');
    sessionStorage.setItem('viewMode', 'platform_admin');
  });
});

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
