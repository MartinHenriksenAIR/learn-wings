import { query } from '../shared/db';
import { endpoint } from '../shared/endpoint';
import { profileJson } from '../shared/profile-json';

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

export default endpoint('ideas', async ({ req, profile, reply, requireActiveMember }) => {
  const body = await req.json() as {
    orgId?: unknown;
    status?: unknown;
    businessArea?: unknown;
    tags?: unknown;
    search?: unknown;
    userId?: unknown;
  };

  const { orgId, status, businessArea, tags, search, userId } = body;

  if (!orgId || typeof orgId !== 'string') {
    return reply(400, { error: 'orgId is required' });
  }
  if (status !== undefined && !isStringArray(status)) {
    return reply(400, { error: 'status must be an array of strings' });
  }
  if (businessArea !== undefined && !isStringArray(businessArea)) {
    return reply(400, { error: 'businessArea must be an array of strings' });
  }
  if (tags !== undefined && !isStringArray(tags)) {
    return reply(400, { error: 'tags must be an array of strings' });
  }
  if (search !== undefined && typeof search !== 'string') {
    return reply(400, { error: 'search must be a string' });
  }
  if (userId !== undefined && typeof userId !== 'string') {
    return reply(400, { error: 'userId must be a string' });
  }

  const vStatus = status as string[] | undefined;
  const vBusinessArea = businessArea as string[] | undefined;
  const vTags = tags as string[] | undefined;
  const vSearch = search as string | undefined;
  const vUserId = userId as string | undefined;

  // Authorization: platform admin OR active member of the org
  await requireActiveMember(orgId);

  // Build dynamic WHERE + params
  const conditions: string[] = [];
  const params: unknown[] = [];

  // org scoping
  params.push(orgId);
  conditions.push(`i.org_id = $${params.length}`);

  // Draft-privacy rule (CRITICAL): drafts are author-private for EVERY role,
  // no admin bypass. Deliberate, documented decision.
  params.push(profile.id);
  conditions.push(`(i.status <> 'draft' OR i.user_id = $${params.length})`);

  if (vStatus && vStatus.length > 0) {
    params.push(vStatus);
    // compare column cast to text so unknown labels yield no rows (parity with
    // the old client's .in()), rather than a PG enum-cast error (500).
    conditions.push(`i.status::text = ANY($${params.length}::text[])`);
  }

  if (vBusinessArea && vBusinessArea.length > 0) {
    params.push(vBusinessArea);
    conditions.push(`i.business_area::text = ANY($${params.length}::text[])`);
  }

  if (vTags && vTags.length > 0) {
    params.push(vTags);
    conditions.push(`i.tags && $${params.length}::text[]`);
  }

  if (vUserId) {
    params.push(vUserId);
    conditions.push(`i.user_id = $${params.length}`);
  }

  if (vSearch) {
    params.push(vSearch);
    const n = params.length;
    conditions.push(
      `(i.title ILIKE '%'||$${n}||'%' OR i.description ILIKE '%'||$${n}||'%' OR i.pain_points ILIKE '%'||$${n}||'%')`,
    );
  }

  const where = `WHERE ${conditions.join(' AND ')}`;

  const ideas = await query(`
    SELECT i.*,
      ${profileJson('pr')} AS profile,
      (SELECT count(*)::int FROM idea_comments c WHERE c.idea_id = i.id) AS comment_count,
      (SELECT count(*)::int FROM idea_votes v WHERE v.idea_id = i.id) AS vote_count
    FROM ideas i
    JOIN profiles pr ON pr.id = i.user_id
    ${where}
    ORDER BY i.created_at DESC
  `, params);

  return reply(200, { ideas });
});
