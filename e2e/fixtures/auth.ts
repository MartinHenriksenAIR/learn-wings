import { readFileSync } from 'node:fs';
import { errors, expect, type Locator, type Page } from '@playwright/test';

export const AUTH_STATE_PATH = 'e2e/.auth/platform-admin.json';

/**
 * The three role views the app can render, mirroring `ViewMode` in
 * src/hooks/useAuth.tsx.
 *
 * Declared here rather than in e2e/fixtures/session.ts — which re-exports it as
 * the fixture's public name — because `signInThroughSso` needs it and session.ts
 * imports this module at runtime. Owning it there would make the cycle a real one.
 */
export type ViewMode = 'platform_admin' | 'org_admin' | 'learner';

/**
 * The sidebar link whose presence proves sign-in finished in the seeded view.
 *
 * Each string is a link `AppSidebar` renders only when the view allows it
 * (src/components/layout/AppSidebar.tsx:193-203): the platform-admin group for
 * `Organizations`, the org-admin group for `Organization`, the learning group —
 * shown to every non-platform view — for `Dashboard`.
 *
 * `Dashboard` is therefore NOT exclusive to learner view: org-admin view renders
 * it too. It still does the job asked of it, because the failure it has to catch
 * is a seed that never took, and an unseeded `viewMode` falls back to
 * `platform_admin` (useAuth.tsx:53-57) — which renders no `Dashboard` link at all.
 * What it does not do is tell learner and org-admin view apart.
 *
 * English strings, so they hold only while `preferred_language` is seeded `en`
 * (the `seedSession` default). A Danish-seeded spec needs Danish labels, and hits
 * the same substring trap: `Organisation` is a prefix of `Organisationer`.
 */
const SIDEBAR_LANDMARK: Record<ViewMode, string> = {
  platform_admin: 'Organizations',
  org_admin: 'Organization',
  learner: 'Dashboard',
};

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
 * Budget for the seeded view's landmark link, once the sidebar itself is up.
 *
 * Short on purpose: the nav groups are decided by `viewMode`, which is already in
 * sessionStorage before boot, so they render in the same commit as the sidebar
 * shell. Nothing further is awaited — spending the full sign-in budget here would
 * only delay a view-mode diagnosis that is already knowable.
 */
const VIEW_RENDER_TIMEOUT = 10_000;

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
 *
 * `viewMode` says which view the caller seeded (e2e/fixtures/session.ts) and so
 * which sidebar link to wait for. It has to be told: seeding `org_admin` or
 * `learner` removes the `Organizations` link this used to hardcode, and waiting
 * on an absent link fails after the full sign-in budget with a message accusing a
 * perfectly good capture. Defaulted, so callers already on the platform-admin
 * view need not pass it.
 */
export async function signInThroughSso(page: Page, viewMode: ViewMode = 'platform_admin'): Promise<void> {
  await page.goto('/login');

  const signIn = page.getByRole('button', { name: 'Sign in with Microsoft', exact: true });
  // waitFor, not isVisible: isVisible() returns immediately and its `timeout`
  // option is a documented no-op, so it would race the app's first render.
  if (await becameVisible(signIn, 10_000)) {
    await signIn.click();
  }

  const nav = sidebarNav(page);
  const credentialPrompt = page.locator(CREDENTIAL_FIELDS);

  // One wait for either outcome, so an expired capture is named within seconds of
  // Entra asking rather than after the full sign-in budget. Testing the credential
  // fields *after* the sidebar assertion (as the first draft did) can only ever
  // count zero: a prompt on screen means the sidebar never arrived, so the sidebar
  // assertion fails first and the credential check never runs.
  //
  // The sidebar shell, not the landmark link, is what settles this race: the shell
  // means "signed in", which is the only claim the recapture hint is about. Which
  // view rendered inside it is a separate question, answered below.
  await expect(nav.or(credentialPrompt).first(), RECAPTURE_HINT).toBeVisible({
    timeout: SIGN_IN_TIMEOUT,
  });

  // Which of the two arrived is the diagnosis.
  if (await credentialPrompt.first().isVisible()) {
    throw new Error(`Microsoft asked for credentials, so the captured session is no longer valid.\n${RECAPTURE_HINT}`);
  }

  // Scoped to the sidebar: page content must never satisfy this. `exact: true` is
  // load-bearing rather than defensive — accessible names match as substrings by
  // default, and `Organization` is a substring of `Organizations`, so each of those
  // two landmarks would otherwise be satisfied by the other's view.
  const landmark = nav.getByRole('link', { name: SIDEBAR_LANDMARK[viewMode], exact: true });
  if (!(await becameVisible(landmark, VIEW_RENDER_TIMEOUT))) {
    // Signed in, so the capture is fine and saying otherwise would send the reader
    // to re-capture a healthy session. Name the view asked for and the links that
    // did render, which is what separates a seed that never applied from a nav
    // group that no longer contains the link this table expects.
    const rendered = await nav.getByRole('link').allInnerTexts();
    const present = rendered.map((text) => JSON.stringify(text.trim())).join(', ') || '(none)';
    throw new Error(
      `Signed in and the sidebar rendered, but its ${JSON.stringify(SIDEBAR_LANDMARK[viewMode])} ` +
        `link — the landmark for viewMode=${viewMode} — never appeared. Sidebar links present: ${present}. ` +
        'The captured session is valid; this is a view-mode or nav problem, not an expired capture.',
    );
  }
}
