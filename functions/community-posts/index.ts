import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { query } from '../shared/db';
import { corsPreflightResponse, corsResponse } from '../shared/cors';
import { getProfile, isActiveMember, isOrgAdmin } from '../shared/profile';

async function handler(req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin);
  try {
    const user = await authenticate(req);
    const profile = await getProfile(user);
    if (!profile) return corsResponse(origin, 401, { error: 'Profile not found' });

    const body = await req.json() as {
      scope?: unknown;
      orgId?: unknown;
      categoryId?: unknown;
      search?: unknown;
      tags?: unknown;
    };

    const { scope, orgId, categoryId, search, tags } = body;

    // Validate scope
    if (!scope || (scope !== 'org' && scope !== 'global')) {
      return corsResponse(origin, 400, { error: 'scope must be "org" or "global"' });
    }

    // Validate orgId for org scope
    if (scope === 'org' && (!orgId || typeof orgId !== 'string')) {
      return corsResponse(origin, 400, { error: 'orgId is required for org scope' });
    }

    // Validate optional params
    if (categoryId !== undefined && typeof categoryId !== 'string') {
      return corsResponse(origin, 400, { error: 'categoryId must be a string' });
    }
    if (search !== undefined && typeof search !== 'string') {
      return corsResponse(origin, 400, { error: 'search must be a string' });
    }
    if (tags !== undefined && (!Array.isArray(tags) || !tags.every((t) => typeof t === 'string'))) {
      return corsResponse(origin, 400, { error: 'tags must be an array of strings' });
    }

    const vScope = scope as 'org' | 'global';
    const vOrgId = orgId as string | undefined;
    const vCategoryId = categoryId as string | undefined;
    const vSearch = search as string | undefined;
    const vTags = tags as string[] | undefined;

    // Authorization
    if (vScope === 'org') {
      const authorized = profile.is_platform_admin || await isActiveMember(profile.id, vOrgId!);
      if (!authorized) return corsResponse(origin, 403, { error: 'Forbidden' });
    }

    // Hidden visibility
    const includeHidden = profile.is_platform_admin ||
      (vScope === 'org' && await isOrgAdmin(profile.id, vOrgId!));

    // Build dynamic WHERE + params
    const conditions: string[] = [];
    const params: unknown[] = [];

    // scope is always required
    params.push(vScope);
    conditions.push(`p.scope = $${params.length}`);

    if (vScope === 'org') {
      params.push(vOrgId!);
      conditions.push(`p.org_id = $${params.length}`);
    }

    if (!includeHidden) {
      conditions.push(`p.is_hidden = false`);
    }

    if (vCategoryId) {
      params.push(vCategoryId);
      conditions.push(`p.category_id = $${params.length}`);
    }

    if (vSearch) {
      params.push(vSearch);
      const n = params.length;
      conditions.push(`(p.title ILIKE '%'||$${n}||'%' OR p.content ILIKE '%'||$${n}||'%')`);
    }

    if (vTags && vTags.length > 0) {
      params.push(vTags);
      conditions.push(`p.tags && $${params.length}::text[]`);
    }

    // includeHidden as a boolean param for the comment_count subquery
    params.push(includeHidden);
    const kIndex = params.length;

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const posts = await query(`
      SELECT p.*,
        row_to_json(c.*) AS category,
        json_build_object('id', pr.id, 'full_name', pr.full_name) AS profile,
        CASE WHEN o.id IS NULL THEN NULL ELSE json_build_object('id', o.id, 'name', o.name) END AS organization,
        (SELECT count(*)::int FROM community_comments cc WHERE cc.post_id = p.id AND ($${kIndex} OR cc.is_hidden = false)) AS comment_count
      FROM community_posts p
      JOIN community_categories c ON c.id = p.category_id
      JOIN profiles pr ON pr.id = p.user_id
      LEFT JOIN organizations o ON o.id = p.org_id
      ${where}
      ORDER BY p.is_pinned DESC, p.created_at DESC
    `, params);

    return corsResponse(origin, 200, { posts });
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message });
    return corsResponse(origin, 500, { error: err instanceof Error ? err.message : 'Unknown error' });
  }
}

export default handler;
app.http('community-posts', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
