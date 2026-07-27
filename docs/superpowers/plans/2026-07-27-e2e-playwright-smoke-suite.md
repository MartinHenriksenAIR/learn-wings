# Playwright E2E Smoke Suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Playwright suite that drives the deployed app through a real Entra login against the real backend — including write journeys — runnable in one go with `npm run e2e`.

**Architecture:** A root `playwright.config.ts` with a `setup` project that performs one real interactive Entra login and saves `storageState`, and a `chromium` project that depends on it. Session state that Playwright cannot persist (MSAL tokens, `viewMode`, language) is re-seeded per page via `addInitScript`. Write journeys operate inside a fenced organization the suite creates and deletes itself.

**Tech Stack:** `@playwright/test`, TypeScript, the deployed Azure Static Web App, the production Azure Functions API.

**Spec:** `docs/superpowers/specs/2026-07-27-e2e-playwright-smoke-suite-design.md`

## Global Constraints

- **Never add this suite to `npm test` or to any CI workflow.** It is on-demand only. `npm test` must keep running exactly the 812 vitest tests it runs today.
- **`.env.e2e` is gitignored and never committed.** It holds `E2E_BASE_URL`, `E2E_USER`, `E2E_PASSWORD`, `E2E_INVITE_TO`. Never print `E2E_PASSWORD` in logs, error messages, or test titles.
- **Language is pinned to English** by seeding `localStorage.preferred_language = 'en'` before app boot in every spec. Text-based locators depend on this; without it the app renders Danish and every locator breaks. (Verified live: the app honours this key.)
- **Prefer stable locators in this order:** element `id` (`#name`, `#slug`), then `getByRole` with the English accessible name, then text. Never CSS class chains — the codebase uses generated Tailwind classes that change freely.
- **Radix components are not native HTML.** `Select` and `DropdownMenu` require clicking the trigger, then clicking an option with `role="option"` (Select) or `role="menuitemradio"` (DropdownMenu radio group). `selectOption()` does not work on them.
- **Every artefact the suite creates is named `e2e-<RUN_ID>-<kind>`** so anything left behind is identifiable. Cleanup runs in `finally`.
- **Test file naming:** `e2e/specs/NN-name.spec.ts`. Fixtures in `e2e/fixtures/`. Nothing under `src/` — the vitest `include` glob is `src/**/*.{test,spec}.{ts,tsx}` and must not pick these up.
- Node 20 (as used by the repo's other tooling).

---

### Task 1: Harness — install, configure, script

**Files:**
- Create: `playwright.config.ts`
- Create: `e2e/run-id.ts`
- Create: `e2e/specs/00-harness.spec.ts`
- Create: `.env.e2e.example`
- Modify: `package.json` (add `e2e` script + devDependency)
- Modify: `.gitignore` (add `.env.e2e`, `playwright-report/`, `test-results/`)

**Interfaces:**
- Consumes: nothing.
- Produces: `RUN_ID: string` and `e2eName(kind: string): string` from `e2e/run-id.ts`; `E2E_BASE_URL` available as `baseURL` to all specs.

- [ ] **Step 1: Install Playwright and its browser**

```bash
npm install --save-dev @playwright/test
npx playwright install chromium
```

- [ ] **Step 2: Add the run-id helper**

Create `e2e/run-id.ts`:

```ts
/**
 * One id per `npm run e2e` invocation. Every artefact the suite creates is
 * named with it, so anything a failed cleanup leaves behind is traceable to
 * the run that made it (see the spec's fencing section).
 */
export const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');

export function e2eName(kind: string): string {
  return `e2e-${RUN_ID}-${kind}`;
}
```

- [ ] **Step 3: Add the config**

Create `playwright.config.ts`:

```ts
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
```

- [ ] **Step 4: Add the env example and gitignore entries**

Create `.env.e2e.example`:

```
# Copy to .env.e2e (gitignored) and fill in. Never commit the real file.
E2E_BASE_URL=https://black-forest-0d7f96c03.7.azurestaticapps.net
E2E_USER=platform-admin@example.com
E2E_PASSWORD=
E2E_INVITE_TO=platform-admin@example.com
```

Append to `.gitignore`:

```
.env.e2e
playwright-report/
test-results/
e2e/.auth/
```

- [ ] **Step 5: Add the npm script**

In `package.json` `scripts`, add:

```json
"e2e": "playwright test",
"e2e:ui": "playwright test --ui"
```

- [ ] **Step 6: Write the harness spec**

Create `e2e/specs/00-harness.spec.ts`. This runs unauthenticated — it proves the config, baseURL and browser work before any auth complexity enters:

```ts
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
```

- [ ] **Step 7: Run it**

Run: `npm run e2e -- 00-harness`
Expected: PASS. If `E2E_BASE_URL` is missing it fails fast with the config's explicit message — that is correct behaviour, fill in `.env.e2e` and re-run.

- [ ] **Step 8: Verify vitest is untouched**

Run: `npm test`
Expected: 812 tests pass, and **no** `e2e/` files appear in the output. If any do, the vitest `include` glob is wrong — the suite must live outside `src/`.

- [ ] **Step 9: Commit**

```bash
git add playwright.config.ts e2e/ .env.e2e.example .gitignore package.json package-lock.json
git commit -m "test(e2e): Playwright harness + unauthenticated login-page smoke (#124)"
```

---

### Task 2: Real Entra login, saved once per run

**Files:**
- Create: `e2e/auth.setup.ts`
- Create: `e2e/specs/01-auth.spec.ts`
- Modify: `playwright.config.ts` (add the `setup` project and the dependency)

**Interfaces:**
- Consumes: `RUN_ID` (unused here), `baseURL`.
- Produces: a `storageState` file at `e2e/.auth/platform-admin.json`, consumed by every later spec via the project's `use.storageState`.

- [ ] **Step 1: Write the login setup**

Create `e2e/auth.setup.ts`:

```ts
import { test as setup, expect } from '@playwright/test';

const STATE_PATH = 'e2e/.auth/platform-admin.json';

setup('authenticate as platform admin', async ({ page }) => {
  const user = process.env.E2E_USER;
  const password = process.env.E2E_PASSWORD;
  if (!user || !password) {
    throw new Error('E2E_USER / E2E_PASSWORD missing from .env.e2e');
  }

  await page.addInitScript(() => {
    localStorage.setItem('preferred_language', 'en');
  });

  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in with Microsoft' }).click();

  // Microsoft's hosted form. Field names are stable across its redesigns.
  await page.waitForURL(/login\.microsoftonline\.com/);
  await page.fill('input[name="loginfmt"]', user);
  await page.getByRole('button', { name: /next/i }).click();
  await page.fill('input[name="passwd"]', password);
  await page.getByRole('button', { name: /sign in/i }).click();

  // "Stay signed in?" — answering yes keeps the SSO cookie, which is exactly
  // what later specs rely on to complete MSAL's redirect non-interactively.
  const staySignedIn = page.getByRole('button', { name: /^yes$/i });
  if (await staySignedIn.isVisible({ timeout: 10_000 }).catch(() => false)) {
    await staySignedIn.click();
  }

  // Back on our origin, authenticated.
  await page.waitForURL((url) => !url.host.includes('login.microsoftonline.com'), {
    timeout: 45_000,
  });
  await expect(page.getByRole('link', { name: 'Organizations' })).toBeVisible({ timeout: 30_000 });

  await page.context().storageState({ path: STATE_PATH });
});
```

- [ ] **Step 2: Wire the setup project**

In `playwright.config.ts`, replace the `projects` array:

```ts
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], storageState: 'e2e/.auth/platform-admin.json' },
      dependencies: ['setup'],
    },
  ],
```

Then widen `testDir` so the setup file is discoverable: change `testDir: './e2e/specs'` to `testDir: './e2e'`. The `setup` project's `testMatch` picks up `auth.setup.ts`, and the `chromium` project needs its own `testMatch: /specs\/.*\.spec\.ts/` so it does not also try to run the setup file as a spec.

- [ ] **Step 3: Write the authenticated smoke**

Create `e2e/specs/01-auth.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('preferred_language', 'en');
    sessionStorage.setItem('viewMode', 'platform_admin');
  });
});

test('saved session lands on the platform-admin surface', async ({ page }) => {
  await page.goto('/');

  // MSAL re-acquires tokens into sessionStorage using the Entra SSO cookie from
  // the saved state; assert on something only an authenticated platform admin sees.
  await expect(page.getByRole('link', { name: 'Organizations' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Platform Settings' })).toBeVisible();
  await expect(page).not.toHaveURL(/\/login/);
});

test('a deep link survives the authenticated load', async ({ page }) => {
  await page.goto('/app/admin/platform/courses');

  await expect(page).toHaveURL(/\/app\/admin\/platform\/courses/);
  await expect(page.getByRole('heading', { name: 'Course Manager' })).toBeVisible();
});
```

- [ ] **Step 4: Run it**

Run: `npm run e2e -- 01-auth`
Expected: the setup project logs in (a browser window drives the Microsoft form), then both tests PASS.

If it fails at the Microsoft form with an MFA or "approve sign-in request" prompt, the account cannot be automated. Stop and report — the fallback in the spec is a manual login whose state is reused, which changes this task's approach and needs a decision.

- [ ] **Step 5: Confirm the session is actually reused, not re-logged-in**

Run: `npm run e2e -- 01-auth` a second time and watch the output.
Expected: the `setup` project runs again (it is not cached) but the *specs* never show a Microsoft form. If a spec redirects to `/login`, the storageState is not carrying the session — re-read the spec's auth section before proceeding.

- [ ] **Step 6: Commit**

```bash
git add e2e/auth.setup.ts e2e/specs/01-auth.spec.ts playwright.config.ts
git commit -m "test(e2e): real Entra login saved once per run (#124)"
```

---

### Task 3: Session-seeding fixture

**Files:**
- Create: `e2e/fixtures/session.ts`
- Modify: `e2e/specs/01-auth.spec.ts` (use the fixture instead of an inline `beforeEach`)

**Interfaces:**
- Consumes: nothing beyond Playwright.
- Produces: `export const test` — a Playwright `test` extended with an options-driven `session` fixture, plus `type ViewMode = 'platform_admin' | 'org_admin' | 'learner'` and `seedSession(page: Page, opts: { viewMode?: ViewMode; language?: 'en' | 'da' }): Promise<void>`. Later tasks import `test` and `expect` from **this** module, not from `@playwright/test`.

- [ ] **Step 1: Write the fixture**

Create `e2e/fixtures/session.ts`:

```ts
import { test as base, expect, type Page } from '@playwright/test';

export type ViewMode = 'platform_admin' | 'org_admin' | 'learner';

/**
 * Re-seed the parts of the session Playwright's storageState cannot carry.
 *
 * MSAL caches tokens in sessionStorage and `viewMode` lives there too
 * (src/hooks/useAuth.tsx:53), and storageState persists only cookies +
 * localStorage. The Entra SSO cookie in the saved state is what lets MSAL
 * complete its redirect silently; viewMode and the language preference have to
 * be written before app boot, which is what addInitScript guarantees.
 */
export async function seedSession(
  page: Page,
  opts: { viewMode?: ViewMode; language?: 'en' | 'da' } = {},
): Promise<void> {
  const viewMode = opts.viewMode ?? 'platform_admin';
  const language = opts.language ?? 'en';
  await page.addInitScript(
    ([mode, lang]) => {
      localStorage.setItem('preferred_language', lang);
      sessionStorage.setItem('viewMode', mode);
    },
    [viewMode, language] as const,
  );
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
```

- [ ] **Step 2: Switch the auth spec to the fixture**

In `e2e/specs/01-auth.spec.ts`, replace the import and delete the `beforeEach`:

```ts
import { test, expect } from '../fixtures/session';
```

- [ ] **Step 3: Run**

Run: `npm run e2e -- 01-auth`
Expected: both tests still PASS, with no `beforeEach` in the file.

- [ ] **Step 4: Commit**

```bash
git add e2e/fixtures/session.ts e2e/specs/01-auth.spec.ts
git commit -m "test(e2e): session-seeding fixture for viewMode + language (#124)"
```

---

### Task 4: Fenced-org fixture

**Files:**
- Create: `e2e/fixtures/fenced-org.ts`
- Create: `e2e/specs/02-fence.spec.ts`

**Interfaces:**
- Consumes: `e2eName` from `e2e/run-id.ts`; `test`/`expect` from `e2e/fixtures/session`.
- Produces:
  - `type FencedOrg = { name: string; slug: string }`
  - `createFencedOrg(page: Page): Promise<FencedOrg>` — creates via the platform-admin UI, returns its identity.
  - `selectFencedOrg(page: Page, org: FencedOrg): Promise<void>` — picks it in `OrgSelector`; requires a non-platform viewMode.
  - `assertFenced(page: Page, org: FencedOrg): Promise<void>` — throws unless the selector currently shows `org`.
  - `deleteFencedOrg(page: Page, org: FencedOrg): Promise<void>`

- [ ] **Step 1: Capture the delete-org locators from the live app**

The create dialog's inputs have stable ids (`#name`, `#slug`, `#seatLimit`) and its submit button is `Create Organization`. The **delete** affordance on the org-detail page has not been read yet, so capture it rather than guess:

```bash
npx playwright codegen --load-storage=e2e/.auth/platform-admin.json "$E2E_BASE_URL/app/admin/platform/organizations"
```

Click into an org, find the delete control, and note: the accessible name of the delete button, whether a confirm dialog appears, and the accessible name of its confirm button. Use those exact names in Step 2 in place of the three marked constants.

- [ ] **Step 2: Write the fixture**

Create `e2e/fixtures/fenced-org.ts`:

```ts
import { expect, type Page } from '@playwright/test';
import { e2eName } from '../run-id';

export type FencedOrg = { name: string; slug: string };

// Captured in Step 1 against the live app.
const DELETE_BUTTON = 'Delete organization';
const DELETE_CONFIRM = 'Delete';

/**
 * Create the organization this run's writes are confined to.
 *
 * The suite owns its fence rather than borrowing an existing org: write
 * journeys must assert on artefacts they created, or they inherit
 * depends-on-uncontrolled-state flakiness. organization-create is
 * requirePlatformAdmin, so no prod DML or seed script is needed.
 */
export async function createFencedOrg(page: Page): Promise<FencedOrg> {
  const name = e2eName('org');
  const slug = name.toLowerCase();

  await page.goto('/app/admin/platform/organizations');
  await page.getByRole('button', { name: 'New Organization' }).click();
  await page.locator('#name').fill(name);
  await page.locator('#slug').fill(slug);
  await page.getByRole('button', { name: 'Create Organization' }).click();

  await expect(page.getByText(name)).toBeVisible();
  return { name, slug };
}

/**
 * OrgSelector auto-selects orgs[0] when a platform admin enters a non-platform
 * view (src/components/OrgSelector.tsx:28,42) — never rely on that default.
 * It is a Radix Select, so the trigger must be clicked before the option.
 */
export async function selectFencedOrg(page: Page, org: FencedOrg): Promise<void> {
  await page.getByRole('combobox').first().click();
  await page.getByRole('option', { name: org.name }).click();
  await assertFenced(page, org);
}

/** Hard stop: a spec that cannot confirm its fence must not write. */
export async function assertFenced(page: Page, org: FencedOrg): Promise<void> {
  await expect(
    page.getByRole('combobox'),
    `fence not confirmed — refusing to write outside ${org.name}`,
  ).toContainText(org.name);
}

export async function deleteFencedOrg(page: Page, org: FencedOrg): Promise<void> {
  await page.goto('/app/admin/platform/organizations');
  await page.getByRole('link', { name: org.name }).click();
  await page.getByRole('button', { name: DELETE_BUTTON }).click();
  await page.getByRole('button', { name: DELETE_CONFIRM }).click();
  await expect(page.getByText(org.name)).toBeHidden();
}
```

- [ ] **Step 3: Write the fence self-test**

Create `e2e/specs/02-fence.spec.ts`:

```ts
import { test, expect } from '../fixtures/session';
import { createFencedOrg, deleteFencedOrg, selectFencedOrg } from '../fixtures/fenced-org';

test('the suite can create, select and delete its own fenced org', async ({ page }) => {
  const org = await createFencedOrg(page);
  try {
    await expect(page.getByText(org.name)).toBeVisible();

    // Selecting requires a non-platform view: OrgSelector renders null in
    // platform_admin mode (OrgSelector.tsx:46).
    await page.evaluate(() => sessionStorage.setItem('viewMode', 'org_admin'));
    await page.reload();
    await selectFencedOrg(page, org);
  } finally {
    await page.evaluate(() => sessionStorage.setItem('viewMode', 'platform_admin'));
    await deleteFencedOrg(page, org);
  }
});
```

- [ ] **Step 4: Run**

Run: `npm run e2e -- 02-fence`
Expected: PASS. If `selectFencedOrg`'s combobox locator matches more than one element, narrow it using the accessible name you observed in Step 1 and re-run.

- [ ] **Step 5: Prove the guard actually guards**

Temporarily change `assertFenced`'s expectation to a name that does not exist (`'not-the-fence'`), re-run `npm run e2e -- 02-fence`, and confirm it **FAILS** with the "fence not confirmed" message. Then revert the change.

This is the one mechanism protecting write journeys from the `orgs[0]` default. A guard that has never been seen to fail is not a guard.

- [ ] **Step 6: Verify no debris**

Load the organizations list in a browser and confirm no `e2e-` organizations remain.

- [ ] **Step 7: Commit**

```bash
git add e2e/fixtures/fenced-org.ts e2e/specs/02-fence.spec.ts
git commit -m "test(e2e): fenced-org fixture with a proven write guard (#124)"
```

---

### Task 5: Journey — role views through the real switcher

**Files:**
- Create: `e2e/specs/03-role-views.spec.ts`

**Interfaces:**
- Consumes: `test`/`expect` from `e2e/fixtures/session`.
- Produces: nothing consumed later.

- [ ] **Step 1: Write the spec**

This is the one spec that drives the switcher UI rather than seeding `viewMode`, because the switcher is the mechanism a user actually uses. Labels come from `nav.roles.*`: `Platform Admin`, `Org. Admin`, `Learner` (note the period in `Org. Admin`).

Create `e2e/specs/03-role-views.spec.ts`:

```ts
import { test, expect } from '../fixtures/session';

async function switchViewTo(page: import('@playwright/test').Page, label: string) {
  // The switcher lives in the sidebar footer profile menu (AppSidebar.tsx:246),
  // a Radix DropdownMenu radio group — trigger first, then the radio item.
  await page.getByRole('button', { name: /viewing as|platform admin/i }).last().click();
  await page.getByRole('menuitemradio', { name: label }).click();
}

test('switching to learner view drops the admin nav and shows the viewing-as chip', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Organizations' })).toBeVisible();

  await switchViewTo(page, 'Learner');

  await expect(page.getByText('Viewing as: Learner')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Platform Settings' })).toBeHidden();
});

test('learner view cannot reach a platform-admin route', async ({ page }) => {
  await page.goto('/');
  await switchViewTo(page, 'Learner');

  await page.goto('/app/admin/platform/settings');

  // ProtectedRoute requirePlatformAdmin must redirect away, not render the page.
  await expect(page.getByRole('heading', { name: 'Platform Settings' })).toBeHidden();
  await expect(page).not.toHaveURL(/\/app\/admin\/platform\/settings/);
});

test('returning to platform view restores the full nav', async ({ page }) => {
  await page.goto('/');
  await switchViewTo(page, 'Learner');
  await expect(page.getByRole('link', { name: 'Platform Settings' })).toBeHidden();

  await switchViewTo(page, 'Platform Admin');

  await expect(page.getByRole('link', { name: 'Platform Settings' })).toBeVisible();
  await expect(page.getByText(/Viewing as:/)).toBeHidden();
});
```

- [ ] **Step 2: Run and correct the trigger locator**

Run: `npm run e2e -- 03-role-views`

The switcher trigger's accessible name is built from the profile button in `AppSidebar.tsx` and was not read exactly. If the locator misses, capture the real name:

```bash
npx playwright codegen --load-storage=e2e/.auth/platform-admin.json "$E2E_BASE_URL/"
```

Click the sidebar-footer profile button, take the emitted locator, and replace the one in `switchViewTo`.

Expected once corrected: all three PASS.

- [ ] **Step 3: Add the honesty comment**

At the top of the file, add:

```ts
/**
 * These assertions cover UI gating only. This account is a platform admin, and
 * effectiveIsOrgAdmin is granted by viewMode alone with no membership row
 * (src/hooks/useAuth.tsx:99-101) — the token keeps full platform rights in every
 * view. So a green run proves the nav hides and routes redirect; it does NOT
 * prove the API refuses a genuine org admin reaching across orgs. Closing that
 * gap needs a real org-admin account (see the spec's "Known gap").
 */
```

- [ ] **Step 4: Commit**

```bash
git add e2e/specs/03-role-views.spec.ts
git commit -m "test(e2e): role-view switcher and UI gating journey (#124)"
```

---

### Task 6: Journey — platform-admin course lifecycle

**Files:**
- Create: `e2e/fixtures/course.ts`
- Create: `e2e/specs/04-course-lifecycle.spec.ts`

**Interfaces:**
- Consumes: `e2eName`, `createFencedOrg`/`deleteFencedOrg`, `test`/`expect`.
- Produces: `createCourse(page: Page, opts: { title: string }): Promise<{ title: string }>` and `deleteCourse(page: Page, title: string): Promise<void>` from `e2e/fixtures/course.ts` — Task 7 consumes both.

- [ ] **Step 1: Capture the course-manager locators**

The course create/edit flow was not read in detail. Capture it:

```bash
npx playwright codegen --load-storage=e2e/.auth/platform-admin.json "$E2E_BASE_URL/app/admin/platform/courses"
```

Note exactly: the create-course button's accessible name, the title field's id or label, the save control (`courseEditor.saveChanges` = `Save changes`), and the delete control plus its confirm.

- [ ] **Step 2: Write the course fixture**

Create `e2e/fixtures/course.ts` using the names captured in Step 1:

```ts
import { expect, type Page } from '@playwright/test';

export async function createCourse(page: Page, opts: { title: string }): Promise<{ title: string }> {
  await page.goto('/app/admin/platform/courses');
  await page.getByRole('button', { name: 'New Course' }).click();
  await page.getByLabel('Title').fill(opts.title);
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Saved')).toBeVisible();
  return { title: opts.title };
}

export async function deleteCourse(page: Page, title: string): Promise<void> {
  await page.goto('/app/admin/platform/courses');
  await page.getByRole('row', { name: new RegExp(title) }).getByRole('button', { name: /delete/i }).click();
  await page.getByRole('button', { name: /^delete$/i }).click();
  await expect(page.getByText(title)).toBeHidden();
}
```

- [ ] **Step 3: Write the lifecycle spec**

Create `e2e/specs/04-course-lifecycle.spec.ts`:

```ts
import { test, expect } from '../fixtures/session';
import { createFencedOrg, deleteFencedOrg, type FencedOrg } from '../fixtures/fenced-org';
import { createCourse, deleteCourse } from '../fixtures/course';
import { e2eName } from '../run-id';

test('a course can be created, edited, found and deleted', async ({ page }) => {
  let org: FencedOrg | undefined;
  const title = e2eName('course');
  const editedTitle = `${title}-edited`;

  try {
    org = await createFencedOrg(page);

    await createCourse(page, { title });
    await expect(page.getByText(title)).toBeVisible();

    await page.getByRole('link', { name: title }).click();
    await page.getByLabel('Title').fill(editedTitle);
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Saved')).toBeVisible();

    await page.goto('/app/admin/platform/courses');
    await expect(page.getByText(editedTitle)).toBeVisible();

    await deleteCourse(page, editedTitle);
    await expect(page.getByText(editedTitle)).toBeHidden();
  } finally {
    if (org) await deleteFencedOrg(page, org);
  }
});
```

- [ ] **Step 4: Run**

Run: `npm run e2e -- 04-course-lifecycle`
Expected: PASS. Correct any locator that misses using the names captured in Step 1.

- [ ] **Step 5: Verify no debris**

Confirm no `e2e-` course or organization remains in the UI.

- [ ] **Step 6: Commit**

```bash
git add e2e/fixtures/course.ts e2e/specs/04-course-lifecycle.spec.ts
git commit -m "test(e2e): platform-admin course create/edit/delete journey (#124)"
```

---

### Task 7: Journey — learner course progress

**Files:**
- Create: `e2e/specs/05-learner-course.spec.ts`

**Interfaces:**
- Consumes: `test`/`expect` from `e2e/fixtures/session`. Branch 2a drives whichever course the learner surface already exposes, so it consumes no course fixture; branch 2b drives empty states only. Step 1 decides which.
- Produces: nothing consumed later.

- [ ] **Step 1: Write the spec**

The account owner confirmed (2026-07-27) that in **learner view this account can open and work through the "AI Fundamentals" course**. So this journey drives that course by name — there is no empty-surface branch and no skipped test.

Drive it **by name, never "the first course in the list"**: a positional locator would silently pass against whatever else the list happened to contain, which is the vacuous-green failure mode.

Create `e2e/specs/05-learner-course.spec.ts`:

```ts
import { test, expect } from '../fixtures/session';

test.use({ viewMode: 'learner' });

const COURSE = 'AI Fundamentals';

test('a lesson can be opened and its progress survives a reload', async ({ page }) => {
  await page.goto('/app/courses');

  // Named, not positional: if this course is absent the failure says so, rather
  // than the test quietly driving some other course.
  const course = page.getByRole('link', { name: new RegExp(COURSE, 'i') });
  await expect(
    course,
    `expected the "${COURSE}" course on the learner course list — the journey drives it by name`,
  ).toBeVisible();
  await course.click();

  // Complete a lesson, then prove the progress was persisted server-side rather
  // than only held in local component state.
  await page.getByRole('button', { name: /mark as complete|complete/i }).first().click();
  await expect(page.getByText(/complete/i).first()).toBeVisible();

  await page.reload();
  await expect(page.getByText(/complete/i).first()).toBeVisible();
});
```

- [ ] **Step 2: Run**

Run: `npm run e2e -- 05-learner-course`
Expected: PASS.

The completion control's exact accessible name was not read from source. If the locator misses, capture the real one rather than widening the regex:

```bash
npx playwright codegen --load-storage=e2e/.auth/platform-admin.json "$E2E_BASE_URL/app/courses"
```

Switch to learner view, open **AI Fundamentals**, and record the completion control's accessible name and the text that marks a lesson complete.

Note the progress this writes belongs to the account's own enrollment in a pre-existing course, so it is **not** removed by the fenced-org teardown. That is accepted: the journey re-completing an already-complete lesson on a later run is idempotent. If the lesson turns out not to be re-completable, report it rather than resetting anything.

- [ ] **Step 4: Commit**

```bash
git add e2e/specs/05-learner-course.spec.ts
git commit -m "test(e2e): learner course journey (#124)"
```

---

### Task 8: Journey — org-admin members, invite through revoke

**Files:**
- Create: `e2e/specs/06-org-members.spec.ts`

**Interfaces:**
- Consumes: `createFencedOrg`/`selectFencedOrg`/`assertFenced`/`deleteFencedOrg`, `test`/`expect`.
- Produces: nothing consumed later.

- [ ] **Step 1: Write the spec**

This journey **sends real email** through Resend to `E2E_INVITE_TO` (the account owner's own address, by their decision). It is also the journey where the fence matters most, since it writes org-scoped rows.

Create `e2e/specs/06-org-members.spec.ts`:

```ts
import { test, expect } from '../fixtures/session';
import {
  assertFenced,
  createFencedOrg,
  deleteFencedOrg,
  selectFencedOrg,
  type FencedOrg,
} from '../fixtures/fenced-org';

test.use({ viewMode: 'org_admin' });

test('an invitation can be sent, seen as pending, and revoked', async ({ page }) => {
  const inviteTo = process.env.E2E_INVITE_TO;
  if (!inviteTo) throw new Error('E2E_INVITE_TO missing from .env.e2e');

  let org: FencedOrg | undefined;
  try {
    // Create the fence from the platform view, then return to org-admin view.
    await page.evaluate(() => sessionStorage.setItem('viewMode', 'platform_admin'));
    org = await createFencedOrg(page);
    await page.evaluate(() => sessionStorage.setItem('viewMode', 'org_admin'));
    await page.reload();

    await selectFencedOrg(page, org);
    await assertFenced(page, org);

    await page.getByRole('button', { name: 'Invite Member' }).click();
    await page.getByLabel(/email/i).fill(inviteTo);
    await page.getByRole('button', { name: /send|invite/i }).last().click();

    await expect(page.getByText('Pending invitations')).toBeVisible();
    await expect(page.getByText(inviteTo)).toBeVisible();

    await page.getByRole('row', { name: new RegExp(inviteTo) })
      .getByRole('button', { name: 'Revoke' })
      .click();
    await expect(page.getByText(inviteTo)).toBeHidden();
  } finally {
    if (org) {
      await page.evaluate(() => sessionStorage.setItem('viewMode', 'platform_admin'));
      await deleteFencedOrg(page, org);
    }
  }
});
```

- [ ] **Step 2: Run**

Run: `npm run e2e -- 06-org-members`
Expected: PASS, and one e2e invitation arrives at `E2E_INVITE_TO`.

The invite dialog's field and submit labels were not read exactly — if a locator misses, capture the real ones:

```bash
npx playwright codegen --load-storage=e2e/.auth/platform-admin.json "$E2E_BASE_URL/app/admin/org"
```

- [ ] **Step 3: Confirm the mail arrived and reads correctly**

Check the inbox. The mail must name the fenced org (`e2e-…-org`) — **not** the literal string `null`, which was the #309 bug — and must be in the recipient's language.

- [ ] **Step 4: Commit**

```bash
git add e2e/specs/06-org-members.spec.ts
git commit -m "test(e2e): org-admin invitation lifecycle journey (#124)"
```

---

### Task 9: Journey — quiz surface and compliance PDF

**Files:**
- Create: `e2e/specs/07-quiz-compliance-pdf.spec.ts`

**Interfaces:**
- Consumes: `test`/`expect`.
- Produces: nothing consumed later.

- [ ] **Step 1: Locate the quiz lesson inside AI Fundamentals, and the compliance-PDF trigger**

The quiz is reached by **navigating into the "AI Fundamentals" course the same way Task 7 does** — not via a captured raw URL and not via an env var. An env-var URL with a fallback was the original plan and was wrong: a missing value would have let this test pass while looking at the course list, never seeing a quiz.

```bash
npx playwright codegen --load-storage=e2e/.auth/platform-admin.json "$E2E_BASE_URL/app/courses"
```

Record: how a quiz lesson is reached from inside AI Fundamentals (its lesson-list entry name), and the compliance-report download control's accessible name.

If AI Fundamentals contains **no** quiz lesson, do not substitute another course silently and do not skip the test — report it to the controller, who will resolve which course to use.

- [ ] **Step 2: Write the spec**

Create `e2e/specs/07-quiz-compliance-pdf.spec.ts`. Note the copy is the exact English string shipped by #299 (`coursePlayer.quizNotReady`):

```ts
import { test, expect } from '../fixtures/session';

test.use({ viewMode: 'learner' });

const COURSE = 'AI Fundamentals';

test('a quiz lesson is never a dead end', async ({ page }) => {
  await page.goto('/app/courses');

  const course = page.getByRole('link', { name: new RegExp(COURSE, 'i') });
  await expect(course, `expected the "${COURSE}" course to reach its quiz lesson`).toBeVisible();
  await course.click();

  // Open the quiz lesson by the name captured in Step 1. No fallback: if it is
  // not here the test must fail, not quietly assert against another page.
  await page.getByRole('button', { name: QUIZ_LESSON_NAME }).click();

  const working = page.getByRole('button', { name: /submit/i });
  const notReady = page.getByText("This quiz isn't ready yet");
  await expect(working.or(notReady)).toBeVisible();

  // The durable #299 fix: some way forward always exists.
  await expect(
    page.getByRole('button', { name: /next|previous/i }).first(),
  ).toBeVisible();
});

test('the compliance PDF downloads and is a real PDF', async ({ page }) => {
  await page.goto('/app/admin/platform/analytics');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /compliance|report/i }).first().click(),
  ]);

  const path = await download.path();
  expect(path).toBeTruthy();

  const fs = await import('node:fs/promises');
  const head = (await fs.readFile(path!)).subarray(0, 5).toString('latin1');
  // A structurally valid PDF starts with %PDF-; #273 shipped a byte-correct xref.
  expect(head).toBe('%PDF-');
});
```

- [ ] **Step 3: Declare the captured lesson name as a constant**

At the top of the spec, next to `COURSE`, add the lesson name recorded in Step 1:

```ts
const QUIZ_LESSON_NAME = /* exact accessible name captured in Step 1 */ '';
```

Replace the empty string with the real value. Do **not** leave it empty and do not add a fallback — the test must fail loudly if the quiz lesson cannot be reached.

- [ ] **Step 4: Run**

Run: `npm run e2e -- 07-quiz-compliance-pdf`
Expected: both PASS. If AI Fundamentals has no quiz lesson, stop and report to the controller — do not skip the test and do not silently switch courses.

- [ ] **Step 5: Commit**

```bash
git add e2e/specs/07-quiz-compliance-pdf.spec.ts
git commit -m "test(e2e): quiz-surface and compliance-PDF journey (#124)"
```

---

### Task 10: Full-suite run, docs, bookkeeping

**Files:**
- Create: `e2e/README.md`
- Modify: `AGENTS.md` (one line under Verification gates noting the suite is on-demand, not a gate)
- Modify: `migration/WORKLOG.md` (append entry)
- Modify: `migration/STATUS.html` (checkpoint: #124 moves to closed)

- [ ] **Step 1: Run the whole suite twice in a row**

```bash
npm run e2e
npm run e2e
```

Expected: both runs exit 0. The second run passing is what proves cleanup worked — the first run's fenced orgs and courses must not interfere.

- [ ] **Step 2: Confirm the app is clean**

In the browser, confirm zero `e2e-` organizations and zero `e2e-` courses remain.

- [ ] **Step 3: Re-run the repo's own gates**

```bash
npm run lint
npx tsc --noEmit -p tsconfig.app.json
npm test
npm run build
```

Expected: all exit 0, and `npm test` still reports 812 tests with no `e2e/` files. `tsconfig.app.json` may need `e2e` added to its `exclude` if it starts type-checking the specs — if so, add it rather than loosening any compiler option.

- [ ] **Step 3b: Give `e2e/` type-check coverage**

Task 1's review established that `e2e/` is type-checked by **nothing**: `tsconfig.app.json` includes only `src`, and Playwright's runner transpiles without checking types. That was acceptable for 23 hand-verified lines; it must not outlive this plan now that the suite has real volume.

Add `e2e` and `playwright.config.ts` to the `include` array in `tsconfig.node.json` — that config is off the build path, so the specs get checked without touching what ships. Then run:

```bash
npx tsc --noEmit -p tsconfig.node.json
```

Expected: exit 0. Fix any error it surfaces by correcting the types, never by adding `any` or loosening a compiler option.

- [ ] **Step 4: Write `e2e/README.md`**

Cover, in prose: what the suite is, that it is on-demand and deliberately not a CI gate, how to fill `.env.e2e`, the MFA constraint on the account, that journey 06 sends real mail to `E2E_INVITE_TO`, that writes are confined to a self-created fenced org, and the known gap that a green run proves UI gating rather than API refusal.

- [ ] **Step 5: Add the AGENTS.md line**

Under "Verification gates", add:

```markdown
- `npm run e2e` — Playwright end-to-end suite against the **deployed** app with a real Entra login and real writes. **On-demand only; deliberately not a CI gate and not part of `npm test`.** See `e2e/README.md`.
```

- [ ] **Step 6: Append the WORKLOG entry and move the STATUS checkpoint**

WORKLOG: a dated entry covering the rescope of #124, the three session/DOM findings, what the suite does and does not prove, and the two-consecutive-runs verification. STATUS: remove #124 from the open backlog list and add it to "Closed since the last checkpoint".

- [ ] **Step 7: Commit and open for review**

```bash
git add e2e/README.md AGENTS.md migration/WORKLOG.md migration/STATUS.html
git commit -m "docs(e2e): README, gate note, WORKLOG + STATUS checkpoint (#124)"
git push
```

Then mark PR #316 ready for review.

---

## Notes for the implementer

- **Locator misses are expected, not failures of the plan.** Five flows were read directly from source (login button, view switcher, org-create dialog, invite button, quiz copy); the rest carry an explicit codegen capture step. Use it — do not guess a locator and leave it failing.
- **Never widen a timeout to make a flake pass.** If something is racy, await the condition being asserted, not a weaker proxy. That was the whole substance of #305.
- **If the account hits MFA**, stop at Task 2 and report. Every later task depends on that login working unattended.
- **The fence guard in Task 4 Step 5 is not optional.** It is the only thing standing between a mis-selected org and unintended writes once real customer orgs exist after the #115 cutover.
