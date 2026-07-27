import { test as setup } from '@playwright/test';
import { RECAPTURE_HINT, describeCapturedSessionProblem, signInThroughSso } from './fixtures/auth';

setup('captured session is present and still valid', async ({ page }) => {
  // Missing, truncated and cookie-less captures all get the same actionable
  // instruction here. playwright.config.ts runs the same check to decide whether to
  // hand the file to `storageState`, so Playwright's own ENOENT or JSON parse error
  // cannot land first and bury this message.
  const problem = describeCapturedSessionProblem();
  if (problem) {
    throw new Error(`${problem}\n${RECAPTURE_HINT}`);
  }

  await page.addInitScript(() => {
    localStorage.setItem('preferred_language', 'en');
    sessionStorage.setItem('viewMode', 'platform_admin');
  });

  await signInThroughSso(page);
});
