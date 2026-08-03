import { test, expect } from '../fixtures/session';
import { SIGN_IN_WORST_CASE_TIMEOUT, sidebarNav, signInThroughSso } from '../fixtures/auth';

// `test` comes from ../fixtures/session, not @playwright/test: its auto fixture
// seeds `viewMode` and `preferred_language` before app boot, which is what the
// deleted beforeEach here used to do by hand. Both tests run in the fixture's
// default platform-admin view.

/**
 * The 30s cold Azure Functions round-trip budget the rest of this suite counts its
 * per-test ceilings in — LESSON_WRITE_TIMEOUT, INVITE_READ_TIMEOUT, REPORT_TIMEOUT,
 * COURSE_WRITE_TIMEOUT and QUIZ_READ_TIMEOUT are all this same figure. This spec issues no
 * explicit-timeout wait of its own — its long waits are sign-in and Playwright's 30s
 * navigation default — so the constant appears only in SPEC_TIMEOUT below, as the currency
 * the ceiling is expressed in. Kept a local copy rather than imported for the same reason
 * 05/06/08 keep theirs local: a shared import would couple budgets that only agree by
 * coincidence (see the note on COURSE_WRITE_TIMEOUT in e2e/fixtures/course.ts).
 */
const COLD_START_BUDGET = 30_000;

/**
 * What one run of either test here may spend, replacing the config's per-test cap.
 *
 * That cap is `SIGN_IN_WORST_CASE_TIMEOUT + 25_000` — 90s, sized for a spec whose only long
 * wait is sign-in itself (playwright.config.ts). The longer of this file's two tests — the
 * deep-link one — sums to 155s: sign-in's own worst case (65s) plus the `page.goto('/login')`
 * inside it, which that figure deliberately excludes (30s); one `page.goto` at Playwright's
 * 30s navigation default; and two assertions on the config's 15s `expect` default (the URL
 * check and the Course Manager heading, 30s). The first test is shorter (95s + a 15s
 * assertion = 110s).
 *
 * At 90s a cold start therefore trips the cap while one of those waits is still running, and
 * the run prints Playwright's generic "Test timeout exceeded" instead of the message that
 * wait carries — an expired capture, a wrong view, or a landmark that never rendered
 * (e2e/fixtures/auth.ts). Four cold-start budgets on top of sign-in's worst case (185s) sits
 * above the 155s the longer path can spend, so this cap is never the thing that fires — a
 * ceiling on a pathological run where every wait spends its whole budget, not an expectation.
 */
const SPEC_TIMEOUT = SIGN_IN_WORST_CASE_TIMEOUT + 4 * COLD_START_BUDGET;

test.describe.configure({ timeout: SPEC_TIMEOUT });

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
