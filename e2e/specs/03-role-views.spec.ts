import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../fixtures/session';
import { SIGN_IN_WORST_CASE_TIMEOUT, sidebarNav, signInThroughSso } from '../fixtures/auth';


const COLD_START_BUDGET = 30_000;

const SPEC_TIMEOUT = SIGN_IN_WORST_CASE_TIMEOUT + 7 * COLD_START_BUDGET;

test.describe.configure({ timeout: SPEC_TIMEOUT });

function viewSwitcherTrigger(page: Page): Locator {
  return sidebarNav(page).getByRole('button', { name: 'Viewing as:' });
}

async function switchViewTo(page: Page, label: string): Promise<void> {
  await viewSwitcherTrigger(page).click();
  await page.getByRole('menuitemradio', { name: label, exact: true }).click();
  await expect(sidebarNav(page).getByRole('button', { name: `Viewing as: ${label}` })).toBeVisible();
}

function pageHeader(page: Page): Locator {
  return page.locator('header');
}


test('the switcher swaps the platform nav for the learner nav', async ({ page }) => {
  await signInThroughSso(page);
  const nav = sidebarNav(page);

  await switchViewTo(page, 'Learner');

  await expect(nav.getByRole('link', { name: 'Dashboard', exact: true })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Platform Settings', exact: true })).toBeHidden();
  await expect(nav.getByRole('link', { name: 'Organizations', exact: true })).toBeHidden();
  await expect(pageHeader(page).getByText('Viewing as: Learner')).toBeVisible();
});

test('the switcher reaches org-admin view, which is not platform view', async ({ page }) => {
  await signInThroughSso(page);
  const nav = sidebarNav(page);

  await switchViewTo(page, 'Org. Admin');

  await expect(nav.getByRole('link', { name: 'Organization', exact: true })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Organizations', exact: true })).toBeHidden();
  await expect(pageHeader(page).getByText('Viewing as: Org. Admin')).toBeVisible();
});

test('a learner-only route is refused in platform view and reached in learner view', async ({ page }) => {
  await signInThroughSso(page);

  await page.goto('/app/dashboard');
  await expect(page).toHaveURL(/\/app\/admin\/platform\/organizations/);

  await switchViewTo(page, 'Learner');

  await sidebarNav(page).getByRole('link', { name: 'Dashboard', exact: true }).click();

  await expect(page).toHaveURL(/\/app\/dashboard/);
  await expect(page.getByRole('heading', { name: 'My Dashboard', exact: true })).toBeVisible();
});

test('switching back to platform view restores the platform nav and drops the chip', async ({ page }) => {
  await signInThroughSso(page);
  const nav = sidebarNav(page);
  await switchViewTo(page, 'Learner');
  await expect(nav.getByRole('link', { name: 'Platform Settings', exact: true })).toBeHidden();

  await switchViewTo(page, 'Platform Admin');

  await expect(nav.getByRole('link', { name: 'Platform Settings', exact: true })).toBeVisible();
  const header = pageHeader(page);
  await expect(header.getByRole('link', { name: 'Home', exact: true })).toBeVisible();
  await expect(header.getByText(/Viewing as:/)).toBeHidden();
});
