import { test as setup, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { AUTH_STATE_PATH, RECAPTURE_HINT, signInThroughSso } from './fixtures/auth';

setup('captured session is present and still valid', async ({ page }) => {
  expect(existsSync(AUTH_STATE_PATH), `${AUTH_STATE_PATH} does not exist. ${RECAPTURE_HINT}`).toBe(true);

  await page.addInitScript(() => {
    localStorage.setItem('preferred_language', 'en');
    sessionStorage.setItem('viewMode', 'platform_admin');
  });

  await signInThroughSso(page);
});
