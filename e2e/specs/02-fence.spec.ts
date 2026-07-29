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

/**
 * `test` comes from ../fixtures/fenced-org, which extends the session fixture with
 * `fencedOrg`: the organization every write in this run is confined to, created
 * before each body here and deleted after it — including when a body times out.
 *
 * The whole journey runs in org-admin view, including the platform-admin pages the
 * fixture creates and deletes the fence on. Two facts make one view enough:
 * `ProtectedRoute`'s `requirePlatformAdmin` check reads the raw `isPlatformAdmin`
 * (ProtectedRoute.tsx:80), not the view-scoped `effectiveIsPlatformAdmin`, so the
 * platform org pages still render here; and `OrgSelector` renders nothing at all in
 * `platform_admin` view (OrgSelector.tsx:46), so the fence could not be selected
 * from there. The `fencedOrg` fixture refuses platform view outright for that
 * reason — every write journey needs this line.
 *
 * The view is chosen through `test.use`, not by writing sessionStorage mid-test:
 * the session fixture re-seeds `viewMode` through `addInitScript`, which runs on
 * every navigation, so an in-page write is reverted by the next reload — observed
 * doing exactly that, leaving the app in platform view with no OrgSelector.
 */
test.use({ viewMode: 'org_admin' });

const ORG_LIST_PATH = '/app/admin/platform/organizations';

/** The read both tests reorder, so that being fenced has to be *chosen*. */
const ORG_LIST_ROUTE = '**/api/organizations';

/** `OrgSelector`'s text when nothing is selected at all (OrgSelector.tsx:80). */
const NO_SELECTION_PLACEHOLDER = 'Select organization';

/**
 * Move the fence to the end of the org list, and hand back the undo.
 *
 * **Without this, nothing below can catch a fence regression.** `/api/organizations`
 * orders by `created_at DESC` (functions/organizations/index.ts:33) and the fence was
 * created moments earlier, so it arrives as `orgs[0]` — which is exactly what
 * `OrgSelector` auto-selects on mount (OrgSelector.tsx:28,42). The default that the
 * fence machinery exists to override and the fence itself are then the same
 * organization, and both halves of this file lose their meaning: a bare `page.goto`
 * lands on the fence by accident of ordering, so asserting that the fence is selected
 * passes with the machinery removed, while asserting that a bare navigation *loses*
 * the fence cannot hold at all. Reordering is what separates the two — it makes the
 * fence an organization the app arrives at only by being asked to.
 *
 * Only the order of a read response changes. No write path is intercepted, and the
 * fence is still a real row that the fixture will really delete.
 *
 * The undo is returned rather than left to the end of the body: an assertion failing
 * earlier would otherwise leave the handler installed for the fixture's delete, which
 * navigates this same list twice. Harmless as this handler happens to be, "cleanup
 * runs against an uninterfered app" should be true on the failure path too, since that
 * is the path where a stranded organization would be diagnosed.
 */
async function pinFenceLast(page: Page, fence: FencedOrg): Promise<() => Promise<void>> {
  await page.route(ORG_LIST_ROUTE, async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { organizations?: { slug: string }[] };
    // Anything that is not a list — an error payload, a shape change — is forwarded
    // untouched, so the app's own handling of it is what the assertions below see.
    // Reordering is the only thing this handler is allowed to do.
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
    // Reload so the reordering is what the app boots against — the fixture loaded this
    // page before the handler existed, and `OrgSelector` picks its default on mount.
    await page.goto(ORG_LIST_PATH);
    await selectFencedOrg(page, fencedOrg);

    // The oracle, stated here rather than borrowed from the helper. `selectFencedOrg`
    // asserts internally, so without this line the call could stop selecting anything
    // and the test would still pass. Repeating the check is not redundant when the
    // thing under test is the one that would otherwise be doing the checking.
    //
    // Meaningful only because of the reordering above: it makes the fence the org the
    // app would *not* have arrived at on its own. And `assertFenced` is known not to be
    // vacuous — the next test drives it to a rejection.
    await assertFenced(page, fencedOrg);
  } finally {
    await restoreOrgListOrder();
  }
});

test('a bare page.goto drops the fence, and gotoFenced puts it back', async ({ page, fencedOrg }) => {
  const restoreOrgListOrder = await pinFenceLast(page, fencedOrg);
  try {
    await page.goto(ORG_LIST_PATH);

    // First that the trap really sprang: some *other* organization is now selected.
    // Without this the rejection below could be satisfied by an org list that never
    // arrived — the placeholder shows when nothing is selected — and a guard rejecting
    // because the page is broken proves nothing about a guard rejecting because the
    // fence was lost.
    await expect(
      orgSelector(page),
      'OrgSelector never showed a selection, so no auto-selection happened',
    ).not.toContainText(NO_SELECTION_PLACEHOLDER);

    // Then that the guard fails closed on it, without a journey remembering to ask.
    // Asserted as a rejection rather than by reading the trigger's text: what matters
    // is that `assertFenced` refuses, not what the selector happens to show instead.
    await expect(
      assertFenced(page, fencedOrg),
      `a bare navigation left ${fencedOrg.name} looking fenced. Either OrgSelector stopped ` +
        'auto-selecting orgs[0], or this account can see no organization other than the fence — ' +
        'in which case the reordering above is a no-op and neither test in this file can prove anything.',
    ).rejects.toThrow(/fence not confirmed/);

    // And that the fix restores it, on the same page, with the same ordering still in
    // place — so this is the fence being chosen, not the fence being the default.
    await gotoFenced(page, fencedOrg, ORG_LIST_PATH);
    await assertFenced(page, fencedOrg);
  } finally {
    await restoreOrgListOrder();
  }
});
