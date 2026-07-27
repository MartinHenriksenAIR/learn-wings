import { defineConfig, devices } from '@playwright/test';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: '.env.e2e' });

const baseURL = process.env.E2E_BASE_URL;
if (!baseURL) {
  throw new Error('E2E_BASE_URL is not set. Copy .env.e2e.example to .env.e2e and fill it in.');
}

export default defineConfig({
  testDir: './e2e/specs',
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
