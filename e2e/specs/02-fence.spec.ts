import { sidebarNav } from '../fixtures/auth';
import { assertFenced, expect, gotoFenced, selectFencedOrg, test } from '../fixtures/fenced-org';

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

test('the suite can fence its own org and carry the fence across a navigation', async ({ page, fencedOrg }) => {
  // The fixture proves create and delete; this proves the selection. Both helpers
  // assert the fence internally, so the two calls are not a repeat: the second
  // navigates first, which is the step that drops `currentOrg`.
  await selectFencedOrg(page, fencedOrg);
  await gotoFenced(page, fencedOrg, ORG_LIST_PATH);
});

test('a bare page.goto drops the fence, and the guard refuses to write', async ({ page, fencedOrg }) => {
  // Reorder the org list so the fence is last.
  //
  // Without this the test would pass while proving nothing. `/api/organizations`
  // orders by `created_at DESC` and the fence was just created, so it arrives as
  // `orgs[0]` — exactly what `OrgSelector` auto-selects on mount. A bare `page.goto`
  // therefore lands on the fence today by accident of ordering, and `gotoFenced`
  // could be gutted to a plain `goto` without any assertion here noticing.
  //
  // Only the order of a read response changes; no write path is intercepted, and
  // the fence is still a real row that the fixture will really delete.
  await page.route('**/api/organizations', async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { organizations?: { slug: string }[] };
    // Anything that is not a list — an error payload, a shape change — is forwarded
    // untouched, so the app's own handling of it is what the assertions below see.
    // Reordering is the only thing this handler is allowed to do.
    if (!body.organizations) {
      await route.fulfill({ response });
      return;
    }
    const fenced = (org: { slug: string }) => org.slug === fencedOrg.slug;
    const reordered = [...body.organizations.filter((org) => !fenced(org)), ...body.organizations.filter(fenced)];
    await route.fulfill({ response, json: { ...body, organizations: reordered } });
  });

  await page.goto(ORG_LIST_PATH);

  // First that the trap really sprang: some *other* organization is now selected.
  // Without this the rejection below could be satisfied by an org list that never
  // arrived — the placeholder shows when nothing is selected (OrgSelector.tsx:80),
  // and a guard rejecting because the page is broken proves nothing about a guard
  // rejecting because the fence was lost.
  const selector = sidebarNav(page).getByRole('combobox');
  await expect(selector, 'OrgSelector never showed a selection, so no auto-selection happened').not.toContainText(
    'Select organization',
  );

  // Then that the guard fails closed on it, without a journey remembering to ask.
  // Asserted as a rejection rather than by reading the trigger's text: what matters
  // is that `assertFenced` refuses, not what the selector happens to show instead.
  await expect(
    assertFenced(page, fencedOrg),
    `a bare navigation left ${fencedOrg.name} looking fenced. Either OrgSelector stopped ` +
      'auto-selecting orgs[0], or this account can see no organization other than the fence — ' +
      'in which case the reordering above is a no-op and this test cannot prove anything.',
  ).rejects.toThrow(/fence not confirmed/);

  // And the fix restores it on the same page, with the same ordering still in place.
  await gotoFenced(page, fencedOrg, ORG_LIST_PATH);

  // Hand the app back its own org list before teardown: the fixture is about to
  // delete the fence for real, and cleanup should run against an uninterfered app.
  await page.unroute('**/api/organizations');
});
