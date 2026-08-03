import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';
import { config as loadEnv } from 'dotenv';
import { AUTH_STATE_PATH, SIGN_IN_WORST_CASE_TIMEOUT, describeCapturedSessionProblem } from './e2e/fixtures/auth';

// dotenv resolves a relative `path` against process.cwd(), so `.env.e2e` would go
// unfound whenever Playwright is invoked from a subdirectory. Anchor it to this
// config file instead, and keep `quiet` on — dotenv v17 otherwise prints a
// promotional tip line every time the config is loaded (once per process).
const envFile = fileURLToPath(new URL('.env.e2e', import.meta.url));
const { error: envFileError } = loadEnv({ path: envFile, quiet: true });

// Pointing `storageState` at a file that is missing or unparseable makes Playwright
// fail context creation with a bare ENOENT or JSON error, which pre-empts the setup
// guard and hides the one thing the reader needs — how to re-capture. Passing
// `undefined` instead lets the guard run and say it (e2e/auth.setup.ts).
const storageState = describeCapturedSessionProblem() === null ? AUTH_STATE_PATH : undefined;

const baseURL = process.env.E2E_BASE_URL;
if (!baseURL) {
  // The file is only required when the variable is not already in the environment,
  // so a missing file and a missing variable are reported as the distinct problems
  // they are.
  throw new Error(
    envFileError
      ? `Could not read .env.e2e: ${envFileError.message}. Copy .env.e2e.example to .env.e2e and fill it in.`
      : `E2E_BASE_URL is not set. Add it to ${envFile} — see .env.e2e.example.`,
  );
}

export default defineConfig({
  // Widened past ./e2e/specs so the setup project can discover e2e/auth.setup.ts;
  // the chromium project's testMatch keeps it from running that file as a spec.
  testDir: './e2e',
  // Mints E2E_RUN_ID once for the whole invocation — see e2e/run-id.ts.
  globalSetup: './e2e/global-setup.ts',
  // Not a throughput setting — a data-loss one. Every fenced test derives its
  // organization's name and slug from the same RUN_ID (e2e/run-id.ts), so with two
  // workers one test's fixture teardown would delete the organization another test is
  // actively writing into, or its create would land on the duplicate-slug branch and
  // silently adopt the other test's fence. Serial execution is what makes
  // "create, own, delete" true per test.
  workers: 1,
  fullyParallel: false,
  // A real network and a real database: one retry absorbs a cold Functions start.
  // The setup project opts out — see its `retries` below.
  retries: 1,
  // Derived from signInThroughSso's own budget rather than picked, so a later
  // change to one of its waits cannot silently outgrow this again: at 60s the
  // helper's 65s worst path was cut off mid-wait and the run reported Playwright's
  // generic timeout instead of naming an expired capture or a wrong view mode.
  //
  // The 25s on top does not cover a spec's worst case, and the arithmetic is worth
  // stating rather than implying: the `page.goto('/login')` inside signInThroughSso
  // can spend 30s by itself at Playwright's navigation default, which
  // SIGN_IN_WORST_CASE_TIMEOUT deliberately excludes (see its docblock in
  // e2e/fixtures/auth.ts), before a spec has asserted anything at all. So this is a
  // default sized for a warm run, not a ceiling above the sum of a spec's bounded
  // waits. A spec whose own waits sum past it replaces it with
  // `test.describe.configure({ timeout })` — every authenticated spec in e2e/specs (01–08)
  // now derives one and states its own arithmetic (#337, following 05/06/08), so a cold
  // start reports the message carried by the wait it interrupted rather than Playwright's
  // generic timeout. What still runs under this default is the unauthenticated 00-harness
  // smoke, whose waits fit inside it, and the setup project, whose only long wait is the
  // sign-in it performs.
  timeout: SIGN_IN_WORST_CASE_TIMEOUT + 25_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Bounds a single click or fill, so a locator that never resolves is reported
    // where it happened instead of eating the whole test budget and printing
    // Playwright's generic "Test timeout exceeded" — which named neither the
    // element nor the helper. Matched to the `expect` default because every action
    // in this suite targets UI a preceding `expect` already found: the long waits
    // (a list loading, a write landing) are explicit assertions carrying their own
    // wider budget, never an action's auto-wait.
    actionTimeout: 15_000,
  },
  projects: [
    // The guard needs the captured cookies too — it signs in for real, so a
    // project without storageState would meet a credential prompt and report a
    // dead capture that is in fact fine. Same device as the specs it gates, so it
    // cannot end up validating a browser configuration they never run under.
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
      use: { ...devices['Desktop Chrome'], storageState },
      // A precondition check, not a flaky test: a retry cannot revive an expired
      // capture, it only doubles the wall clock before the run says so.
      retries: 0,
    },
    {
      name: 'chromium',
      testMatch: /specs\/.*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], storageState },
      dependencies: ['setup'],
    },
  ],
});
