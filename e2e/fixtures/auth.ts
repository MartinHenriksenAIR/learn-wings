import { expect, type Locator, type Page } from '@playwright/test';

export const AUTH_STATE_PATH = 'e2e/.auth/platform-admin.json';

export const RECAPTURE_HINT =
  'Captured session is missing or expired. Re-capture it with:\n' +
  '  npx playwright open --save-storage=e2e/.auth/platform-admin.json "$E2E_BASE_URL/login"\n' +
  'Sign in by hand, then close the browser window.';

/**
 * The app's sidebar, for scoping nav assertions away from page content.
 *
 * Not `getByRole('navigation')`: the shadcn sidebar is divs plus a `<ul>` with no
 * `<nav>` landmark (`src/components/ui/sidebar.tsx`), so the page's only
 * `navigation` role is the breadcrumb inside `<main>`. Breadcrumbs repeat the
 * current page's title, so scoping to that role lets page content satisfy a
 * sidebar assertion — it is how the first draft of this helper passed while
 * matching the wrong element. Exactly one element carries this attribute: the
 * mobile and desktop branches of `Sidebar` are mutually exclusive.
 */
export function sidebarNav(page: Page): Locator {
  return page.locator('[data-sidebar="sidebar"]');
}

/**
 * Complete sign-in using the human-captured Entra cookies.
 *
 * The click is required, not decorative: storageState carries the Entra SSO
 * cookies but NOT MSAL's token cache (it lives in sessionStorage), so the app
 * boots with no account and waits on the button. With the cookies present the
 * click round-trips through Entra without any credential prompt.
 */
export async function signInThroughSso(page: Page): Promise<void> {
  await page.goto('/login');

  const signIn = page.getByRole('button', { name: 'Sign in with Microsoft', exact: true });
  // waitFor, not isVisible: isVisible() returns immediately and its `timeout`
  // option is a documented no-op, so it would race the app's first render.
  const signInAppeared = await signIn
    .waitFor({ state: 'visible', timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  if (signInAppeared) {
    await signIn.click();
  }

  // Nav is scoped to the sidebar: page content must never satisfy this.
  const nav = sidebarNav(page);
  await expect(
    nav.getByRole('link', { name: 'Organizations', exact: true }),
    RECAPTURE_HINT,
  ).toBeVisible({ timeout: 45_000 });

  // A credential prompt means the capture is dead — say so, don't hang.
  expect(await page.locator('input[name="passwd"]').count(), RECAPTURE_HINT).toBe(0);
}
