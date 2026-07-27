import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';
import { config as loadEnv } from 'dotenv';

// dotenv resolves a relative `path` against process.cwd(), so `.env.e2e` would go
// unfound whenever Playwright is invoked from a subdirectory. Anchor it to this
// config file instead, and keep `quiet` on — dotenv v17 otherwise prints a
// promotional tip line every time the config is loaded (once per process).
const envFile = fileURLToPath(new URL('.env.e2e', import.meta.url));
const { error: envFileError } = loadEnv({ path: envFile, quiet: true });

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
  testDir: './e2e/specs',
  // Mints E2E_RUN_ID once for the whole invocation — see e2e/run-id.ts.
  globalSetup: './e2e/global-setup.ts',
  // Writes land in one shared fenced org, so specs must not race each other.
  workers: 1,
  fullyParallel: false,
  // A real network and a real database: one retry absorbs a cold Functions start.
  retries: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
