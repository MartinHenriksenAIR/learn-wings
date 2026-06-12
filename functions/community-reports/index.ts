import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { query } from '../shared/db';
import { corsPreflightResponse, corsResponse } from '../shared/cors';
import { getProfile, isOrgAdmin } from '../shared/profile';

async function handler(req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin) as HttpResponseInit;
  try {
    const user = await authenticate(req);
    const profile = await getProfile(user);
    if (!profile) return corsResponse(origin, 401, { error: 'Profile not found' }) as HttpResponseInit;

    const body = await req.json() as {
      orgId?: unknown;
      scope?: unknown;
      status?: unknown;
    };
    const { orgId, scope, status } = body;

    if (orgId !== undefined && typeof orgId !== 'string') {
      return corsResponse(origin, 400, { error: 'orgId must be a string' }) as HttpResponseInit;
    }
    if (scope !== undefined && scope !== 'global') {
      return corsResponse(origin, 400, { error: "scope must be 'global'" }) as HttpResponseInit;
    }
    if (status !== undefined && status !== 'pending' && status !== 'reviewed' && status !== 'dismissed') {
      return corsResponse(origin, 400, { error: "status must be 'pending', 'reviewed', or 'dismissed'" }) as HttpResponseInit;
    }
    if (orgId !== undefined && scope !== undefined) {
      return corsResponse(origin, 400, { error: 'Provide orgId or scope, not both' }) as HttpResponseInit;
    }

    // Authorization
    const whereClauses: string[] = [];
    const params: unknown[] = [];

    if (orgId !== undefined) {
      // orgId mode: platform admin or org admin
      const canAccess = profile.is_platform_admin || await isOrgAdmin(profile.id, orgId as string);
      if (!canAccess) return corsResponse(origin, 403, { error: 'Forbidden' }) as HttpResponseInit;
      params.push(orgId);
      whereClauses.push(`r.org_id = $${params.length}`);
    } else if (scope === 'global') {
      // global scope: platform admin only
      if (!profile.is_platform_admin) return corsResponse(origin, 403, { error: 'Forbidden' }) as HttpResponseInit;
      whereClauses.push('r.org_id IS NULL');
    } else {
      // no filter: platform admin only (documented deviation — tighter than RLS)
      if (!profile.is_platform_admin) return corsResponse(origin, 403, { error: 'Forbidden' }) as HttpResponseInit;
    }

    if (status !== undefined) {
      params.push(status);
      whereClauses.push(`r.status = $${params.length}`);
    }

    const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const reports = await query(
      `SELECT r.*,
        json_build_object('id', rep.id, 'full_name', rep.full_name) AS reporter,
        CASE WHEN rev.id IS NULL THEN NULL ELSE json_build_object('id', rev.id, 'full_name', rev.full_name) END AS reviewer
       FROM community_reports r
       JOIN profiles rep ON rep.id = r.reporter_user_id
       LEFT JOIN profiles rev ON rev.id = r.reviewed_by
       ${whereClause} ORDER BY r.created_at DESC`,
      params,
    );

    return corsResponse(origin, 200, { reports }) as HttpResponseInit;
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message }) as HttpResponseInit;
    return corsResponse(origin, 500, { error: err instanceof Error ? err.message : 'Unknown error' }) as HttpResponseInit;
  }
}

export default handler;
app.http('community-reports', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
