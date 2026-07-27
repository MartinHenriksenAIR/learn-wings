import { readFileSync } from 'node:fs';
import { errors, expect, type Locator, type Page } from '@playwright/test';

export const AUTH_STATE_PATH = 'e2e/.auth/platform-admin.json';

export const RECAPTURE_HINT =
  'Captured session is missing or expired. Re-capture it with:\n' +
  '  npx playwright open --save-storage=e2e/.auth/platform-admin.json "$E2E_BASE_URL/login"\n' +
  'Sign in by hand, then close the browser window.';

/**
 * Microsoft's own credential fields — the email step and the password step.
 *
 * Only ever located, never filled: the suite stores no credentials, so one of these
 * on screen means the capture is dead and a human has to redo it.
 */
const CREDENTIAL_FIELDS = 'input[name="loginfmt"], input[name="passwd"]';

/** Budget for the Entra round-trip plus the app's first authenticated render. */
const SIGN_IN_TIMEOUT = 45_000;

/**
 * Why the captured session cannot be replayed, or null when it can.
 *
 * Establishes that the file is readable, parses as JSON and carries at least one
 * cookie — i.e. that it is usable as Playwright `storageState`. It does NOT
 * establish that Entra still accepts the session; expiry is what
 * `signInThroughSso` detects.
 *
 * Existence alone is not enough: a truncated or half-written capture passes an
 * `existsSync` guard and then dies inside Playwright's own JSON parse, which
 * pre-empts the guard and prints nothing about how to re-capture.
 */
export function describeCapturedSessionProblem(path: string = AUTH_STATE_PATH): string | null {
  const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    return `${path} could not be read: ${messageOf(error)}.`;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return `${path} is not valid JSON: ${messageOf(error)}.`;
  }

  const cookies = (parsed as { cookies?: unknown }).cookies;
  if (!Array.isArray(cookies) || cookies.length === 0) {
    return `${path} holds no cookies, so it cannot replay a signed-in session.`;
  }

  return null;
}

/**
 * True once the locator is visible; false if it simply never appeared in time.
 *
 * Only a timeout counts as "not there". A navigation failure or a closed page is a
 * genuine fault and propagates, instead of being silently reinterpreted as an
 * absent element.
 */
async function becameVisible(locator: Locator, timeout: number): Promise<boolean> {
  try {
    await locator.waitFor({ state: 'visible', timeout });
    return true;
  } catch (error) {
    if (error instanceof errors.TimeoutError) {
      return false;
    }
    throw error;
  }
}

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
  if (await becameVisible(signIn, 10_000)) {
    await signIn.click();
  }

  // Nav is scoped to the sidebar: page content must never satisfy this.
  const signedIn = sidebarNav(page).getByRole('link', { name: 'Organizations', exact: true });
  const credentialPrompt = page.locator(CREDENTIAL_FIELDS);

  // One wait for either outcome, so an expired capture is named within seconds of
  // Entra asking rather than after the full sign-in budget. Testing the credential
  // fields *after* the sidebar assertion (as the first draft did) can only ever
  // count zero: a prompt on screen means the sidebar never arrived, so the sidebar
  // assertion fails first and the credential check never runs.
  await expect(signedIn.or(credentialPrompt).first(), RECAPTURE_HINT).toBeVisible({
    timeout: SIGN_IN_TIMEOUT,
  });

  // Which of the two arrived is the diagnosis.
  if (await credentialPrompt.first().isVisible()) {
    throw new Error(`Microsoft asked for credentials, so the captured session is no longer valid.\n${RECAPTURE_HINT}`);
  }

  // The wait above is satisfied by either locator; this pins the outcome to the
  // signed-in one. Already true here, so it costs nothing on the happy path.
  await expect(signedIn, RECAPTURE_HINT).toBeVisible();
}
