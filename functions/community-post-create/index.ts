import { queryOne } from '../shared/db';
import { endpoint } from '../shared/endpoint';
import { isActiveMember } from '../shared/profile';

export default endpoint('community-post-create', async ({ req, profile, reply, requireOrgAdmin, requirePlatformAdmin }) => {
  const body = await req.json() as {
    scope?: unknown;
    orgId?: unknown;
    categoryId?: unknown;
    title?: unknown;
    content?: unknown;
    tags?: unknown;
    eventDate?: unknown;
    eventLocation?: unknown;
    eventRegistrationUrl?: unknown;
  };

  const { scope, orgId, categoryId, title, content, tags, eventDate, eventLocation, eventRegistrationUrl } = body;

  // Validate scope
  if (!scope || (scope !== 'org' && scope !== 'global')) {
    return reply(400, { error: 'scope must be "org" or "global"' });
  }

  // scope='org' requires orgId
  if (scope === 'org' && (!orgId || typeof orgId !== 'string')) {
    return reply(400, { error: 'orgId is required for org scope' });
  }

  // scope='global' must NOT have orgId (fail-fast before DB CHECK violation)
  if (scope === 'global' && orgId !== undefined && orgId !== null) {
    return reply(400, { error: 'orgId must not be provided for global scope' });
  }

  // Validate required fields
  if (!categoryId || typeof categoryId !== 'string') {
    return reply(400, { error: 'categoryId is required' });
  }
  if (!title || typeof title !== 'string') {
    return reply(400, { error: 'title is required' });
  }
  if (!content || typeof content !== 'string') {
    return reply(400, { error: 'content is required' });
  }

  // Validate optional fields
  if (tags !== undefined && (!Array.isArray(tags) || !tags.every((t) => typeof t === 'string'))) {
    return reply(400, { error: 'tags must be an array of strings' });
  }

  const vScope = scope as 'org' | 'global';
  const vOrgId = orgId as string | undefined;
  const vCategoryId = categoryId as string;
  const vTitle = title as string;
  const vContent = content as string;
  const vTags = (tags as string[] | undefined) ?? [];
  const vEventDate = (eventDate as string | null | undefined) ?? null;
  const vEventLocation = (eventLocation as string | null | undefined) ?? null;
  const vEventRegistrationUrl = (eventRegistrationUrl as string | null | undefined) ?? null;

  // Authorization: scope gate
  if (!profile.is_platform_admin) {
    if (vScope === 'org') {
      const isMember = await isActiveMember(profile.id, vOrgId!);
      if (!isMember) return reply(403, { error: 'Forbidden' });
    }
    // global scope is open to all profiles (no extra check needed beyond having a profile)
  }

  // Restricted-category gate
  const categoryRow = await queryOne<{ is_restricted: boolean }>(
    `SELECT is_restricted FROM community_categories WHERE id = $1`,
    [vCategoryId],
  );
  if (!categoryRow) return reply(400, { error: 'Category not found' });

  if (categoryRow.is_restricted) {
    if (vScope === 'global') {
      // Only platform admins can post in restricted categories globally
      requirePlatformAdmin();
    } else {
      // scope='org': platform admin OR org admin
      await requireOrgAdmin(vOrgId!);
    }
  }

  // Insert
  const post = await queryOne(
    `INSERT INTO community_posts
      (scope, org_id, user_id, category_id, title, content, tags,
       event_date, event_location, event_registration_url)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [vScope, vOrgId ?? null, profile.id, vCategoryId, vTitle, vContent, vTags,
     vEventDate, vEventLocation, vEventRegistrationUrl],
  );

  return reply(200, { post });
});
