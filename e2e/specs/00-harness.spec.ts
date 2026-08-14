import { test, expect } from '@playwright/test';

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

    await expect(page.getByRole('button', { name: signInLabel, exact: true })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', seed);
  });
}
