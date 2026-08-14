import { readFileSync } from 'node:fs';
import { errors, expect, type Locator, type Page } from '@playwright/test';

export const AUTH_STATE_PATH = 'e2e/.auth/platform-admin.json';

export type ViewMode = 'platform_admin' | 'org_admin' | 'learner';

const SIDEBAR_LANDMARK: Record<ViewMode, string> = {
  platform_admin: 'Organizations',
  org_admin: 'Organization',
  learner: 'Dashboard',
};

export const RECAPTURE_HINT =
  'Captured session is missing or expired. Re-capture it with:\n' +
  '  npm run e2e:capture\n' +
  'Sign in by hand, then close the browser window.';

const CREDENTIAL_FIELDS = 'input[name="loginfmt"], input[name="passwd"]';

const SIGN_IN_BUTTON_TIMEOUT = 10_000;

const SIGN_IN_TIMEOUT = 45_000;

const VIEW_RENDER_TIMEOUT = 10_000;

export const SIGN_IN_WORST_CASE_TIMEOUT = SIGN_IN_BUTTON_TIMEOUT + SIGN_IN_TIMEOUT + VIEW_RENDER_TIMEOUT;

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

export function sidebarNav(page: Page): Locator {
  return page.locator('[data-sidebar="sidebar"]');
}

export async function signInThroughSso(page: Page, viewMode: ViewMode = 'platform_admin'): Promise<void> {
  await page.goto('/login');

  const signIn = page.getByRole('button', { name: 'Sign in with Microsoft', exact: true });
  if (await becameVisible(signIn, SIGN_IN_BUTTON_TIMEOUT)) {
    await signIn.click();
  }

  const nav = sidebarNav(page);
  const credentialPrompt = page.locator(CREDENTIAL_FIELDS);

  await expect(nav.or(credentialPrompt).first(), RECAPTURE_HINT).toBeVisible({
    timeout: SIGN_IN_TIMEOUT,
  });

  if (await credentialPrompt.first().isVisible()) {
    throw new Error(`Microsoft asked for credentials, so the captured session is no longer valid.\n${RECAPTURE_HINT}`);
  }

  const landmark = nav.getByRole('link', { name: SIDEBAR_LANDMARK[viewMode], exact: true });
  if (!(await becameVisible(landmark, VIEW_RENDER_TIMEOUT))) {
    const rendered = await nav.getByRole('link').allInnerTexts();
    const present = rendered.map((text) => JSON.stringify(text.trim())).join(', ') || '(none)';
    throw new Error(
      `Signed in and the sidebar rendered, but its ${JSON.stringify(SIDEBAR_LANDMARK[viewMode])} ` +
        `link — the landmark for viewMode=${viewMode} — never appeared. Sidebar links present: ${present}. ` +
        'The captured session is valid; this is a view-mode or nav problem, not an expired capture.',
    );
  }
}
