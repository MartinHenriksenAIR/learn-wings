import type { Locator, Page } from '@playwright/test';
import { expect, gotoFenced, test } from '../fixtures/fenced-org';


test.use({ viewMode: 'org_admin' });

test.describe.configure({ retries: 0 });

const MEMBERS_PATH = '/app/admin/org?tab=members';

const INVITATIONS_ENDPOINT = '/api/invitations';
const MEMBERSHIPS_ENDPOINT = '/api/org-memberships';

const INVITE_READ_TIMEOUT = 30_000;

const INVITE_SUBMIT_TIMEOUT = 45_000;

const CLOSING_READ_TIMEOUT = 5 * INVITE_READ_TIMEOUT;

const SPEC_TIMEOUT = 20 * INVITE_READ_TIMEOUT;

test.describe.configure({ timeout: SPEC_TIMEOUT });

const INVITE_MEMBER = 'Invite Member';

const EMAIL_LABEL = 'Email Address';

const CREATE_INVITATION = 'Create Invitation';

const PENDING_HEADING = 'Pending invitations';

const REVOKE = 'Revoke';

const NO_MEMBERS = 'No team members yet';

const INVITE_CREATED = 'Invitation created!';
const INVITE_FAILED = 'Failed to create invitation';

const EMAIL_SENT = 'Invitation email sent successfully.';
const EMAIL_NOT_SENT = 'Copy the invite link to share with the user.';

const REVOKE_FAILED = 'Failed to cancel invitation';

function inviteTrigger(page: Page): Locator {
  return page.getByRole('button', { name: INVITE_MEMBER, exact: true }).first();
}

function pendingHeading(page: Page): Locator {
  return page.getByRole('heading', { name: PENDING_HEADING, exact: true });
}

function invitationEmail(page: Page, email: string): Locator {
  return page.getByText(email, { exact: true });
}

function invitationRow(page: Page, email: string): Locator {
  return invitationEmail(page, email).locator('../..');
}

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
  await dialog.getByLabel(EMAIL_LABEL, { exact: true }).fill(inviteTo);
  await dialog.getByRole('button', { name: CREATE_INVITATION, exact: true }).click();

  const emailSent = page.getByText(EMAIL_SENT, { exact: true });
  const emailNotSent = page.getByText(EMAIL_NOT_SENT, { exact: true });
  const failed = page.getByText(INVITE_FAILED, { exact: true });
  await expect(
    emailSent.or(emailNotSent).or(failed).first(),
    `inviting ${inviteTo} produced neither an "${INVITE_CREATED}" toast — with either of its ` +
      `two descriptions, "${EMAIL_SENT}" or "${EMAIL_NOT_SENT}" — nor "${INVITE_FAILED}", so ` +
      'invitation-create neither succeeded nor said why. Check the run report for a failed request.',
  ).toBeVisible({ timeout: INVITE_SUBMIT_TIMEOUT });

  if (await failed.first().isVisible()) {
    throw new Error(`invitation-create failed for ${inviteTo}: the app showed "${INVITE_FAILED}".`);
  }
  if (await emailNotSent.first().isVisible()) {
    throw new Error(
      `the invitation for ${inviteTo} was created but /api/send-invitation-email did not report ` +
        `success: the app showed "${EMAIL_NOT_SENT}" instead of "${EMAIL_SENT}". Check the run report.`,
    );
  }

  await expect(dialog, 'the invite dialog stayed open after a create the app reported as successful').toBeHidden({
    timeout: INVITE_READ_TIMEOUT,
  });

  await expect(
    pendingHeading(page),
    `${inviteTo} was invited but no pending-invitation list appeared`,
  ).toHaveCount(1, { timeout: INVITE_READ_TIMEOUT });
  await expect(invitationEmail(page, inviteTo)).toHaveCount(1);

  const revoke = invitationRow(page, inviteTo).getByRole('button', { name: REVOKE, exact: true });
  await expect(revoke, `the pending row for ${inviteTo} has no ${REVOKE} button`).toBeVisible();
  await revoke.click();

  await expect(
    invitationEmail(page, inviteTo),
    `revoking ${inviteTo} left its row on the page. If the report shows "${REVOKE_FAILED}", ` +
      'invitation-update failed.',
  ).toHaveCount(0, { timeout: INVITE_READ_TIMEOUT });

  const invitationsLoaded = page.waitForResponse(
    (response) => response.url().includes(INVITATIONS_ENDPOINT),
    { timeout: CLOSING_READ_TIMEOUT },
  );
  const membershipsLoaded = page.waitForResponse(
    (response) => response.url().includes(MEMBERSHIPS_ENDPOINT),
    { timeout: CLOSING_READ_TIMEOUT },
  );
  await gotoFenced(page, fencedOrg, MEMBERS_PATH);

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
