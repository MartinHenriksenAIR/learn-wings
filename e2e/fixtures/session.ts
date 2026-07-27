import { test as base, expect, type Page } from '@playwright/test';
import type { ViewMode } from './auth';

// Re-exported so specs get the view type from the fixture they already import.
// Its home is ./auth, which needs it to pick the sidebar landmark to wait for.
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
 */
export async function seedSession(
  page: Page,
  opts: { viewMode?: ViewMode; language?: 'en' | 'da' } = {},
): Promise<void> {
  const viewMode = opts.viewMode ?? 'platform_admin';
  const language = opts.language ?? 'en';
  await page.addInitScript(
    ([mode, lang]) => {
      localStorage.setItem('preferred_language', lang);
      sessionStorage.setItem('viewMode', mode);
    },
    [viewMode, language] as const,
  );
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
