import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { queryOne } from '../shared/db';
import { getProfile, isOrgAdmin } from '../shared/profile';
import { corsPreflightResponse, corsResponse } from '../shared/cors';
import { internalError } from '../shared/errors';

async function handler(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin);
  try {
    // 1. Authenticate
    const user = await authenticate(req);

    // 2. Resolve profile
    const profile = await getProfile(user);
    if (!profile) return corsResponse(origin, 401, { error: 'Profile not found' });

    // 3. Validate orgId
    const { orgId } = await req.json() as { orgId?: string };
    if (!orgId || typeof orgId !== 'string') {
      return corsResponse(origin, 400, { error: 'orgId is required' });
    }

    // 4. Authorize: platform admin OR org admin
    const authorized = profile.is_platform_admin || await isOrgAdmin(profile.id, orgId);
    if (!authorized) return corsResponse(origin, 403, { error: 'Forbidden' });

    // 5. Query the real table
    const row = await queryOne<{ link_id: string }>(
      `SELECT link_id
         FROM invitations
        WHERE org_id = $1 AND status = 'pending' AND expires_at > NOW() AND link_id IS NOT NULL
        ORDER BY created_at DESC
        LIMIT 1`,
      [orgId],
    );

    return corsResponse(origin, 200, { linkId: row?.link_id ?? null });
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message });
    return internalError(context, origin, err);
  }
}

export default handler;
app.http('invitation-link', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
