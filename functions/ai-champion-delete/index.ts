import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { query } from '../shared/db';
import { corsPreflightResponse, corsResponse } from '../shared/cors';
import { internalError } from '../shared/errors';
import { getProfile, isOrgAdmin } from '../shared/profile';

async function handler(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin);
  try {
    const user = await authenticate(req);
    const profile = await getProfile(user);
    if (!profile) return corsResponse(origin, 401, { error: 'Profile not found' });

    const body = await req.json() as { orgId?: unknown; userId?: unknown };
    const { orgId, userId } = body;

    if (!orgId || typeof orgId !== 'string') {
      return corsResponse(origin, 400, { error: 'orgId is required' });
    }
    if (!userId || typeof userId !== 'string') {
      return corsResponse(origin, 400, { error: 'userId is required' });
    }

    // Authorization: platform admin OR org admin of the target org.
    // RLS provenance: supabase/migrations/20260202125422_*.sql —
    // "Platform admins can manage all AI champions" + "Org admins can manage AI champions" (FOR ALL).
    // No lookup-then-404 (unlike org-membership-delete): orgId is client-supplied and scopes the
    // DELETE directly, and Supabase zero-row deletes reported success — idempotent 200 is parity.
    const authorized = profile.is_platform_admin || await isOrgAdmin(profile.id, orgId);
    if (!authorized) return corsResponse(origin, 403, { error: 'Forbidden' });

    // Blind delete — idempotent (Supabase zero-row-delete parity); see idea-vote-remove.
    await query(
      `DELETE FROM ai_champions WHERE user_id = $1 AND org_id = $2`,
      [userId, orgId],
    );

    return corsResponse(origin, 200, { ok: true });
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message });
    return internalError(context, origin, err);
  }
}

export default handler;
app.http('ai-champion-delete', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
