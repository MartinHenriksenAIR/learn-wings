import { test, expect } from '@playwright/test';

test('login page renders in English when the language preference is seeded', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('preferred_language', 'en');
  });

  await page.goto('/login');

  await expect(page.getByRole('button', { name: 'Sign in with Microsoft' })).toBeVisible();
  // Guards #311 in a real browser: the document must declare the language it renders.
  await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe('en');
});
