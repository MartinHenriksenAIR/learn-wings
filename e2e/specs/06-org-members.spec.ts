import type { Locator, Page } from '@playwright/test';
import { expect, gotoFenced, test } from '../fixtures/fenced-org';

/**
 * The org-admin invitation journey: invite, see it pending, revoke it.
 *
 * **This journey sends one real email.** The invite mutation awaits
 * `sendInvitationEmail` (OrgMembersTab.tsx:221-232), which posts to
 * `/api/send-invitation-email` — a live Resend call to `E2E_INVITE_TO`, the account
 * owner's own address by their decision. Nothing here can take that back, which is why
 * the run is capped at one attempt (see the `retries` override below) and why the write
 * is guarded by a count that has to read 0 first.
 *
 * **The invitation is addressed to the signed-in account, and that shapes the whole
 * journey.** `/api/user-context` auto-adopts every pending org invitation whose email
 * matches the caller's, on EVERY call and not just at first login
 * (functions/user-context/index.ts:16-30, #176) — converting it into a membership. The
 * suite signs in as the owner of `E2E_INVITE_TO`, so this invitation is addressed to
 * the very account that is browsing: any app boot after the write adopts it, and it
 * stops being pending. Measured in a run that tried it — the fence's
 * `pending_invite_count` went 1 → 0 and `member_count` 0 → 1 across one navigation, and
 * `/api/invitations` then returned `[]`.
 *
 * That is why **there is no reload between the invite and the revoke**: the pending
 * assertion is made on the page that wrote it, and the reload comes only after the
 * revoke, once the row is `expired` and no longer adoptable. It also means the final
 * check has to rule out adoption rather than just absence — see the last assertion.
 *
 * **No invitation-cleanup fixture, and that is verified rather than assumed.**
 * `invitations.org_id` is declared `REFERENCES public.organizations(id) ON DELETE
 * CASCADE` (migration/azure/01-schema.sql:156), as is `org_memberships.org_id`
 * (:143) — so deleting the fence removes the invitation and any membership it may have
 * become. The `fencedOrg` fixture already owns that delete in Playwright's teardown, so
 * both have a teardown owner without a second fixture, unlike a course, which no
 * organization contains (see e2e/fixtures/course.ts). There is therefore no
 * `try`/`finally` here: a test timeout rejects every await left in the body, so a body
 * `finally` cannot click its way through a cleanup (#319), and it does not have to.
 *
 * **Every navigation goes through `gotoFenced`, and here that is the whole ball game.**
 * `currentOrg` is plain component state (useAuth.tsx:49) that nothing persists, so a
 * bare `page.goto` boots with nothing selected and `OrgSelector` auto-selects `orgs[0]`
 * instead (OrgSelector.tsx:23-32). Unlike the course journey — whose writes carry no
 * org id to misdirect — every write below is org-scoped: `invitation-create` takes
 * `orgId` from `currentOrg` (OrgMembersTab.tsx:212), so a bare navigation would post an
 * invitation into a real customer organization and mail a working join link for it.
 * Nothing structurally stops that yet (#321), so it is a rule this file keeps by hand.
 */

// Mandatory: the `fencedOrg` fixture refuses platform view outright, because
// `OrgSelector` renders null there (OrgSelector.tsx:46-48) and the fence could not be
// selected. Org-admin view is enough for every endpoint this journey touches —
// `requireOrgAdmin` returns early on the raw `profile.is_platform_admin`
// (functions/shared/endpoint.ts:91-95), so no membership row is needed.
test.use({ viewMode: 'org_admin' });

// One attempt only, overriding the config's `retries: 1`. A retry would not resume
// where this left off: `fenceDelete`'s teardown deletes the organization after the
// failed attempt and the cascade above removes the invitation with it, so the retry
// starts from an empty fence, takes the invite branch again, and sends a SECOND
// irreversible email. Idempotency cannot help — the state a retry would adopt has been
// deleted — so the honest fix is to not retry.
test.describe.configure({ retries: 0 });

/**
 * The members surface — a tab on the org-admin analytics page, not a route of its own.
 *
 * `OrgAnalytics` seeds its active tab from the `tab` search param
 * (OrgAnalytics.tsx:50) and renders `OrgMembersTab` only for `members`, and only in the
 * org-scoped view (OrgAnalytics.tsx:350). So the query string selects the tab directly
 * and no tab click is needed; measured, the URL still carries `?tab=members` after the
 * app boots. The route itself is `routes.orgAdmin.root` (routes.ts:54).
 */
const MEMBERS_PATH = '/app/admin/org?tab=members';

/**
 * The two members-tab reads the closing assertions' emptiness is read off.
 *
 * `useInvitations` posts to `/api/invitations` and `useOrgMemberships` to
 * `/api/org-memberships` (src/hooks/useInvitations.ts, src/hooks/useOrgMemberships.ts).
 * `OrgMembersTab` renders a *failed* query — `data === undefined` — as `[]`
 * (OrgMembersTab.tsx:100-107,410-415), identical to a successful empty response, so the
 * post-revoke `0 / 0 / no-members` reading holds just as well when the backend is down.
 * The closing check waits on these two responses and asserts each answered ok before
 * reading emptiness off them, so a 500, a 401 on an expired token, or an aborted request
 * fails the run there instead of passing it green.
 */
const INVITATIONS_ENDPOINT = '/api/invitations';
const MEMBERSHIPS_ENDPOINT = '/api/org-memberships';

/**
 * Budget for a members-tab read: an Azure Functions call plus the render it feeds.
 * Wider than the config's 15s `expect` default, which was sized for assertions on
 * already-rendered state — a cold function start alone can eat it.
 */
const INVITE_READ_TIMEOUT = 30_000;

/**
 * Budget for the invite itself, wider than a read because it is two sequential function
 * invocations rather than one: the mutation awaits `invitation-create` and then
 * `sendInvitationEmail` before it reports either outcome (OrgMembersTab.tsx:208-232),
 * so this figure has to cover two cold starts.
 */
const INVITE_SUBMIT_TIMEOUT = 45_000;

/**
 * Budget for the two closing reads to *answer*, counted from when their `waitForResponse`
 * listeners are attached — which is before the final `gotoFenced`, so it has to span that
 * whole navigation as well as the read the members tab then issues. gotoFenced's own worst
 * case is ~105s (see SPEC_TIMEOUT) and a read is 30s, so this is sized above that sum.
 *
 * It does not widen this spec's worst case, so SPEC_TIMEOUT need not grow: a response that
 * arrives — any status — resolves the wait no later than the tab finishes loading, which
 * the `inviteTrigger` read below already accounts for; and a response that never arrives
 * fails the run here rather than continuing, so this wait and the reads after it are never
 * both spent to the full in one run.
 */
const CLOSING_READ_TIMEOUT = 5 * INVITE_READ_TIMEOUT;

/**
 * What one run of this journey may spend, replacing the config's per-test cap.
 *
 * That cap is `SIGN_IN_WORST_CASE_TIMEOUT + 25_000` — 90s, sized for a spec whose only long
 * wait is sign-in itself (playwright.config.ts). This body's own bounded waits sum to 585s:
 * two `gotoFenced` calls at 105s each (a `page.goto` at Playwright's 30s navigation default,
 * then `selectFencedOrg`'s 30s wait for `OrgSelector` and its three 15s actions —
 * e2e/fixtures/fenced-org.ts), the 45s submit settle, five 30s `INVITE_READ_TIMEOUT` waits
 * (150s), and twelve assertions and clicks left on the config's 15s `expect`/`actionTimeout`
 * defaults (180s). Sign-in and the fence's create/delete are not in that sum: they happen in the
 * `fencedOrg` and `fenceDelete` fixtures, which carry their own timeouts and do not draw on
 * the per-test budget.
 *
 * At 90s a cold start therefore trips the cap while one of those waits is still running, and
 * the run prints Playwright's generic "Test timeout exceeded" instead of the message that wait
 * carries. Nothing about the email or the database turns on this — the invite is either sent
 * or not, whatever the cap says — but it costs the diagnosis, so it is sized the same way as
 * everything else here: twenty read budgets (600s), above the 585s the path can spend, so
 * this cap is never the thing that fires. A ceiling on a pathological run where every wait
 * spends its whole budget, not an expectation.
 */
const SPEC_TIMEOUT = 20 * INVITE_READ_TIMEOUT;

test.describe.configure({ timeout: SPEC_TIMEOUT });

/** `analytics.members.inviteMember` — the invite dialog's trigger. */
const INVITE_MEMBER = 'Invite Member';

/** The invite dialog's email field label (OrgMembersTab.tsx:478) — not an i18n key. */
const EMAIL_LABEL = 'Email Address';

/** The invite dialog's submit button (OrgMembersTab.tsx:556) — not "Send", not "Invite". */
const CREATE_INVITATION = 'Create Invitation';

/** `analytics.members.pendingInvitations` — the heading over the invitation list. */
const PENDING_HEADING = 'Pending invitations';

/** `analytics.members.revoke` — the per-row revoke button. */
const REVOKE = 'Revoke';

/** `analytics.members.noMembersTitle` — the members list's empty state. */
const NO_MEMBERS = 'No team members yet';

/** The invite mutation's two toast titles (OrgMembersTab.tsx:237 and :234 respectively). */
const INVITE_CREATED = 'Invitation created!';
const INVITE_FAILED = 'Failed to create invitation';

/**
 * The success toast's two descriptions (OrgMembersTab.tsx:238-240): the mail went out, or it
 * did not and the invite link has to be copied by hand.
 *
 * Which of the two renders is chosen by `sendInvitationEmail`'s result, so `EMAIL_SENT` is a
 * claim about /api/send-invitation-email rather than about the invitation. Whether the message
 * then reads correctly — naming the fenced org rather than the literal `null` of #309 — is an
 * inbox check no assertion here can stand in for.
 *
 * These are what the settle below waits on, in place of the `INVITE_CREATED` title they sit
 * under, and that is deliberate. Title and description come from one
 * `toast({ title, description })` call, so the description is on screen in the same instant the
 * title is — but the toast is a sonner toast on a 5s duration
 * (src/components/ui/sonner.tsx:50), so a second `expect` made after a wait on the title had
 * already resolved can find the whole toast gone and report a *successful* send as a failure.
 * Waiting on the description instead observes both halves at once, and cannot be outlived.
 */
const EMAIL_SENT = 'Invitation email sent successfully.';
const EMAIL_NOT_SENT = 'Copy the invite link to share with the user.';

/** The revoke mutation's failure toast title (OrgMembersTab.tsx:273). */
const REVOKE_FAILED = 'Failed to cancel invitation';

/**
 * The invite trigger, which doubles as the members tab's *settled* signal — settled,
 * not succeeded.
 *
 * `OrgMembersTab` returns a bare `PageSpinner` until its memberships, invitations and
 * AI-champion queries have all settled (OrgMembersTab.tsx:410-415), so this button
 * existing separates "the reads have come back" from "they have not answered yet":
 * during the spinner every count below reads 0, so an unloaded tab would look exactly
 * like a fence with nothing in it, and waiting for this button rules that out.
 *
 * What it does NOT establish is that those reads SUCCEEDED. A rejected query ends the
 * spinner too, and `OrgMembersTab` renders its `undefined` data as `[]`
 * (OrgMembersTab.tsx:100-107) — indistinguishable from a successful empty response. So
 * this button being visible cannot tell a genuinely empty fence from one whose reads
 * 500'd or hit an expired token: both show `0 / 0 / no-members`. Where that distinction
 * is load-bearing — the post-revoke check, which reads emptiness as proof the revoke
 * took effect — the responses themselves are awaited and asserted ok
 * (INVITATIONS_ENDPOINT / MEMBERSHIPS_ENDPOINT) before any count is trusted. That
 * verified-successful response is the mechanism ruling out the false pass, not this button.
 *
 * `.first()` because an organization with no members renders this label twice — the
 * header's `DialogTrigger` (OrgMembersTab.tsx:464-467) and the `EmptyState` action
 * (OrgMembersTab.tsx:620-627), which shows because `filteredMembers.length === 0`
 * (OrgMembersTab.tsx:609). A fresh fence has no members, so that is this journey's
 * normal state rather than an edge case: measured 2 in the fence, against 1 in an
 * organization that has members. Both open the one dialog, so which is clicked carries
 * no meaning.
 */
function inviteTrigger(page: Page): Locator {
  return page.getByRole('button', { name: INVITE_MEMBER, exact: true }).first();
}

/**
 * The heading over the pending-invitation list.
 *
 * An `<h3>` (OrgMembersTab.tsx:755) rendered only while `invitations.length > 0`
 * (OrgMembersTab.tsx:753), so its presence is itself a claim that the list is not
 * empty — which is why it is counted alongside the address below rather than trusted as
 * decoration.
 */
function pendingHeading(page: Page): Locator {
  return page.getByRole('heading', { name: PENDING_HEADING, exact: true });
}

/**
 * The pending-invitation row's email cell — this journey's oracle.
 *
 * Matched as text, not by row role: the row is a plain `<div>` with no table semantics,
 * and `getByRole('row')` measured 0 on this page, so a row locator would match nothing
 * at all. The address is what identifies the invitation (OrgMembersTab.tsx:770), and
 * `exact: true` keeps this off the wrapping `<span>`, whose own text is the address
 * followed by the "Invited … · …" line.
 *
 * Counted rather than merely awaited, because "how many" is the question that makes the
 * assertions honest: measured 0 on a freshly created fence before any invitation and 1
 * after one, so it is unsatisfiable until the write actually lands.
 */
function invitationEmail(page: Page, email: string): Locator {
  return page.getByText(email, { exact: true });
}

/**
 * The whole pending-invitation row, for scoping its Revoke button.
 *
 * Two levels up from the email cell: the address sits in a `<span>` inside the
 * flex-column `<span>` that also holds the "Invited …" line, and that column is a direct
 * child of the row `<div>` (OrgMembersTab.tsx:762-780).
 *
 * Scoped rather than taken page-wide because every pending invitation renders its own
 * Revoke button under this one accessible name (OrgMembersTab.tsx:796-803), and nothing
 * in the database stops an organization holding several rows for the same address:
 * `invitations`' only UNIQUE column is `token` (migration/azure/01-schema.sql:154-172),
 * so `invitation-create`'s already-pending 409 — which fires on a unique violation —
 * cannot be reached by repeating an address.
 */
function invitationRow(page: Page, email: string): Locator {
  return invitationEmail(page, email).locator('../..');
}

/**
 * The address this run invites, normalised the way the server stores it.
 *
 * Lowercased because `invitation-create` inserts `email.toLowerCase().trim()`
 * (functions/invitation-create/index.ts:66) and the row renders that stored value
 * (OrgMembersTab.tsx:770) — so a mixed-case `E2E_INVITE_TO` would leave every assertion
 * below looking for text the page is never going to show. Today's value is already
 * lowercase; normalising keeps that from being an unstated precondition.
 */
function requireInviteAddress(): string {
  const raw = process.env.E2E_INVITE_TO;
  if (!raw) {
    throw new Error(
      'E2E_INVITE_TO is not set. Add it to .env.e2e — see .env.e2e.example. It is the address ' +
        'this journey sends a real invitation email to, once per run.',
    );
  }
  return raw.trim().toLowerCase();
}

test('an invitation can be sent, seen as pending, and revoked', async ({ page, fencedOrg }) => {
  const inviteTo = requireInviteAddress();

  await gotoFenced(page, fencedOrg, MEMBERS_PATH);
  await expect(
    inviteTrigger(page),
    'the members tab never finished loading, so nothing can be invited from it',
  ).toBeVisible({ timeout: INVITE_READ_TIMEOUT });

  // The pre-write reading, and the reason every assertion after it means something: on a
  // fence created seconds ago there are no invitations and no members, so all three
  // locators are at their empty values. Measured, and load-bearing three times over — it
  // establishes that the invitation oracle can read empty (an assertion that could not
  // fail would prove nothing), it fixes the members baseline the final check compares
  // against, and it refuses to send a second email if some earlier state is already here.
  await expect(
    invitationEmail(page, inviteTo),
    `${inviteTo} is already listed in a fence created for this run — refusing to invite twice, ` +
      'because a second invitation means a second irreversible email',
  ).toHaveCount(0);
  await expect(
    pendingHeading(page),
    'the fence already holds a pending invitation, so this run did not start from a clean fence',
  ).toHaveCount(0);
  await expect(
    page.getByText(NO_MEMBERS, { exact: true }),
    'the fence already has members, so the final adoption check below could not tell a revoked ' +
      'invitation from an adopted one',
  ).toHaveCount(1);

  await inviteTrigger(page).click();
  const dialog = page.getByRole('dialog');
  // By label, which works here and did not in the course dialogs: this `<Label
  // htmlFor="email">` and its `<Input id="email">` are actually associated
  // (OrgMembersTab.tsx:478-481), so `getByLabel` resolves to exactly 1 (measured),
  // whereas `CoursesManager` and `CourseEditor` pair a `<Label>` with an `<Input>`
  // carrying neither attribute and resolve to 0 (#325).
  await dialog.getByLabel(EMAIL_LABEL, { exact: true }).fill(inviteTo);
  // Only the address is set. Role keeps the dialog's `learner` default
  // (OrgMembersTab.tsx:164) and the language select keeps the seeded UI language, `en`
  // (OrgMembersTab.tsx:165-167; e2e/fixtures/session.ts) — both values
  // `invitation-create` accepts, so the journey does not depend on operating two Radix
  // selects it makes no claim about. The mail therefore arrives in English.
  await dialog.getByRole('button', { name: CREATE_INVITATION, exact: true }).click();

  // One wait for every outcome the mutation reports, the sent-email half included — see
  // EMAIL_SENT for why that half cannot be left to a later `expect`. `setInviteOpen(false)`
  // sits on the success path only (OrgMembersTab.tsx:242), so a failed create leaves the
  // dialog open and never adds a row — and a bare wait for the row would then spend the
  // whole budget on a write that had already reported why it failed.
  const emailSent = page.getByText(EMAIL_SENT, { exact: true });
  const emailNotSent = page.getByText(EMAIL_NOT_SENT, { exact: true });
  const failed = page.getByText(INVITE_FAILED, { exact: true });
  await expect(
    emailSent.or(emailNotSent).or(failed).first(),
    `inviting ${inviteTo} produced neither an "${INVITE_CREATED}" toast — with either of its ` +
      `two descriptions, "${EMAIL_SENT}" or "${EMAIL_NOT_SENT}" — nor "${INVITE_FAILED}", so ` +
      'invitation-create neither succeeded nor said why. Check the run report for a failed request.',
  ).toBeVisible({ timeout: INVITE_SUBMIT_TIMEOUT });

  // Which one arrived is the diagnosis. isVisible() is a decision, not a wait — one of
  // the three is already known visible.
  if (await failed.first().isVisible()) {
    throw new Error(`invitation-create failed for ${inviteTo}: the app showed "${INVITE_FAILED}".`);
  }
  if (await emailNotSent.first().isVisible()) {
    // The invitation exists — only the mail did not go out. Thrown rather than tolerated,
    // because "the mail was sent" is half of what this journey is for; and thrown here rather
    // than left to a failing assertion further down, so the diagnosis names the send instead
    // of whatever the run went on to look for.
    throw new Error(
      `the invitation for ${inviteTo} was created but /api/send-invitation-email did not report ` +
        `success: the app showed "${EMAIL_NOT_SENT}" instead of "${EMAIL_SENT}". Check the run report.`,
    );
  }

  // Past both throws, so `EMAIL_SENT` was the description on screen: the app reported the
  // invitation created and /api/send-invitation-email answering success, which is the only
  // evidence of the dispatch a test can have.
  await expect(dialog, 'the invite dialog stayed open after a create the app reported as successful').toBeHidden({
    timeout: INVITE_READ_TIMEOUT,
  });

  // The invitation is pending, and this is a server read rather than an optimistic row:
  // the success path invalidates the invitations key (OrgMembersTab.tsx:249) and the list
  // renders from `invitationsQuery.data`, so the row arrives with that refetch — observed
  // in a trace as a second /api/invitations call returning the row. It is not vacuous
  // either: the identical locator was asserted at 0 a few lines above, before the write.
  //
  // This is deliberately NOT re-checked after a reload, and that is the one place this
  // journey cannot have the stronger empty-cache oracle: booting the app calls
  // /api/user-context, which adopts any pending invitation addressed to the caller — and
  // this one is addressed to the caller (see the header). A reload here would convert the
  // invitation into a membership and then legitimately find nothing pending, which is why
  // the revoke below happens on this same page, with no navigation in between.
  await expect(
    pendingHeading(page),
    `${inviteTo} was invited but no pending-invitation list appeared`,
  ).toHaveCount(1, { timeout: INVITE_READ_TIMEOUT });
  await expect(invitationEmail(page, inviteTo)).toHaveCount(1);

  const revoke = invitationRow(page, inviteTo).getByRole('button', { name: REVOKE, exact: true });
  await expect(revoke, `the pending row for ${inviteTo} has no ${REVOKE} button`).toBeVisible();
  await revoke.click();

  // Absence is the only honest in-page signal, and there is no race to run against it.
  // The revoke has no success toast — the routine one was replaced by an in-button morph —
  // and that morph is optimistic: `handleCancelInvitation` calls `flashRevoke` before it
  // mutates (OrgMembersTab.tsx:376-381), so the button relabels to "Revoked" and disables
  // itself the instant it is clicked, whatever the request goes on to do. Asserting on
  // that label would pass on a revoke that failed. What only happens on success is the row
  // leaving the cached list (`setQueryData`, OrgMembersTab.tsx:274-280), so that is what is
  // waited for; the cost is that a failed revoke spends this whole budget, which is why the
  // message names the toast to look for.
  await expect(
    invitationEmail(page, inviteTo),
    `revoking ${inviteTo} left its row on the page. If the report shows "${REVOKE_FAILED}", ` +
      'invitation-update failed.',
  ).toHaveCount(0, { timeout: INVITE_READ_TIMEOUT });

  // And the same claim against the server — but stated so that it cannot be satisfied by
  // the invitation having been adopted instead of revoked, which is the trap this journey
  // has to design around. A boot calls /api/user-context, which converts a still-pending
  // invitation addressed to the caller into an active membership: that path would empty
  // the pending list too, so "no pending row" alone proves nothing here.
  //
  // What separates the two is the members list. A revoke sets `status = 'expired'`
  // (functions/invitation-update/index.ts:44), which the adoption filter excludes — it
  // requires `status = 'pending'` (functions/user-context/index.ts:29-30) — so the fence
  // keeps zero members. Adoption instead adds one and the empty state disappears. So
  // asserting the empty state still renders, alongside the empty pending list, is what
  // makes this the revoke's confirmation: it fails if the revoke silently did not happen.
  //
  // But all three of those readings are `0 / 0 / no-members`, and so is a members tab
  // whose reads FAILED: `OrgMembersTab` renders `data === undefined` as `[]`
  // (OrgMembersTab.tsx:100-107,410-415), so a 500, an expired token or a backend outage
  // produces the identical empty page — and `inviteTrigger` being visible does not tell
  // the two apart, because a rejected query ends the loading spinner just as a resolved
  // one does (see inviteTrigger's note). So the two reads' responses are awaited and
  // asserted ok BEFORE emptiness is read off them: an errored fetch cannot answer 2xx, so
  // it can no longer masquerade as a clean fence. The listeners are attached before the
  // navigation that fires the reads, so the fresh boot's responses cannot arrive and be
  // missed before the wait that catches them exists.
  const invitationsLoaded = page.waitForResponse(
    (response) => response.url().includes(INVITATIONS_ENDPOINT),
    { timeout: CLOSING_READ_TIMEOUT },
  );
  const membershipsLoaded = page.waitForResponse(
    (response) => response.url().includes(MEMBERSHIPS_ENDPOINT),
    { timeout: CLOSING_READ_TIMEOUT },
  );
  await gotoFenced(page, fencedOrg, MEMBERS_PATH);

  // Await both together so each promise has a handler attached before either .ok() can throw:
  // asserting off `invitationsResponse` first and only then awaiting `membershipsLoaded` would
  // leave the memberships promise handler-less if the first assertion failed, so a both-aborted
  // forced-fail could reject it unhandled. The assertions still run in invitations-then-memberships
  // order, and both still precede the emptiness reads below.
  const [invitationsResponse, membershipsResponse] = await Promise.all([
    invitationsLoaded,
    membershipsLoaded,
  ]);
  expect(
    invitationsResponse.ok(),
    `${INVITATIONS_ENDPOINT} answered ${invitationsResponse.status()} on the post-revoke boot, so the ` +
      'empty pending list below would be `undefined` rendered as `[]`, not a confirmed-empty read',
  ).toBe(true);
  expect(
    membershipsResponse.ok(),
    `${MEMBERSHIPS_ENDPOINT} answered ${membershipsResponse.status()} on the post-revoke boot, so the ` +
      '"no members" state below would be a failed read rendered empty, not proof the revoke kept the fence clean',
  ).toBe(true);

  await expect(inviteTrigger(page)).toBeVisible({ timeout: INVITE_READ_TIMEOUT });
  await expect(
    invitationEmail(page, inviteTo),
    `${inviteTo} survived its revocation — it is still a pending invitation in the production database`,
  ).toHaveCount(0);
  await expect(pendingHeading(page)).toHaveCount(0);
  await expect(
    page.getByText(NO_MEMBERS, { exact: true }),
    `the fence gained a member, so ${inviteTo} was adopted by /api/user-context rather than ` +
      'revoked — invitation-update did not take effect',
  ).toHaveCount(1);
});
