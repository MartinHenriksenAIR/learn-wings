import { test, expect } from '@playwright/test';

/**
 * Unauthenticated smoke: proves the config, baseURL and browser work before any
 * auth complexity enters, and that seeding `preferred_language` is what decides
 * the rendered language.
 *
 * Both cases are load-bearing. Chromium's own locale is en-US, so the English
 * case passes with or without the seed and on its own proves nothing about the
 * preference — only the Danish case pins the seed as the cause. Do not drop it
 * as redundant: it is also the only real-browser guard on the #300 bug class,
 * where a key missing from da.json silently rendered English on a Danish page.
 */
const cases = [
  { seed: 'en', language: 'English', signInLabel: 'Sign in with Microsoft' },
  { seed: 'da', language: 'Danish', signInLabel: 'Log ind med Microsoft' },
] as const;

for (const { seed, language, signInLabel } of cases) {
  test(`seeding preferred_language=${seed} renders the login page in ${language}`, async ({ page }) => {
    await page.addInitScript((value) => {
      localStorage.setItem('preferred_language', value);
    }, seed);

    await page.goto('/login');

    // `exact: true` throughout the suite: accessible names match as substrings by
    // default, which is how two earlier locators here matched the wrong element.
    await expect(page.getByRole('button', { name: signInLabel, exact: true })).toBeVisible();
    // Guards #311 in a real browser: the document must declare the language it renders.
    await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe(seed);
  });
}
