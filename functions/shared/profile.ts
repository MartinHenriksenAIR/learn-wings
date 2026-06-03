import type { AuthUser } from './auth';
import { queryOne } from './db';

/**
 * Deliberately minimal — endpoints needing more profile fields (full_name, email, avatar_url) must query them explicitly; widening this interface requires widening getProfile's SELECT in lockstep.
 */
export interface CallerProfile {
  id: string;
  is_platform_admin: boolean;
}

/** Resolve the caller's DB profile from their Entra identity. Null if not provisioned yet. */
export async function getProfile(user: AuthUser): Promise<CallerProfile | null> {
  return queryOne<CallerProfile>(
    `SELECT id, is_platform_admin FROM profiles WHERE entra_oid = $1 AND entra_tid = $2`,
    [user.id, user.tid],
  );
}

/** True if profileId has an active membership in orgId (any role). */
export async function isActiveMember(profileId: string, orgId: string): Promise<boolean> {
  const row = await queryOne<{ ok: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM org_memberships WHERE user_id = $1 AND org_id = $2 AND status = 'active') AS ok`,
    [profileId, orgId],
  );
  return row?.ok ?? false;
}

/** True if profileId is an active org_admin of orgId. */
export async function isOrgAdmin(profileId: string, orgId: string): Promise<boolean> {
  const row = await queryOne<{ ok: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM org_memberships WHERE user_id = $1 AND org_id = $2 AND role = 'org_admin' AND status = 'active') AS ok`,
    [profileId, orgId],
  );
  return row?.ok ?? false;
}
