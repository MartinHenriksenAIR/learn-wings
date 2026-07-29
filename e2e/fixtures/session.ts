import { test as base, expect, type Page } from '@playwright/test';
import type { ViewMode } from './auth';

// Re-exported so specs have one import site for the fixture and its types.
// Owned by ./auth, which needs it for its per-view sidebar-landmark table.
export type { ViewMode };

/**
 * Re-seed the parts of the session Playwright's storageState cannot carry.
 *
 * MSAL caches tokens in sessionStorage and `viewMode` lives there too
 * (src/hooks/useAuth.tsx:53), while storageState persists only cookies +
 * localStorage. The Entra SSO cookie in the saved state is what lets MSAL
 * complete its redirect silently; `viewMode` and the language preference have to
 * be written before app boot, which is what addInitScript guarantees — both are
 * read once, in a `useState` initializer and an i18next detector, so a write that
 * lands after boot is simply ignored.
 *
 * The account is a platform admin, so `viewMode` alone reaches all three views:
 * `effectiveIsOrgAdmin` is granted by the mode with no membership row
 * (useAuth.tsx:99-101).
 *
 * The language is fixed at `en` rather than offered as a choice: every text
 * locator the authenticated helpers use is an English accessible name (see
 * SIDEBAR_LANDMARK in ./auth), so a Danish seed would break them all. The one spec
 * that does render Danish is unauthenticated and seeds the key itself
 * (e2e/specs/00-harness.spec.ts).
 */
export async function seedSession(page: Page, opts: { viewMode?: ViewMode } = {}): Promise<void> {
  const viewMode = opts.viewMode ?? 'platform_admin';
  await page.addInitScript((mode) => {
    localStorage.setItem('preferred_language', 'en');
    sessionStorage.setItem('viewMode', mode);
  }, viewMode);
}

/**
 * `test` with the session seeded before every navigation.
 *
 * `viewMode` is an option, so a spec or describe block picks its view with
 * `test.use({ viewMode: 'learner' })`, and reads it back as a fixture to pass to
 * `signInThroughSso` — which needs the same value to know which sidebar link
 * proves sign-in finished.
 *
 * Specs import `test` and `expect` from here rather than from @playwright/test:
 * the seeding is an `auto` fixture, so importing the wrong `test` silently drops
 * it and the app boots in whatever view the fallback picks.
 */
export const test = base.extend<{ viewMode: ViewMode; seeded: void }>({
  viewMode: ['platform_admin', { option: true }],
  seeded: [
    async ({ page, viewMode }, use) => {
      await seedSession(page, { viewMode });
      await use();
    },
    { auto: true },
  ],
});

export { expect };
