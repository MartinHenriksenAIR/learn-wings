import { queryOne } from '../shared/db';
import { endpoint } from '../shared/endpoint';
import { isActiveMember, isOrgAdmin } from '../shared/profile';
import { profileJson } from '../shared/profile-json';

interface PostRow {
  id: string;
  scope: 'org' | 'global';
  org_id: string | null;
  user_id: string;
  is_hidden: boolean;
  category_id: string;
  [key: string]: unknown;
}

export default endpoint('community-post', async ({ req, profile, reply }) => {
  const body = await req.json() as { postId?: unknown };
  const { postId } = body;

  if (!postId || typeof postId !== 'string') {
    return reply(400, { error: 'postId is required' });
  }

  const post = await queryOne<PostRow>(`
    SELECT p.*,
      row_to_json(c.*) AS category,
      ${profileJson('pr')} AS profile,
      CASE WHEN o.id IS NULL THEN NULL ELSE json_build_object('id', o.id, 'name', o.name) END AS organization
    FROM community_posts p
    JOIN community_categories c ON c.id = p.category_id
    JOIN profiles pr ON pr.id = p.user_id
    LEFT JOIN organizations o ON o.id = p.org_id
    WHERE p.id = $1
  `, [postId]);

  // Not found → null (parity with Supabase .maybeSingle())
  if (!post) return reply(200, { post: null });

  // Scope visibility check
  if (post.scope === 'org') {
    const canAccess = profile.is_platform_admin ||
      await isActiveMember(profile.id, post.org_id!);
    if (!canAccess) return reply(200, { post: null });
  }

  // Hidden visibility check
  if (post.is_hidden) {
    const canSeeHidden = profile.is_platform_admin ||
      (post.scope === 'org' && await isOrgAdmin(profile.id, post.org_id!));
    if (!canSeeHidden) return reply(200, { post: null });
  }

  return reply(200, { post });
});
