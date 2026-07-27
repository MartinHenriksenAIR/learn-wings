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
  // Writes land in one shared fenced org, so specs must not race each other.
  workers: 1,
  fullyParallel: false,
  // A real network and a real database: one retry absorbs a cold Functions start.
  // The setup project opts out — see its `retries` below.
  retries: 1,
  // Derived from signInThroughSso's own budget rather than picked, so a later
  // change to one of its waits cannot silently outgrow this again: at 60s the
  // helper's 65s worst path was cut off mid-wait and the run reported Playwright's
  // generic timeout instead of naming an expired capture or a wrong view mode. The
  // headroom covers `page.goto` plus the assertions a spec makes after signing in.
  timeout: SIGN_IN_WORST_CASE_TIMEOUT + 25_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
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
