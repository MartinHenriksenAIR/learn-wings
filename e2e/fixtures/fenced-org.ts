import { expect, type Locator, type Page } from '@playwright/test';
import { orgSchema } from '../../src/lib/org-validation';
import { RUN_ID, e2eName } from '../run-id';
import { SIGN_IN_WORST_CASE_TIMEOUT, sidebarNav, signInThroughSso, type ViewMode } from './auth';
import { test as sessionTest } from './session';

export type FencedOrg = { name: string; slug: string };

const ORG_LIST_PATH = '/app/admin/platform/organizations';

/**
 * The accessible name shared by the delete trigger and its confirm button.
 *
 * Captured against the live app: the icon button in `OrgDetailHeader` carries
 * `aria-label="Delete organization"` and the AlertDialog's action button renders
 * the same string, both from `orgDetail.deleteOrganization`. Two buttons, one name
 * — which is why the confirm click below is scoped to the `alertdialog` instead of
 * being told apart by its name. That collision is the real hazard here.
 *
 * The dialog's own title, "Delete Organization?", is not what `exact: true` guards
 * against: `AlertDialogTitle` renders an `<h2>`, so `getByRole('button')` already
 * excludes it. `exact: true` is this tree's blanket rule against accessible names
 * matching as substrings, applied here for consistency rather than to resolve a
 * collision known to exist.
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
 * What the fence fixture may spend on its setup, and again on its teardown.
 *
 * A fixture `timeout` is charged separately from the per-test cap in
 * playwright.config.ts, which is the point: that cap is sized for a test body, and
 * creating or deleting the fence can legitimately outlast it — the case that used
 * to leave an organization behind (#319). Derived from the waits actually in the
 * path rather than picked, so the work cannot silently outgrow the budget again:
 * sign-in's own worst case plus four write budgets, which is the widest either
 * phase can be (goto + list load + the create race + the row check on the way in;
 * the same shape again on the way out).
 */
const FENCE_FIXTURE_TIMEOUT = SIGN_IN_WORST_CASE_TIMEOUT + 4 * WRITE_TIMEOUT;

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
 * Every inline field error the create dialog can show, as one locator.
 *
 * Both the zod branch and the duplicate-slug branch of `handleCreate` land in the
 * same two `<p>` slots under the name and slug inputs (OrganizationsManager.tsx:
 * 296,309) — the first from `orgSchema.safeParse` failing, the second from the API
 * returning `DUPLICATE_SLUG`. Matching them together is what lets the wait below
 * settle on a rejection of any kind and then read which one it was, instead of
 * waiting out the full write budget on a validation error it never looked for.
 *
 * A class selector rather than a role: the errors are unlabelled `<p>`s with no
 * role of their own. Scoped to the dialog because the org list also styles a
 * `<span>` with `text-destructive` when a row is at its seat limit
 * (OrganizationsManager.tsx:448).
 */
function createDialogErrors(page: Page): Locator {
  return page.getByRole('dialog').locator('p.text-destructive');
}

/**
 * This run's fence, named without touching the network.
 *
 * Pure and stable for the whole invocation: `e2eName` is derived from RUN_ID,
 * which `e2e/global-setup.ts` mints once per `npm run e2e` (see e2e/run-id.ts).
 * Two callers therefore always agree on which org the fence is — which is what
 * lets the fixture below name the org for teardown *before* creating it, so a
 * creation that dies mid-write still has something to clean up.
 *
 * The form derives the slug from the name with the same transform
 * (OrganizationsManager.tsx:236-240), so lowercasing here only restates what
 * typing the name already produces — but it makes the slug a value this module
 * knows, rather than one inferred from a component's effect.
 */
function fenceIdentity(): FencedOrg {
  const name = e2eName('org');
  return { name, slug: name.toLowerCase() };
}

/**
 * Fail before submitting a name or slug the app will reject.
 *
 * Records a dependency that is otherwise invisible: the fence's slug is RUN_ID
 * lowercased, so the id format minted in e2e/global-setup.ts has to keep
 * satisfying `ORG_SLUG_REGEX` and the length bounds in src/lib/org-validation.ts.
 * An id containing, say, an underscore or a `+` would fail creation as an inline
 * slug error with nothing pointing at the run id as the cause.
 *
 * `orgSchema` is imported rather than restated because it is the very schema
 * `handleCreate` validates with (OrganizationsManager.tsx:126) — a copy here
 * could drift from the rule it is supposed to predict.
 */
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

/**
 * Create the organization this run's writes are confined to.
 *
 * The suite owns its fence rather than borrowing an existing org: write journeys
 * must assert on artefacts they created, or they inherit depends-on-uncontrolled-
 * state flakiness. `organization-create` is requirePlatformAdmin, so no prod DML
 * or seed script is needed.
 *
 * Safe to run twice for the same RUN_ID. `playwright.config.ts` sets `retries: 1`
 * and `fenceIdentity` is stable across a retry, so the second attempt submits a
 * slug the first attempt already created; that path is handled below rather than
 * left to fail the retry it exists to serve.
 *
 * Still exported after the `fencedOrg` fixture below took over calling it: the
 * fixture is the way a spec should get a fence, but the primitive is what makes
 * the fixture readable and is what a one-off diagnostic script needs.
 */
export async function createFencedOrg(page: Page): Promise<FencedOrg> {
  const org = fenceIdentity();
  assertFenceNameIsAcceptable(org);

  await page.goto(ORG_LIST_PATH);
  // Explicit, rather than left to the click's own auto-wait: the list is behind a
  // `PageSpinner` until /api/organizations answers, and that first call can be a
  // cold start — longer than the config's `actionTimeout`, which is sized for
  // clicks on rendered UI.
  await expect(newOrgButton(page)).toBeVisible({ timeout: WRITE_TIMEOUT });
  await newOrgButton(page).click();
  await page.locator('#name').fill(org.name);
  await page.locator('#slug').fill(org.slug);
  await page.getByRole('button', { name: 'Create Organization', exact: true }).click();

  // One wait for every outcome the dialog has. On any rejection it stays open with
  // an inline error, and an open Radix dialog marks the rest of the page
  // aria-hidden — which takes every list row out of the accessibility tree that
  // role locators read, so the row can only be looked for once it is closed.
  const errors = createDialogErrors(page);
  const row = orgRow(page, org);
  await expect(
    errors.or(row).first(),
    `neither a row for ${org.name} nor an inline error appeared, so organization-create neither ` +
      'succeeded nor said why — check the run report for a failed request or an error toast.',
  ).toBeVisible({ timeout: WRITE_TIMEOUT });

  // Which one arrived decides whether this attempt created the fence, found it
  // already there, or was rejected. isVisible() is a decision, not a wait — one of
  // the two is already known visible.
  if (await errors.first().isVisible()) {
    const messages = (await errors.allInnerTexts()).map((text) => text.trim());
    // Only a duplicate slug means "already created", and only by a previous attempt
    // at this same RUN_ID. Any other inline error is a rejection to report as one:
    // it is the branch that used to spend the whole write budget waiting for a row
    // the dialog was never going to render.
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

/**
 * Point `OrgSelector` at the fence, and confirm it landed.
 *
 * Requires a non-platform view: `OrgSelector` renders null in `platform_admin`
 * mode (OrgSelector.tsx:46).
 *
 * Must be called again after every navigation — which is what `gotoFenced` exists
 * to make automatic. Prefer that over calling this directly.
 */
export async function selectFencedOrg(page: Page, org: FencedOrg): Promise<void> {
  // Waited for explicitly, before the click, so the two ways the trigger can be
  // missing get named here rather than reported as `actionTimeout` firing on a
  // locator that resolved to nothing — which is all the click itself could say.
  const selector = orgSelector(page);
  await expect(
    selector,
    'OrgSelector is not on screen, so the fence cannot be selected. It renders null in ' +
      'platform_admin view (OrgSelector.tsx:46) and a spinner until /api/organizations answers.',
  ).toBeVisible({ timeout: WRITE_TIMEOUT });

  // A Radix Select, not a `<select>`: the options exist only once the trigger has
  // opened the popover, so `selectOption()` has nothing to act on.
  await selector.click();
  await page.getByRole('option', { name: org.name, exact: true }).click();
  await assertFenced(page, org);
}

/**
 * Navigate and put the fence back, in one call.
 *
 * **Write journeys navigate with this, never with `page.goto`.** `currentOrg` is
 * plain component state (useAuth.tsx:49) that nothing persists, so every
 * navigation boots the app with none selected and `OrgSelector` auto-selects
 * `orgs[0]` instead (OrgSelector.tsx:28,42). `/api/organizations` orders by
 * `created_at DESC` (functions/organizations/index.ts:33), so `orgs[0]` is
 * whichever org was created most recently — the fence only for as long as nothing
 * newer exists, and never because anything asked for it. A journey that reaches a
 * page with `page.goto` and then writes, writes wherever that default landed.
 *
 * The re-selection also re-asserts, via `selectFencedOrg`, so a navigation that
 * cannot restore the fence stops the journey instead of continuing unfenced.
 */
export async function gotoFenced(page: Page, org: FencedOrg, path: string): Promise<void> {
  await page.goto(path);
  await selectFencedOrg(page, org);
}

/**
 * Hard stop: a spec that cannot confirm its fence must not write.
 *
 * Asserts on what the trigger renders, which is `currentOrg`'s name — the value
 * the org-scoped hooks and pages read their `orgId` from (`useLearnerCourses`,
 * `useLearnerDashboard`, `OrgMembersTab`, `OrgSettings`, the community pages, and
 * the `queryKeys` entries that cache them).
 *
 * It does not cover a page scoped by its route. `OrganizationDetail` takes `orgId`
 * from `useParams` (OrganizationDetail.tsx:64), so on that page — the one
 * `deleteFencedOrg` deletes from — this assertion says nothing about which org is
 * being acted on, and that function asserts on the page's own `<h1>` instead.
 * Treat any write reached through a URL carrying an id the same way.
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
  // The click below is irreversible and this page is scoped by its route, not by
  // the OrgSelector — so `assertFenced` cannot vouch for it (see its note). A
  // level-1 heading carrying the fence's name is the only thing on screen that
  // names the org this page would delete, which makes it the check that has to
  // pass first.
  //
  // `.first()`, because the page renders that name in two `<h1>`s: `AppLayout`'s
  // `title` prop and `OrgDetailHeader`'s own heading (OrganizationDetail.tsx:424 and
  // OrgDetailHeader.tsx). Both read the same `org.name` from the same fetched
  // object, so which of the two matches carries no meaning — the assertion is about
  // a heading with this name existing, and either one proves it. (Strict mode would
  // otherwise fail on the pair, which is how the duplicate was found.)
  await expect(
    page.getByRole('heading', { level: 1, name: org.name, exact: true }).first(),
    `the open detail page is not ${org.name} — refusing to delete an organization this run does not own`,
  ).toBeVisible({ timeout: WRITE_TIMEOUT });

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

/**
 * `test` with this run's fenced org created before the body and deleted after it.
 *
 * Teardown is Playwright's rather than a `finally` in the spec, and that is the
 * whole point. When the per-test cap trips, every await left in the test body
 * rejects at once — so a body `finally` cannot navigate or click its way through a
 * cleanup, and the org survives the run (#319). Fixture teardown runs on its own
 * budget (`FENCE_FIXTURE_TIMEOUT`), so the same cleanup completes. A stranded fence
 * is a live row in the production database, which is why this is the fixture's
 * responsibility and not the journey author's.
 *
 * The fence is named before it is created, so a `createFencedOrg` that dies
 * mid-write — after `organization-create` committed, before the row was seen — is
 * still cleaned up. Sign-in sits outside that guard deliberately: if the capture
 * is expired nothing was created, and running the cleanup anyway would replace
 * that diagnosis with a timeout against a page that is not signed in.
 *
 * A spec using this must pick a non-platform view with
 * `test.use({ viewMode: 'org_admin' })`. `OrgSelector` renders nothing in platform
 * view (OrgSelector.tsx:46), so a fence could not be selected there, and the
 * session fixture's default is `platform_admin` — a default this module cannot
 * change, because Playwright allows an option's default to be declared only once
 * and re-declaring it in a derived test does not typecheck. So the requirement is
 * enforced instead of defaulted: `assertViewCanFence` refuses the wrong view before
 * anything is created. Platform-admin pages still render in org-admin view because
 * `ProtectedRoute` checks the raw `isPlatformAdmin` (ProtectedRoute.tsx:80) — which
 * is what lets a single view both create the fence and write inside it.
 *
 * Specs that need a fence import `test` and `expect` from this module; specs that
 * do not import them from ./session, whose fixtures this one extends.
 */
export const test = sessionTest.extend<{ fencedOrg: FencedOrg }>({
  fencedOrg: [
    // Playwright's second argument is called `use` in its own docs; it is named
    // `runTest` here because `react-hooks/rules-of-hooks` reads `use(...)` inside a
    // named non-component function as a misplaced React hook and fails the lint gate.
    async ({ page, viewMode }, runTest) => {
      assertViewCanFence(viewMode);
      await signInThroughSso(page, viewMode);

      // `createFencedOrg` returns this same value — both come from `fenceIdentity()`,
      // which is pure — so discarding its return costs nothing and naming the fence
      // here is what puts it in `finally`'s reach.
      const org = fenceIdentity();
      try {
        await createFencedOrg(page);
        await runTest(org);
      } finally {
        await deleteFencedOrg(page, org);
      }
    },
    { timeout: FENCE_FIXTURE_TIMEOUT, title: "this run's fenced organization" },
  ],
});

/**
 * Refuse a view the fence cannot be selected in, before anything is created.
 *
 * Platform-admin view — the session fixture's default, so also what a spec that
 * forgot `test.use` gets — is a contradiction here: the org would be created and
 * then unfenceable. Saying so up front beats creating it and then failing on an
 * absent OrgSelector, which reads as a broken locator rather than a missing line.
 */
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
