import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { queryOne } from '../shared/db';
import { corsPreflightResponse, corsResponse } from '../shared/cors';
import { getProfile, isActiveMember, isOrgAdmin } from '../shared/profile';

interface PostRow {
  id: string;
  scope: 'org' | 'global';
  org_id: string | null;
  user_id: string;
  is_hidden: boolean;
  category_id: string;
  [key: string]: unknown;
}

async function handler(req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin);
  try {
    const user = await authenticate(req);
    const profile = await getProfile(user);
    if (!profile) return corsResponse(origin, 401, { error: 'Profile not found' });

    const body = await req.json() as { postId?: unknown };
    const { postId } = body;

    if (!postId || typeof postId !== 'string') {
      return corsResponse(origin, 400, { error: 'postId is required' });
    }

    const post = await queryOne<PostRow>(`
      SELECT p.*,
        row_to_json(c.*) AS category,
        json_build_object('id', pr.id, 'full_name', pr.full_name) AS profile,
        CASE WHEN o.id IS NULL THEN NULL ELSE json_build_object('id', o.id, 'name', o.name) END AS organization
      FROM community_posts p
      JOIN community_categories c ON c.id = p.category_id
      JOIN profiles pr ON pr.id = p.user_id
      LEFT JOIN organizations o ON o.id = p.org_id
      WHERE p.id = $1
    `, [postId]);

    // Not found → null (parity with Supabase .maybeSingle())
    if (!post) return corsResponse(origin, 200, { post: null });

    // Scope visibility check
    if (post.scope === 'org') {
      const canAccess = profile.is_platform_admin ||
        await isActiveMember(profile.id, post.org_id!);
      if (!canAccess) return corsResponse(origin, 200, { post: null });
    }

    // Hidden visibility check
    if (post.is_hidden) {
      const canSeeHidden = profile.is_platform_admin ||
        (post.scope === 'org' && await isOrgAdmin(profile.id, post.org_id!));
      if (!canSeeHidden) return corsResponse(origin, 200, { post: null });
    }

    return corsResponse(origin, 200, { post });
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message });
    return corsResponse(origin, 500, { error: err instanceof Error ? err.message : 'Unknown error' });
  }
}

export default handler;
app.http('community-post', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
