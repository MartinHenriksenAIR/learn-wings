import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { queryOne } from '../shared/db';
import { corsPreflightResponse, corsResponse } from '../shared/cors';
import { getProfile, isOrgAdmin } from '../shared/profile';

const ALLOWED_STATUSES = new Set(['enrolled', 'completed']);

async function handler(req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin) as HttpResponseInit;
  try {
    const user = await authenticate(req);
    const profile = await getProfile(user);
    if (!profile) return corsResponse(origin, 401, { error: 'Profile not found' }) as HttpResponseInit;

    const body = await req.json() as { orgId?: unknown; userId?: unknown; courseId?: unknown; status?: unknown };
    const { orgId, userId, courseId, status } = body;

    // Validation first, authz second, db third (mirrors org-membership-create).
    if (!orgId || typeof orgId !== 'string') {
      return corsResponse(origin, 400, { error: 'orgId is required' }) as HttpResponseInit;
    }
    if (!userId || typeof userId !== 'string') {
      return corsResponse(origin, 400, { error: 'userId is required' }) as HttpResponseInit;
    }
    if (!courseId || typeof courseId !== 'string') {
      return corsResponse(origin, 400, { error: 'courseId is required' }) as HttpResponseInit;
    }
    if (status !== undefined && (typeof status !== 'string' || !ALLOWED_STATUSES.has(status))) {
      return corsResponse(origin, 400, { error: 'status must be one of: enrolled, completed' }) as HttpResponseInit;
    }

    // Authorization: platform admin OR org admin of the target org.
    // RLS provenance: supabase/migrations/20260127153401_*.sql —
    // "Platform admins can do everything with enrollments" (is_platform_admin()).
    // The RLS schema only grants org admins SELECT on enrollments; this slice introduces
    // the admin-driven INSERT write path (used by EnrollUserDialog), authorized server-side
    // via isOrgAdmin to match the suite's admin-create convention.
    const authorized = profile.is_platform_admin || await isOrgAdmin(profile.id, orgId);
    if (!authorized) return corsResponse(origin, 403, { error: 'Forbidden' }) as HttpResponseInit;

    // Course-precondition: course must exist and be published.
    const course = await queryOne<{ is_published: boolean }>(
      `SELECT is_published FROM courses WHERE id = $1`,
      [courseId],
    );
    if (!course) {
      return corsResponse(origin, 404, { error: 'Course not found' }) as HttpResponseInit;
    }
    if (!course.is_published) {
      return corsResponse(origin, 400, { error: 'Course is not published' }) as HttpResponseInit;
    }

    // Org-access precondition: only enforced for non-platform admins (platform admins override).
    if (!profile.is_platform_admin) {
      const access = await queryOne<{ exists: number }>(
        `SELECT 1 AS exists FROM org_course_access WHERE org_id = $1 AND course_id = $2 AND access = 'enabled'`,
        [orgId, courseId],
      );
      if (!access) {
        return corsResponse(origin, 403, { error: 'Organization does not have access to this course' }) as HttpResponseInit;
      }
    }

    const effectiveStatus = status ?? 'enrolled';

    try {
      const enrollment = await queryOne(
        `INSERT INTO enrollments (org_id, user_id, course_id, status)
         VALUES ($1, $2, $3, $4)
         RETURNING id, org_id, user_id, course_id, status, enrolled_at, completed_at`,
        [orgId, userId, courseId, effectiveStatus],
      );
      return corsResponse(origin, 200, { enrollment }) as HttpResponseInit;
    } catch (dbErr: unknown) {
      const code = (dbErr as { code?: string })?.code;
      if (code === '23505') {
        return corsResponse(origin, 409, { error: 'User is already enrolled in this course' }) as HttpResponseInit;
      }
      if (code === '23503') {
        return corsResponse(origin, 404, { error: 'User or course not found' }) as HttpResponseInit;
      }
      throw dbErr;
    }
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message }) as HttpResponseInit;
    return corsResponse(origin, 500, { error: err instanceof Error ? err.message : 'Unknown error' }) as HttpResponseInit;
  }
}

export default handler;
app.http('enrollment-create', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
