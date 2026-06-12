import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { query } from '../shared/db';
import { corsPreflightResponse, corsResponse } from '../shared/cors';
import { getProfile, isOrgAdmin } from '../shared/profile';

async function handler(req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin);
  try {
    const user = await authenticate(req);
    const profile = await getProfile(user);
    if (!profile) return corsResponse(origin, 401, { error: 'Profile not found' });

    const body = await req.json() as { orgId?: unknown; userId?: unknown; courseId?: unknown };
    const { orgId, userId, courseId } = body;

    // Validate: any present field must be a non-empty string
    if (orgId !== undefined && (typeof orgId !== 'string' || orgId === '')) {
      return corsResponse(origin, 400, { error: 'orgId must be a string' });
    }
    if (userId !== undefined && (typeof userId !== 'string' || userId === '')) {
      return corsResponse(origin, 400, { error: 'userId must be a string' });
    }
    if (courseId !== undefined && (typeof courseId !== 'string' || courseId === '')) {
      return corsResponse(origin, 400, { error: 'courseId must be a string' });
    }

    // Narrowed typed locals — runtime guards above guarantee these are string | undefined
    const vOrgId = orgId as string | undefined;
    const vUserId = userId as string | undefined;
    const vCourseId = courseId as string | undefined;

    const conditions: string[] = [];
    const params: unknown[] = [];
    const add = (col: string, val: unknown) => {
      params.push(val);
      conditions.push(`${col} = $${params.length}`);
    };

    if (profile.is_platform_admin) {
      // Tier 1: Platform admin — apply filters exactly as given
      if (vOrgId) add('org_id', vOrgId);
      if (vUserId) add('user_id', vUserId);
      if (vCourseId) add('course_id', vCourseId);
    } else if (vOrgId && await isOrgAdmin(profile.id, vOrgId)) {
      // Tier 2: Org admin scope — vOrgId is guaranteed non-empty by the branch condition
      add('org_id', vOrgId);
      if (vUserId) add('user_id', vUserId);
      if (vCourseId) add('course_id', vCourseId);
    } else {
      // Tier 3: Self scope — force user_id = profile.id, ignore client-supplied userId.
      // No 403 for unrecognised tiers: READ endpoint uses scoped-down access rather than rejection.
      add('user_id', profile.id);
      if (vOrgId) add('org_id', vOrgId);
      if (vCourseId) add('course_id', vCourseId);
    }

    const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
    const rows = await query(
      `SELECT id, org_id, user_id, course_id, status, enrolled_at, completed_at FROM enrollments${where} ORDER BY enrolled_at DESC`,
      params,
    );

    return corsResponse(origin, 200, { enrollments: rows });
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message });
    return corsResponse(origin, 500, { error: err instanceof Error ? err.message : 'Unknown error' });
  }
}

export default handler;
app.http('enrollments', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
