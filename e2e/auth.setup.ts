import { test as setup } from '@playwright/test';
import { RECAPTURE_HINT, describeCapturedSessionProblem, signInThroughSso } from './fixtures/auth';
import { seedSession } from './fixtures/session';

setup('captured session is present and still valid', async ({ page }) => {
  // Missing, truncated and cookie-less captures all get the same actionable
  // instruction here. playwright.config.ts runs the same check to decide whether to
  // hand the file to `storageState`, so Playwright's own ENOENT or JSON parse error
  // cannot land first and bury this message.
  const problem = describeCapturedSessionProblem();
  if (problem) {
    throw new Error(`${problem}\n${RECAPTURE_HINT}`);
  }

  // Seeded through the specs' own helper, not a second hand-written copy of it:
  // this guard has to sign in under the session the specs get, and two copies of
  // the storage keys would drift the moment either side changes. `test` here stays
  // the plain one — the fixture's auto-seeding belongs to the spec project, and
  // borrowing it would make the precondition guard depend on the thing it gates.
  await seedSession(page);

  await signInThroughSso(page);
});
