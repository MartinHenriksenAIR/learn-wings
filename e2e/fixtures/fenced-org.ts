import { expect, type Locator, type Page } from '@playwright/test';
import { orgSchema } from '../../src/lib/org-validation';
import { RUN_ID, e2eName } from '../run-id';
import { SIGN_IN_WORST_CASE_TIMEOUT, sidebarNav, signInThroughSso, type ViewMode } from './auth';
import { test as sessionTest } from './session';

export type FencedOrg = { name: string; slug: string };

const ORG_LIST_PATH = '/app/admin/platform/organizations';

const DELETE_AFFORDANCE = 'Delete organization';

const DUPLICATE_SLUG_ERROR = 'This slug is already taken';

const WRITE_TIMEOUT = 30_000;

const FENCE_CREATE_TIMEOUT = SIGN_IN_WORST_CASE_TIMEOUT + 7 * WRITE_TIMEOUT;

const FENCE_DELETE_TIMEOUT = 9 * WRITE_TIMEOUT;

function orgRow(page: Page, org: FencedOrg): Locator {
  return page.getByRole('button').filter({ hasText: org.name });
}

export function orgSelector(page: Page): Locator {
  return sidebarNav(page).getByRole('combobox');
}

function newOrgButton(page: Page): Locator {
  return page.getByRole('button', { name: 'New Organization', exact: true });
}

function createDialogErrors(page: Page): Locator {
  return page.getByRole('dialog').locator('p.text-destructive');
}

function fenceIdentity(): FencedOrg {
  const name = e2eName('org');
  return { name, slug: name.toLowerCase() };
}

function assertFenceNameIsAcceptable(org: FencedOrg): void {
  const parsed = orgSchema.safeParse(org);
  if (parsed.success) {
    return;
  }
  const problems = parsed.error.errors.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
  throw new Error(
    `RUN_ID ${JSON.stringify(RUN_ID)} does not yield a createable organization (${problems}). ` +
      'The id is minted in e2e/global-setup.ts and turned into artefact names by e2eName ' +
      '(e2e/run-id.ts); once lowercased it must satisfy ORG_SLUG_REGEX in src/lib/org-validation.ts.',
  );
}

export async function createFencedOrg(page: Page): Promise<FencedOrg> {
  const org = fenceIdentity();
  assertFenceNameIsAcceptable(org);

  await page.goto(ORG_LIST_PATH);
  await expect(newOrgButton(page)).toBeVisible({ timeout: WRITE_TIMEOUT });
  await newOrgButton(page).click();
  await page.locator('#name').fill(org.name);
  await page.locator('#slug').fill(org.slug);
  await page.getByRole('button', { name: 'Create Organization', exact: true }).click();

  const errors = createDialogErrors(page);
  const row = orgRow(page, org);
  await expect(
    errors.or(row).first(),
    `neither a row for ${org.name} nor an inline error appeared, so organization-create neither ` +
      'succeeded nor said why — check the run report for a failed request or an error toast.',
  ).toBeVisible({ timeout: WRITE_TIMEOUT });

  if (await errors.first().isVisible()) {
    const messages = (await errors.allInnerTexts()).map((text) => text.trim());
    if (!messages.includes(DUPLICATE_SLUG_ERROR)) {
      throw new Error(
        `The create dialog rejected the fence: ${messages.join(' / ')}. ` +
          'This is validation, not a write failure — nothing was created.',
      );
    }
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  }

  await expect(row, `fence ${org.name} is not in the org list, so nothing can be scoped to it`).toHaveCount(1, {
    timeout: WRITE_TIMEOUT,
  });
  return org;
}

export async function selectFencedOrg(page: Page, org: FencedOrg): Promise<void> {
  const selector = orgSelector(page);
  await expect(
    selector,
    'OrgSelector is not on screen, so the fence cannot be selected. It renders null in ' +
      'platform_admin view (OrgSelector.tsx:46) and a spinner until /api/organizations answers.',
  ).toBeVisible({ timeout: WRITE_TIMEOUT });

  await selector.click();
  await page.getByRole('option', { name: org.name, exact: true }).click();
  await assertFenced(page, org);
}

export async function gotoFenced(page: Page, org: FencedOrg, path: string): Promise<void> {
  await page.goto(path);
  await selectFencedOrg(page, org);
}

export async function assertFenced(page: Page, org: FencedOrg): Promise<void> {
  await expect(
    orgSelector(page),
    `fence not confirmed — refusing to write outside ${org.name}`,
  ).toContainText(org.name);
}

const ORG_ID_BODY_KEYS = ['orgId', 'org_id'] as const;

const API_REQUEST = /\/api\//;

const FENCE_ID_SOURCE = /\/api\/organization/;

async function installWriteFenceGuard(page: Page, org: FencedOrg): Promise<void> {
  const fence: { id: string | null } = { id: null };

  const rememberFenceId = (record: unknown): void => {
    const candidate = record as { slug?: unknown; id?: unknown } | null;
    if (candidate?.slug === org.slug && typeof candidate.id === 'string') {
      fence.id = candidate.id;
    }
  };

  page.on('response', async (response) => {
    if (!FENCE_ID_SOURCE.test(response.url())) return;
    let body: { organizations?: unknown; organization?: unknown };
    try {
      body = (await response.json()) as { organizations?: unknown; organization?: unknown };
    } catch {
      return; // not JSON (an error page, a redirect) — nothing to learn from it
    }
    if (Array.isArray(body.organizations)) {
      body.organizations.forEach(rememberFenceId);
    }
    rememberFenceId(body.organization);
  });

  await page.route(API_REQUEST, async (route) => {
    const request = route.request();
    if (request.method() === 'GET') {
      return route.fallback();
    }

    let orgId: string | undefined;
    try {
      const body = request.postDataJSON() as Record<string, unknown> | null;
      for (const key of ORG_ID_BODY_KEYS) {
        const value = body?.[key];
        if (typeof value === 'string' && value.length > 0) {
          orgId = value;
          break;
        }
      }
    } catch {
      orgId = undefined; // a body callApi did not send as JSON carries no id to act on
    }

    if (orgId && fence.id && orgId !== fence.id) {
      return route.abort('failed');
    }
    return route.fallback();
  });
}

export async function deleteFencedOrg(page: Page, org: FencedOrg): Promise<void> {
  await page.goto(ORG_LIST_PATH);
  await expect(newOrgButton(page)).toBeVisible({ timeout: WRITE_TIMEOUT });

  const row = orgRow(page, org);
  if ((await row.count()) === 0) {
    return;
  }

  await row.click();
  await expect(
    page.getByRole('heading', { level: 1, name: org.name, exact: true }).first(),
    `the open detail page is not ${org.name} — refusing to delete an organization this run does not own`,
  ).toBeVisible({ timeout: WRITE_TIMEOUT });

  await page.getByRole('button', { name: DELETE_AFFORDANCE, exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: DELETE_AFFORDANCE, exact: true }).click();

  await expect(page).toHaveURL(/\/organizations$/, { timeout: WRITE_TIMEOUT });

  await page.goto(ORG_LIST_PATH);
  await expect(newOrgButton(page)).toBeVisible({ timeout: WRITE_TIMEOUT });
  await expect(row, `fence ${org.name} outlived its run — delete it by hand`).toHaveCount(0);
}

type PendingFence = { org: FencedOrg | null };

export const test = sessionTest.extend<{ fenceDelete: PendingFence; fencedOrg: FencedOrg }>({
  fenceDelete: [
    async ({ page }, use) => {
      const pending: PendingFence = { org: null };
      try {
        await use(pending);
      } finally {
        if (pending.org) {
          await deleteFencedOrg(page, pending.org);
        }
      }
    },
    { timeout: FENCE_DELETE_TIMEOUT, title: "this run's fenced organization, removed" },
  ],
  fencedOrg: [
    async ({ page, viewMode, fenceDelete }, use) => {
      assertViewCanFence(viewMode);
      await signInThroughSso(page, viewMode);

      const org = fenceIdentity();
      fenceDelete.org = org;

      await installWriteFenceGuard(page, org);

      await createFencedOrg(page);
      await use(org);
    },
    { timeout: FENCE_CREATE_TIMEOUT, title: "this run's fenced organization" },
  ],
});

function assertViewCanFence(viewMode: ViewMode): void {
  if (viewMode === 'platform_admin') {
    throw new Error(
      'The fencedOrg fixture needs a view that renders OrgSelector, and it renders null in ' +
        "platform_admin (OrgSelector.tsx:46). Add test.use({ viewMode: 'org_admin' }) to the spec — " +
        'the platform-admin pages still render in that view.',
    );
  }
}

export { expect };
