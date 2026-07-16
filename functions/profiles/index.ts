import { query } from '../shared/db';
import { endpoint } from '../shared/endpoint';
import { isOrgAdminOfAny } from '../shared/profile';

const PROFILE_COLUMNS = 'id, full_name, first_name, last_name, department, email, avatar_url, is_platform_admin, created_at';
const PROFILE_COLUMNS_PREFIXED = 'p.id, p.full_name, p.first_name, p.last_name, p.department, p.email, p.avatar_url, p.is_platform_admin, p.created_at';

export default endpoint('profiles', async ({ req, profile, reply }) => {
  const body = await req.json() as { userIds?: unknown };
  const { userIds } = body;

  // Validate userIds if present
  if (userIds !== undefined) {
    if (!Array.isArray(userIds) || !userIds.every((v) => typeof v === 'string')) {
      return reply(400, { error: 'userIds must be an array of strings' });
    }
  }

  const validatedUserIds = userIds as string[] | undefined;

  // Tier 1: Platform admin
  if (profile.is_platform_admin) {
    let rows: unknown[];
    if (validatedUserIds) {
      rows = await query(
        `SELECT ${PROFILE_COLUMNS} FROM profiles WHERE id = ANY($1::uuid[]) ORDER BY full_name`,
        [validatedUserIds],
      );
    } else {
      rows = await query(
        `SELECT ${PROFILE_COLUMNS} FROM profiles ORDER BY full_name`,
      );
    }
    return reply(200, { profiles: rows });
  }

  // Tier 2: Org admin of at least one org
  if (await isOrgAdminOfAny(profile.id)) {
    let rows: unknown[];
    if (validatedUserIds) {
      rows = await query(
        `SELECT DISTINCT ${PROFILE_COLUMNS_PREFIXED}
         FROM profiles p
         JOIN org_memberships om ON om.user_id = p.id  -- no status filter: org admins manage their full roster incl. invited/disabled members
         JOIN org_memberships my ON my.org_id = om.org_id
         WHERE my.user_id = $1 AND my.role = 'org_admin' AND my.status = 'active'
         AND p.id = ANY($2::uuid[])
         ORDER BY p.full_name`,
        [profile.id, validatedUserIds],
      );
    } else {
      rows = await query(
        `SELECT DISTINCT ${PROFILE_COLUMNS_PREFIXED}
         FROM profiles p
         JOIN org_memberships om ON om.user_id = p.id  -- no status filter: org admins manage their full roster incl. invited/disabled members
         JOIN org_memberships my ON my.org_id = om.org_id
         WHERE my.user_id = $1 AND my.role = 'org_admin' AND my.status = 'active'
         ORDER BY p.full_name`,
        [profile.id],
      );
    }
    return reply(200, { profiles: rows });
  }

  // Tier 3: Plain learner — own profile only
  const rows = await query(
    `SELECT ${PROFILE_COLUMNS} FROM profiles WHERE id = $1`,
    [profile.id],
  );
  return reply(200, { profiles: rows });
});
