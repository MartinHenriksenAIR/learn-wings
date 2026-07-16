import { query } from '../shared/db';
import { endpoint } from '../shared/endpoint';

export default endpoint('community-reports', async ({ req, reply, requireOrgAdmin, requirePlatformAdmin }) => {
  const body = await req.json() as {
    orgId?: unknown;
    scope?: unknown;
    status?: unknown;
  };
  const { orgId, scope, status } = body;

  if (orgId !== undefined && typeof orgId !== 'string') {
    return reply(400, { error: 'orgId must be a string' });
  }
  if (scope !== undefined && scope !== 'global') {
    return reply(400, { error: "scope must be 'global'" });
  }
  if (status !== undefined && status !== 'pending' && status !== 'reviewed' && status !== 'dismissed') {
    return reply(400, { error: "status must be 'pending', 'reviewed', or 'dismissed'" });
  }
  if (orgId !== undefined && scope !== undefined) {
    return reply(400, { error: 'Provide orgId or scope, not both' });
  }

  // Authorization
  const whereClauses: string[] = [];
  const params: unknown[] = [];

  if (orgId !== undefined) {
    // orgId mode: platform admin or org admin
    await requireOrgAdmin(orgId as string);
    params.push(orgId);
    whereClauses.push(`r.org_id = $${params.length}`);
  } else if (scope === 'global') {
    // global scope: platform admin only
    requirePlatformAdmin();
    whereClauses.push('r.org_id IS NULL');
  } else {
    // no filter: platform admin only (documented deviation — tighter than RLS)
    requirePlatformAdmin();
  }

  if (status !== undefined) {
    params.push(status);
    whereClauses.push(`r.status = $${params.length}`);
  }

  const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  // post_id: for comment targets we join out the comment's parent post so the
  // moderation UIs can deep-link /posts/<post_id>#comment-<target_id> (#86).
  // NULL for post targets, and NULL for orphaned comment reports (comment
  // deleted) — the frontend disables the link in that case.
  const reports = await query(
    `SELECT r.*,
      json_build_object('id', rep.id, 'full_name', rep.full_name) AS reporter,
      CASE WHEN rev.id IS NULL THEN NULL ELSE json_build_object('id', rev.id, 'full_name', rev.full_name) END AS reviewer,
      CASE WHEN r.target_type = 'comment' THEN tc.post_id ELSE NULL END AS post_id
     FROM community_reports r
     JOIN profiles rep ON rep.id = r.reporter_user_id
     LEFT JOIN profiles rev ON rev.id = r.reviewed_by
     LEFT JOIN community_comments tc ON r.target_type = 'comment' AND tc.id = r.target_id
     ${whereClause} ORDER BY r.created_at DESC`,
    params,
  );

  return reply(200, { reports });
});
