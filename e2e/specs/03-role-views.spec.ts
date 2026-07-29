import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../fixtures/session';
import { sidebarNav, signInThroughSso } from '../fixtures/auth';

/**
 * These assertions cover UI gating only. This account is a platform admin, and
 * `effectiveIsOrgAdmin` is granted by `viewMode` alone with no membership row
 * (src/hooks/useAuth.tsx:99-101) — the token keeps full platform rights in every
 * view. So a green run proves the nav swaps and a view-gated route redirects; it
 * does NOT prove the API refuses a genuine org admin reaching across orgs.
 * Closing that gap needs a real org-admin account — the fuller explanation, and
 * what closing it would take, is the "Known gap: this does not prove isolation"
 * section of docs/superpowers/specs/2026-07-27-e2e-playwright-smoke-suite-design.md.
 *
 * One of the app's three route guards is not view-gated at all, and this spec must
 * not be read as covering it: `requirePlatformAdmin` tests the raw `isPlatformAdmin`
 * (ProtectedRoute.tsx:80), so this account reaches /app/admin/platform/settings from
 * learner view with the page fully rendered — verified live, not inferred, and filed
 * as **#335**, since `AppSidebar` hides those links in that view from the *effective*
 * flags (AppSidebar.tsx:193-203) while the routes behind them still render. The other
 * two guards do read the view-aware flags: `learnerOnly` reads
 * `effectiveIsPlatformAdmin` (ProtectedRoute.tsx:76), which is the guard the route
 * test below drives, and `requireOrgAdmin` reads `effectiveIsOrgAdmin` (:84) — which
 * learner view does switch off, though for a platform admin it stays on in both
 * platform and org-admin view (useAuth.tsx:99-101).
 *
 * This is the only spec that operates the switcher instead of seeding `viewMode`,
 * because the switcher is the mechanism a user actually has. It also means every
 * post-switch navigation here must be a click: a `page.goto` reboots the app and
 * the session fixture's addInitScript re-seeds `viewMode` (e2e/fixtures/session.ts),
 * silently reverting the view mid-test.
 */

/**
 * The sidebar-footer profile button that opens the view switcher.
 *
 * Matched on the role line inside it rather than the signed-in user's name, which
 * would pin the spec to one account. `exact` is deliberately absent — impossible
 * here, since the accessible name concatenates the avatar initials and full name
 * ahead of this text ("MVmartin vladinovViewing as: Platform Admin"). The
 * substring is still unambiguous, but it is the `sidebarNav` scope that makes it so
 * — not scarcity of buttons on the page. The header renders its own
 * `SidebarTrigger` button (AppLayout.tsx:62) and a chip carrying this very string
 * (AppLayout.tsx:92-94); both sit in `SidebarInset`, outside `[data-sidebar]`.
 * Within the sidebar exactly one element holds the string — the footer profile
 * button — and for a platform admin its label is present in all three views
 * (AppSidebar.tsx:167-172).
 */
function viewSwitcherTrigger(page: Page): Locator {
  return sidebarNav(page).getByRole('button', { name: 'Viewing as:' });
}

/**
 * Pick a view through the real switcher UI.
 *
 * A Radix `DropdownMenuRadioGroup` in the sidebar footer (AppSidebar.tsx:246), so
 * the trigger must be clicked before the radio item exists. `label` is a
 * `nav.roles.*` string: `Platform Admin`, `Org. Admin` (with the period) or
 * `Learner`.
 *
 * Ends on the footer label to give the caller a settled view: it re-renders from
 * the same `viewMode` state as the nav, so the caller's own locators are not
 * racing the switch. The three labels are not substrings of one another, so this
 * confirms the requested view specifically.
 */
async function switchViewTo(page: Page, label: string): Promise<void> {
  await viewSwitcherTrigger(page).click();
  await page.getByRole('menuitemradio', { name: label, exact: true }).click();
  await expect(sidebarNav(page).getByRole('button', { name: `Viewing as: ${label}` })).toBeVisible();
}

/**
 * The AppLayout header, for scoping "Viewing as:" assertions to the chip.
 *
 * The chip is the one view-gated rendering of that string — shown only outside
 * platform view (AppLayout.tsx:54) — while the sidebar footer's copy is permanent
 * for a platform admin. An unscoped `getByText(/Viewing as:/)` therefore matches
 * the footer in every view, so it can neither be absent nor identify the chip.
 * `<header>`, not `getByRole('banner')`: the sidebar's own header and footer are
 * plain divs (src/components/ui/sidebar.tsx:301,306), so this tag matches the one
 * page header and nothing else.
 */
function pageHeader(page: Page): Locator {
  return page.locator('header');
}

// Every `exact: true` below is load-bearing, not defensive: accessible names match
// as substrings by default, and `Organization` is a substring of `Organizations`,
// so the org-admin and platform-admin landmarks would each satisfy the other's view.

test('the switcher swaps the platform nav for the learner nav', async ({ page }) => {
  await signInThroughSso(page);
  const nav = sidebarNav(page);
  // No "the platform nav is up" assertion before the switch, deliberately:
  // `signInThroughSso` already waited on this exact locator — the `Organizations` link,
  // scoped to the sidebar, in the fixture's default platform view (e2e/fixtures/auth.ts)
  // — so restating it here could not fail. What this test claims is the change, and the
  // assertions after the switch are what carry it.

  await switchViewTo(page, 'Learner');

  await expect(nav.getByRole('link', { name: 'Dashboard', exact: true })).toBeVisible();
  // The negative half is what pins this to learner view. `Dashboard` is not
  // learner-exclusive — org-admin view renders the learning group too
  // (AppSidebar.tsx:193) and a learner's links are a strict subset of an org
  // admin's — so only the absence of the platform group proves the switch landed.
  await expect(nav.getByRole('link', { name: 'Platform Settings', exact: true })).toBeHidden();
  await expect(nav.getByRole('link', { name: 'Organizations', exact: true })).toBeHidden();
  await expect(pageHeader(page).getByText('Viewing as: Learner')).toBeVisible();
});

test('the switcher reaches org-admin view, which is not platform view', async ({ page }) => {
  await signInThroughSso(page);
  const nav = sidebarNav(page);

  await switchViewTo(page, 'Org. Admin');

  // `Organization` is the org-admin analytics link, rendered only while
  // `features.analytics_enabled` is on (AppSidebar.tsx:148) — on in prod today. If
  // this ever fails alone, check that flag before suspecting the switcher.
  await expect(nav.getByRole('link', { name: 'Organization', exact: true })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Organizations', exact: true })).toBeHidden();
  await expect(pageHeader(page).getByText('Viewing as: Org. Admin')).toBeVisible();
});

test('a learner-only route is refused in platform view and reached in learner view', async ({ page }) => {
  await signInThroughSso(page);

  // Platform view refuses the learner dashboard: `learnerOnly` bounces
  // `effectiveIsPlatformAdmin` to the platform home (ProtectedRoute.tsx:76-78).
  // Asserting the redirect target, not merely "not here", so a 404 or a stalled
  // boot cannot pass as a refusal — and that one assertion is the whole claim. A
  // `toBeHidden` on the learner dashboard's heading beside it could not fail once the
  // URL matched, because `<Navigate replace>` means the dashboard route never rendered.
  await page.goto('/app/dashboard');
  await expect(page).toHaveURL(/\/app\/admin\/platform\/organizations/);

  await switchViewTo(page, 'Learner');

  // Clicked, never `page.goto`: a real navigation re-seeds `viewMode` back to
  // platform_admin (see the file header), which would quietly re-run the refusal
  // above and call it a pass.
  await sidebarNav(page).getByRole('link', { name: 'Dashboard', exact: true }).click();

  await expect(page).toHaveURL(/\/app\/dashboard/);
  // The h1 is AppLayout's `title`, and it holds because of *this account*, not
  // because every fork passes one: the loaded fork passes no title and renders
  // "Welcome back, …" instead (src/pages/learner/Dashboard.tsx:153-156). That fork
  // is unreachable here — `currentOrg` starts null and loading the user context
  // skips the org auto-select for platform admins (src/hooks/useAuth.tsx:115),
  // while this read-only spec never picks one — so the page always lands on the
  // `!currentOrg` fork (Dashboard.tsx:85-88), which passes the title, as do the
  // spinner and error forks (Dashboard.tsx:79,104). So it proves the guard rendered
  // the route without depending on this account having enrollments.
  await expect(page.getByRole('heading', { name: 'My Dashboard', exact: true })).toBeVisible();
});

test('switching back to platform view restores the platform nav and drops the chip', async ({ page }) => {
  await signInThroughSso(page);
  const nav = sidebarNav(page);
  await switchViewTo(page, 'Learner');
  await expect(nav.getByRole('link', { name: 'Platform Settings', exact: true })).toBeHidden();

  await switchViewTo(page, 'Platform Admin');

  await expect(nav.getByRole('link', { name: 'Platform Settings', exact: true })).toBeVisible();
  // Anchor the negative before asserting it: `toBeHidden()` is also satisfied by an
  // element that does not exist, so a missing `<header>` or a broken `pageHeader`
  // locator would pass while proving nothing. The breadcrumb home link is
  // unconditional in that header (AppLayout.tsx:65-69), so its presence establishes
  // that the header resolved and is rendering — only then does the absence of the
  // chip mean the chip was dropped.
  const header = pageHeader(page);
  await expect(header.getByRole('link', { name: 'Home', exact: true })).toBeVisible();
  await expect(header.getByText(/Viewing as:/)).toBeHidden();
});
