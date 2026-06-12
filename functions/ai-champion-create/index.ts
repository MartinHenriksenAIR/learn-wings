import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { queryOne, isUniqueViolation } from '../shared/db';
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

    // Validation first, authz second, db third (mirrors org-membership-create).
    if (!orgId || typeof orgId !== 'string') {
      return corsResponse(origin, 400, { error: 'orgId is required' });
    }
    if (!userId || typeof userId !== 'string') {
      return corsResponse(origin, 400, { error: 'userId is required' });
    }

    // Authorization: platform admin OR org admin of the target org.
    // RLS provenance: supabase/migrations/20260202125422_*.sql —
    // "Platform admins can manage all AI champions" (is_platform_admin())
    // + "Org admins can manage AI champions" (is_org_admin(org_id)), both FOR ALL.
    const authorized = profile.is_platform_admin || await isOrgAdmin(profile.id, orgId);
    if (!authorized) return corsResponse(origin, 403, { error: 'Forbidden' });

    try {
      // assigned_by is the CALLER's profile id, server-derived — never client-supplied
      // (the old client sent the Entra OID; issue #11 audit item).
      const champion = await queryOne(
        `INSERT INTO ai_champions (user_id, org_id, assigned_by)
         VALUES ($1, $2, $3)
         RETURNING id, user_id, org_id, assigned_by, assigned_at`,
        [userId, orgId, profile.id],
      );
      return corsResponse(origin, 200, { champion });
    } catch (dbErr: unknown) {
      if (isUniqueViolation(dbErr)) {
        return corsResponse(origin, 409, { error: 'User is already an AI Champion in this organization' });
      }
      if ((dbErr as { code?: string })?.code === '23503') {
        return corsResponse(origin, 404, { error: 'Organization or user not found' });
      }
      throw dbErr;
    }
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message });
    return internalError(context, origin, err);
  }
}

export default handler;
app.http('ai-champion-create', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
