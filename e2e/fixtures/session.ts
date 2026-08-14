import { test as base, expect, type Page } from '@playwright/test';
import type { ViewMode } from './auth';

export type { ViewMode };

export async function seedSession(page: Page, opts: { viewMode?: ViewMode } = {}): Promise<void> {
  const viewMode = opts.viewMode ?? 'platform_admin';
  await page.addInitScript((mode) => {
    localStorage.setItem('preferred_language', 'en');
    sessionStorage.setItem('viewMode', mode);
  }, viewMode);
}

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
