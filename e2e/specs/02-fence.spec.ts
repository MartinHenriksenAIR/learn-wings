import { test } from '../fixtures/session';
import { signInThroughSso } from '../fixtures/auth';
import { assertFenced, createFencedOrg, deleteFencedOrg, selectFencedOrg } from '../fixtures/fenced-org';

/**
 * The whole journey runs in org-admin view, including the platform-admin pages it
 * creates and deletes the fence on.
 *
 * Two facts make one view enough. `ProtectedRoute`'s `requirePlatformAdmin` check
 * reads the raw `isPlatformAdmin` (ProtectedRoute.tsx:80), not the view-scoped
 * `effectiveIsPlatformAdmin`, so the platform org pages still render here; and
 * `OrgSelector` renders nothing at all in `platform_admin` view
 * (OrgSelector.tsx:46), so the fence could not be selected from there.
 *
 * The view is chosen through `test.use`, not by writing sessionStorage mid-test:
 * the session fixture re-seeds `viewMode` through `addInitScript`, which runs on
 * every navigation, so an in-page write is reverted by the next reload — observed
 * doing exactly that, leaving the app in platform view with no OrgSelector.
 */
test.use({ viewMode: 'org_admin' });

test('the suite can create, select and delete its own fenced org', async ({ page }) => {
  await signInThroughSso(page, 'org_admin');

  const org = await createFencedOrg(page);
  try {
    // Both helpers assert the fence internally; the second call is not a repeat.
    // It pins that the selection has to be redone after a navigation, because
    // `currentOrg` is in-memory state that no reload survives — the reason every
    // write journey must select and assert its fence after each `goto`.
    await selectFencedOrg(page, org);
    await page.goto('/app/admin/platform/organizations');
    await selectFencedOrg(page, org);
    await assertFenced(page, org);
  } finally {
    // In `finally`: a failed assertion above must still not leave a live org
    // behind. `deleteFencedOrg` confirms the org is gone from a freshly loaded
    // list, so this is the cleanup and its verification at once.
    await deleteFencedOrg(page, org);
  }
});
