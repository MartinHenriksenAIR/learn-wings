import type { Page } from '@playwright/test';
import {
  assertFenced,
  expect,
  gotoFenced,
  orgSelector,
  selectFencedOrg,
  test,
  type FencedOrg,
} from '../fixtures/fenced-org';

test.use({ viewMode: 'org_admin' });

const COLD_START_BUDGET = 30_000;

const SPEC_TIMEOUT = 7 * COLD_START_BUDGET;

test.describe.configure({ timeout: SPEC_TIMEOUT });

const ORG_LIST_PATH = '/app/admin/platform/organizations';

const ORG_LIST_ROUTE = '**/api/organizations';

const NO_SELECTION_PLACEHOLDER = 'Select organization';

async function pinFenceLast(page: Page, fence: FencedOrg): Promise<() => Promise<void>> {
  await page.route(ORG_LIST_ROUTE, async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { organizations?: { slug: string }[] };
    if (!body.organizations) {
      await route.fulfill({ response });
      return;
    }
    const isFence = (org: { slug: string }) => org.slug === fence.slug;
    const reordered = [...body.organizations.filter((org) => !isFence(org)), ...body.organizations.filter(isFence)];
    await route.fulfill({ response, json: { ...body, organizations: reordered } });
  });

  return () => page.unroute(ORG_LIST_ROUTE);
}

test('selectFencedOrg points the app at the fence the list did not default to', async ({ page, fencedOrg }) => {
  const restoreOrgListOrder = await pinFenceLast(page, fencedOrg);
  try {
    await page.goto(ORG_LIST_PATH);
    await selectFencedOrg(page, fencedOrg);

    await assertFenced(page, fencedOrg);
  } finally {
    await restoreOrgListOrder();
  }
});

test('a bare page.goto drops the fence, and gotoFenced puts it back', async ({ page, fencedOrg }) => {
  const restoreOrgListOrder = await pinFenceLast(page, fencedOrg);
  try {
    await page.goto(ORG_LIST_PATH);

    await expect(
      orgSelector(page),
      'OrgSelector never showed a selection, so no auto-selection happened',
    ).not.toContainText(NO_SELECTION_PLACEHOLDER);

    await expect(
      assertFenced(page, fencedOrg),
      `a bare navigation left ${fencedOrg.name} looking fenced. Either OrgSelector stopped ` +
        'auto-selecting orgs[0], or this account can see no organization other than the fence — ' +
        'in which case the reordering above is a no-op and neither test in this file can prove anything.',
    ).rejects.toThrow(/fence not confirmed/);

    await gotoFenced(page, fencedOrg, ORG_LIST_PATH);
    await assertFenced(page, fencedOrg);
  } finally {
    await restoreOrgListOrder();
  }
});
