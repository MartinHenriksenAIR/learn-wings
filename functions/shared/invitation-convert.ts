import type { PoolClient } from 'pg';

/**
 * The "convert invite → membership" transition, shared by the
 * invitation-accept endpoint (#175) and auto-adoption at first SSO login
 * (#176). The CALLER owns loading + locking the invitation row (FOR UPDATE)
 * and validating it (pending, not expired, email match) inside a
 * withTransaction; this helper performs the state transition on the same
 * client so everything commits or rolls back together.
 */

/** The invitation columns the transition needs — a subset of the locked row. */
export interface ConvertibleInvitation {
  id: string;
  org_id: string | null;
  role: string;
  is_platform_admin_invite: boolean;
}

export type ConvertResult =
  | { kind: 'org'; orgId: string; role: string; alreadyMember: boolean }
  | { kind: 'platform' };

/**
 * Converts a locked, validated PENDING invitation into membership for
 * `profileId` and marks the invitation accepted — all on the caller's
 * transaction client.
 *
 * Branches on invite type (invitations_org_or_platform_admin_check pins the
 * shape): `org_id` set → org invite; `org_id` NULL → platform-admin invite.
 *
 * Existing-member rules (issue #175, locked decision #5): an existing ACTIVE
 * membership is an idempotent success (`alreadyMember: true` — row untouched,
 * invite still marked accepted); a DISABLED one is reactivated to `active`
 * with the invitation's role. Memberships are created `active`, never
 * `'invited'` — the seat model counts pending rows in `invitations`, not
 * `'invited'` memberships (that enum value is legacy and stays unused).
 *
 * Seat cap: NO seat check is needed here. The cap counts active memberships +
 * PENDING invitations (functions/shared/seats.ts, issue #126) — a pending
 * invite already "reserves" its seat. Within this one transaction, marking
 * the invite `accepted` drops the pending count by one while inserting a
 * membership raises the active count by one: net zero against the cap. The
 * disabled→reactivate branch is likewise -1 pending / +1 active (net zero),
 * and the already-active branch is -1 pending / ±0 active (net negative) —
 * no path can overshoot the cap.
 */
export async function convertInvitation(
  client: PoolClient,
  invitation: ConvertibleInvitation,
  profileId: string,
): Promise<ConvertResult> {
  if (invitation.org_id === null) {
    // Platform-admin invite: no membership row — grant the platform flag.
    await client.query(`UPDATE profiles SET is_platform_admin = true WHERE id = $1`, [profileId]);
    await markAccepted(client, invitation.id);
    return { kind: 'platform' };
  }

  // Org invite. Lock any existing membership row so a concurrent
  // disable/enable cannot interleave with the branch below.
  const existingRes = await client.query<{ id: string; status: string }>(
    `SELECT id, status FROM org_memberships WHERE org_id = $1 AND user_id = $2 FOR UPDATE`,
    [invitation.org_id, profileId],
  );
  const existing = existingRes.rows[0];

  let alreadyMember = false;
  if (!existing) {
    await client.query(
      `INSERT INTO org_memberships (org_id, user_id, role, status)
       VALUES ($1, $2, $3, 'active')`,
      [invitation.org_id, profileId, invitation.role],
    );
  } else if (existing.status === 'active') {
    alreadyMember = true; // idempotent — leave the row untouched
  } else {
    // disabled (or the unused legacy 'invited') → reactivate with the invited role
    await client.query(
      `UPDATE org_memberships SET status = 'active', role = $2 WHERE id = $1`,
      [existing.id, invitation.role],
    );
  }

  await markAccepted(client, invitation.id);
  return { kind: 'org', orgId: invitation.org_id, role: invitation.role, alreadyMember };
}

async function markAccepted(client: PoolClient, invitationId: string): Promise<void> {
  await client.query(`UPDATE invitations SET status = 'accepted' WHERE id = $1`, [invitationId]);
}
