import { query } from '../shared/db';
import { endpoint } from '../shared/endpoint';
import { isOrgAdmin } from '../shared/profile';

export default endpoint('community-posts', async ({ req, profile, reply, requireActiveMember }) => {
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
      return reply(400, { error: 'scope must be "org" or "global"' });
    }

    // Validate orgId for org scope
    if (scope === 'org' && (!orgId || typeof orgId !== 'string')) {
      return reply(400, { error: 'orgId is required for org scope' });
    }

    // Validate optional params
    if (categoryId !== undefined && typeof categoryId !== 'string') {
      return reply(400, { error: 'categoryId must be a string' });
    }
    if (search !== undefined && typeof search !== 'string') {
      return reply(400, { error: 'search must be a string' });
    }
    if (tags !== undefined && (!Array.isArray(tags) || !tags.every((t) => typeof t === 'string'))) {
      return reply(400, { error: 'tags must be an array of strings' });
    }

    const vScope = scope as 'org' | 'global';
    const vOrgId = orgId as string | undefined;
    const vCategoryId = categoryId as string | undefined;
    const vSearch = search as string | undefined;
    const vTags = tags as string[] | undefined;

    // Authorization
    if (vScope === 'org') {
      await requireActiveMember(vOrgId!);
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

    return reply(200, { posts });
});
