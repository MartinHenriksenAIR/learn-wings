import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { query } from '../shared/db';
import { corsPreflightResponse, corsResponse } from '../shared/cors';
import { internalError } from '../shared/errors';
import { getProfile, isActiveMember } from '../shared/profile';

async function handler(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin);
  try {
    const user = await authenticate(req);
    const profile = await getProfile(user);
    if (!profile) return corsResponse(origin, 401, { error: 'Profile not found' });

    const body = await req.json() as { orgId?: unknown };
    const { orgId } = body;

    if (!orgId || typeof orgId !== 'string') {
      return corsResponse(origin, 400, { error: 'orgId is required' });
    }

    // Authorization: platform admin OR active member of the org
    const authorized = profile.is_platform_admin || await isActiveMember(profile.id, orgId);
    if (!authorized) return corsResponse(origin, 403, { error: 'Forbidden' });

    // Distinct, non-empty tags from the org's ideas that are VISIBLE to the caller
    // (drafts are author-private). $1 = orgId, $2 = caller profile id.
    const rows = await query<{ tag: string }>(`
      SELECT DISTINCT unnest(tags) AS tag
      FROM ideas
      WHERE org_id = $1
        AND (status <> 'draft' OR user_id = $2)
        AND tags IS NOT NULL
      ORDER BY tag ASC
    `, [orgId, profile.id]);

    const tags = rows
      .map((r) => r.tag)
      .filter((t): t is string => typeof t === 'string' && t.length > 0);

    return corsResponse(origin, 200, { tags });
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message });
    return internalError(context, origin, err);
  }
}

export default handler;
app.http('idea-tags', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
