import { test as setup } from '@playwright/test';
import { RECAPTURE_HINT, describeCapturedSessionProblem, signInThroughSso } from './fixtures/auth';
import { seedSession } from './fixtures/session';

setup('captured session is present and still valid', async ({ page }) => {
  const problem = describeCapturedSessionProblem();
  if (problem) {
    throw new Error(`${problem}\n${RECAPTURE_HINT}`);
  }

  await seedSession(page);

  await signInThroughSso(page);
});
