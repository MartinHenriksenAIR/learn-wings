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

    const body = await req.json() as { orgId?: unknown; userId?: unknown; courseId?: unknown };
    const { orgId, userId, courseId } = body;

    // Validate: any present field must be a non-empty string
    if (orgId !== undefined && (typeof orgId !== 'string' || orgId === '')) {
      return corsResponse(origin, 400, { error: 'orgId must be a string' }) as HttpResponseInit;
    }
    if (userId !== undefined && (typeof userId !== 'string' || userId === '')) {
      return corsResponse(origin, 400, { error: 'userId must be a string' }) as HttpResponseInit;
    }
    if (courseId !== undefined && (typeof courseId !== 'string' || courseId === '')) {
      return corsResponse(origin, 400, { error: 'courseId must be a string' }) as HttpResponseInit;
    }

    const conditions: string[] = [];
    const params: unknown[] = [];
    const add = (col: string, val: unknown) => {
      params.push(val);
      conditions.push(`${col} = $${params.length}`);
    };

    if (profile.is_platform_admin) {
      // Tier 1: Platform admin — apply filters exactly as given
      if (orgId) add('org_id', orgId);
      if (userId) add('user_id', userId);
      if (courseId) add('course_id', courseId);
    } else if (orgId && await isOrgAdmin(profile.id, orgId as string)) {
      // Tier 2: Org admin scope — scoped to that org
      add('org_id', orgId);
      if (userId) add('user_id', userId);
      if (courseId) add('course_id', courseId);
    } else {
      // Tier 3: Self scope — force user_id = profile.id, ignore client-supplied userId
      add('user_id', profile.id);
      if (orgId) add('org_id', orgId);
      if (courseId) add('course_id', courseId);
    }

    const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
    const rows = await query(
      `SELECT id, org_id, user_id, course_id, status, enrolled_at, completed_at FROM enrollments${where} ORDER BY enrolled_at DESC`,
      params,
    );

    return corsResponse(origin, 200, { enrollments: rows }) as HttpResponseInit;
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message }) as HttpResponseInit;
    return corsResponse(origin, 500, { error: err instanceof Error ? err.message : 'Unknown error' }) as HttpResponseInit;
  }
}

export default handler;
app.http('enrollments', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
