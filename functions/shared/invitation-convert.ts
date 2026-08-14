import type { PoolClient } from 'pg';


export interface ConvertibleInvitation {
  id: string;
  org_id: string | null;
  role: string;
}

export type ConvertResult =
  | { kind: 'org'; orgId: string; role: string; alreadyMember: boolean }
  | { kind: 'platform' };

export async function convertInvitation(
  client: PoolClient,
  invitation: ConvertibleInvitation,
  profileId: string,
): Promise<ConvertResult> {
  if (invitation.org_id === null) {
    await client.query(`UPDATE profiles SET is_platform_admin = true WHERE id = $1`, [profileId]);
    await markAccepted(client, invitation.id);
    return { kind: 'platform' };
  }

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
