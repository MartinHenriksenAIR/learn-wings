import { expect, type Locator, type Page } from '@playwright/test';
import { e2eName } from '../run-id';
import { sidebarNav } from './auth';

export type FencedOrg = { name: string; slug: string };

const ORG_LIST_PATH = '/app/admin/platform/organizations';

/**
 * The accessible name shared by the delete trigger and its confirm button.
 *
 * Captured against the live app: the icon button in `OrgDetailHeader` carries
 * `aria-label="Delete organization"` and the AlertDialog's action button renders
 * the same string (both from `orgDetail.deleteOrganization`). `exact: true` keeps
 * either of them apart from the dialog's own title, "Delete Organization?" —
 * accessible names match as case-insensitive substrings by default.
 */
const DELETE_AFFORDANCE = 'Delete organization';

/** The inline slug error `organization-create` triggers on a duplicate slug. */
const DUPLICATE_SLUG_ERROR = 'This slug is already taken';

/**
 * Budget for one write to land: an Azure Functions call plus the list refetch it
 * invalidates. Wider than the config's 15s `expect` default, which was sized for
 * assertions on already-rendered state — a cold function start alone can eat it.
 */
const WRITE_TIMEOUT = 30_000;

/**
 * The org list's row for `org`.
 *
 * A `<button>`, not a link: `OrganizationsManager` renders each row as a button
 * that calls `navigate()` (OrganizationsManager.tsx:433-436). Its accessible name
 * concatenates every cell — name, slug, members, seats, created date — so
 * `getByRole('button', { name })` could only match with a substring, which this
 * tree bans. `filter({ hasText })` says the same thing honestly: match the row
 * that contains this text. The name carries RUN_ID, so at most one row can.
 */
function orgRow(page: Page, org: FencedOrg): Locator {
  return page.getByRole('button').filter({ hasText: org.name });
}

/**
 * `OrgSelector`'s Radix `Select` trigger, in the sidebar.
 *
 * Scoped to the sidebar rather than taken as the page's first combobox: page
 * content elsewhere in the app renders Radix selects too, and `.first()` would
 * silently prefer whichever mounted earlier in the DOM.
 */
function orgSelector(page: Page): Locator {
  return sidebarNav(page).getByRole('combobox');
}

/**
 * The create-dialog trigger, which doubles as the org list's loaded signal.
 *
 * `OrganizationsManager` returns a bare `PageSpinner` while `useOrganizations` is
 * loading (OrganizationsManager.tsx:243-249), so this button existing is what
 * separates "the list is loaded and the org is absent" from "the list has not
 * arrived yet" — the distinction the idempotency checks below turn on. Counting
 * rows during the spinner would read 0 and conclude the wrong thing.
 */
function newOrgButton(page: Page): Locator {
  return page.getByRole('button', { name: 'New Organization', exact: true });
}

/**
 * Create the organization this run's writes are confined to.
 *
 * The suite owns its fence rather than borrowing an existing org: write journeys
 * must assert on artefacts they created, or they inherit depends-on-uncontrolled-
 * state flakiness. `organization-create` is requirePlatformAdmin, so no prod DML
 * or seed script is needed.
 *
 * Safe to run twice for the same RUN_ID. `playwright.config.ts` sets
 * `retries: 1` and `e2eName` is stable across a retry, so the second attempt
 * submits a slug the first attempt already created; that path is handled below
 * rather than left to fail the retry it exists to serve.
 */
export async function createFencedOrg(page: Page): Promise<FencedOrg> {
  const name = e2eName('org');
  // The form derives the slug from the name with the same transform
  // (OrganizationsManager.tsx:236-240), so this only restates what typing the
  // name already produced — but it is what makes the slug a value this fixture
  // knows, rather than one inferred from a component's effect.
  const org: FencedOrg = { name, slug: name.toLowerCase() };

  await page.goto(ORG_LIST_PATH);
  await newOrgButton(page).click();
  await page.locator('#name').fill(org.name);
  await page.locator('#slug').fill(org.slug);
  await page.getByRole('button', { name: 'Create Organization', exact: true }).click();

  // One wait for either outcome. On a duplicate slug the dialog stays open with
  // an inline error, and an open Radix dialog marks the rest of the page
  // aria-hidden — which takes every list row out of the accessibility tree that
  // role locators read, so the row can only be looked for once it is closed.
  const duplicate = page.getByText(DUPLICATE_SLUG_ERROR, { exact: true });
  const row = orgRow(page, org);
  await expect(duplicate.or(row).first()).toBeVisible({ timeout: WRITE_TIMEOUT });

  // Which one arrived decides whether this attempt created the fence or found it
  // already there; both leave the same state behind. isVisible() is a decision,
  // not a wait — one of the two is already known visible.
  if (await duplicate.isVisible()) {
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  }

  await expect(row, `fence ${org.name} is not in the org list, so nothing can be scoped to it`).toHaveCount(1, {
    timeout: WRITE_TIMEOUT,
  });
  return org;
}

/**
 * Point `OrgSelector` at the fence.
 *
 * Requires a non-platform view: `OrgSelector` renders null in `platform_admin`
 * mode (OrgSelector.tsx:46).
 *
 * Must be called again after every navigation. `currentOrg` is plain component
 * state (useAuth.tsx:49) with nothing persisting it, so each app boot starts with
 * none and `OrgSelector` auto-selects `orgs[0]` (OrgSelector.tsx:28,42) — a
 * default that happens to be the fence only by list order, and never on purpose.
 */
export async function selectFencedOrg(page: Page, org: FencedOrg): Promise<void> {
  // A Radix Select, not a `<select>`: the options exist only once the trigger has
  // opened the popover, so `selectOption()` has nothing to act on.
  await orgSelector(page).click();
  await page.getByRole('option', { name: org.name, exact: true }).click();
  await assertFenced(page, org);
}

/**
 * Hard stop: a spec that cannot confirm its fence must not write.
 *
 * Asserts on what the trigger renders, which is `currentOrg`'s name — the same
 * value every org-scoped request derives its `orgId` from.
 */
export async function assertFenced(page: Page, org: FencedOrg): Promise<void> {
  await expect(
    orgSelector(page),
    `fence not confirmed — refusing to write outside ${org.name}`,
  ).toContainText(org.name);
}

/**
 * Remove the fence, and confirm it is gone.
 *
 * Safe to run twice for the same RUN_ID, in either order with a failed attempt:
 * a fence a previous attempt already deleted is not an error here, it is the
 * state this function exists to reach.
 */
export async function deleteFencedOrg(page: Page, org: FencedOrg): Promise<void> {
  await page.goto(ORG_LIST_PATH);
  await expect(newOrgButton(page)).toBeVisible({ timeout: WRITE_TIMEOUT });

  const row = orgRow(page, org);
  if ((await row.count()) === 0) {
    return;
  }

  await row.click();
  await page.getByRole('button', { name: DELETE_AFFORDANCE, exact: true }).click();
  // Scoped to the dialog: the trigger just clicked carries this same accessible
  // name. Radix does take it out of the accessibility tree while the modal is
  // open — the page-wide count with the dialog open was observed to be 1 — so
  // scoping is what keeps this click independent of that behaviour rather than
  // relying on it.
  await page.getByRole('alertdialog').getByRole('button', { name: DELETE_AFFORDANCE, exact: true }).click();

  // The delete mutation navigates back to the list in its onSuccess
  // (OrganizationDetail.tsx:295-302), so this URL is the app's own signal that
  // the request came back OK. Waiting for it before the reload below is
  // load-bearing: a `goto` issued while the DELETE is still in flight aborts it,
  // which is how an earlier sweep of this same flow re-clicked the same
  // undeleted org five times.
  await expect(page).toHaveURL(/\/organizations$/, { timeout: WRITE_TIMEOUT });

  // A fresh boot rather than the list just navigated to: `invalidateQueries` goes
  // on rendering the previous rows until its refetch lands, so the assertion
  // could otherwise pass or fail on cache timing.
  await page.goto(ORG_LIST_PATH);
  await expect(newOrgButton(page)).toBeVisible({ timeout: WRITE_TIMEOUT });
  await expect(row, `fence ${org.name} outlived its run — delete it by hand`).toHaveCount(0);
}
