import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { queryOne } from '../shared/db';
import { corsPreflightResponse, corsResponse } from '../shared/cors';
import { getProfile, isActiveMember, isOrgAdmin } from '../shared/profile';

async function handler(req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin) as HttpResponseInit;
  try {
    const user = await authenticate(req);
    const profile = await getProfile(user);
    if (!profile) return corsResponse(origin, 401, { error: 'Profile not found' }) as HttpResponseInit;

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
      return corsResponse(origin, 400, { error: 'scope must be "org" or "global"' }) as HttpResponseInit;
    }

    // scope='org' requires orgId
    if (scope === 'org' && (!orgId || typeof orgId !== 'string')) {
      return corsResponse(origin, 400, { error: 'orgId is required for org scope' }) as HttpResponseInit;
    }

    // scope='global' must NOT have orgId (fail-fast before DB CHECK violation)
    if (scope === 'global' && orgId !== undefined && orgId !== null) {
      return corsResponse(origin, 400, { error: 'orgId must not be provided for global scope' }) as HttpResponseInit;
    }

    // Validate required fields
    if (!categoryId || typeof categoryId !== 'string') {
      return corsResponse(origin, 400, { error: 'categoryId is required' }) as HttpResponseInit;
    }
    if (!title || typeof title !== 'string') {
      return corsResponse(origin, 400, { error: 'title is required' }) as HttpResponseInit;
    }
    if (!content || typeof content !== 'string') {
      return corsResponse(origin, 400, { error: 'content is required' }) as HttpResponseInit;
    }

    // Validate optional fields
    if (tags !== undefined && (!Array.isArray(tags) || !tags.every((t) => typeof t === 'string'))) {
      return corsResponse(origin, 400, { error: 'tags must be an array of strings' }) as HttpResponseInit;
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
        if (!isMember) return corsResponse(origin, 403, { error: 'Forbidden' }) as HttpResponseInit;
      }
      // global scope is open to all profiles (no extra check needed beyond having a profile)
    }

    // Restricted-category gate
    const categoryRow = await queryOne<{ is_restricted: boolean }>(
      `SELECT is_restricted FROM community_categories WHERE id = $1`,
      [vCategoryId],
    );
    if (!categoryRow) return corsResponse(origin, 400, { error: 'Category not found' }) as HttpResponseInit;

    if (categoryRow.is_restricted) {
      if (vScope === 'global') {
        // Only platform admins can post in restricted categories globally
        if (!profile.is_platform_admin) {
          return corsResponse(origin, 403, { error: 'Forbidden' }) as HttpResponseInit;
        }
      } else {
        // scope='org': platform admin OR org admin
        const canPost = profile.is_platform_admin || await isOrgAdmin(profile.id, vOrgId!);
        if (!canPost) return corsResponse(origin, 403, { error: 'Forbidden' }) as HttpResponseInit;
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

    return corsResponse(origin, 200, { post }) as HttpResponseInit;
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message }) as HttpResponseInit;
    return corsResponse(origin, 500, { error: err instanceof Error ? err.message : 'Unknown error' }) as HttpResponseInit;
  }
}

export default handler;
app.http('community-post-create', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
