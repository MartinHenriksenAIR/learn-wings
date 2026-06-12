import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { query } from '../shared/db';
import { corsPreflightResponse, corsResponse } from '../shared/cors';
import { internalError } from '../shared/errors';
import { getProfile } from '../shared/profile';

const COURSE_COLUMNS = 'id, title, description, level, is_published, thumbnail_url, created_by_user_id, created_at';
const COURSE_COLUMNS_PREFIXED = 'c.id, c.title, c.description, c.level, c.is_published, c.thumbnail_url, c.created_by_user_id, c.created_at';

async function handler(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin);
  try {
    const user = await authenticate(req);
    const profile = await getProfile(user);
    if (!profile) return corsResponse(origin, 401, { error: 'Profile not found' });

    const body = await req.json() as { courseIds?: unknown };
    const { courseIds } = body;

    // Validate courseIds if present
    if (courseIds !== undefined) {
      if (!Array.isArray(courseIds) || !courseIds.every((v) => typeof v === 'string')) {
        return corsResponse(origin, 400, { error: 'courseIds must be an array of strings' });
      }
    }

    const validatedCourseIds = courseIds as string[] | undefined;

    // Tier 1: Platform admin — all courses incl. unpublished
    if (profile.is_platform_admin) {
      let rows: unknown[];
      if (validatedCourseIds) {
        rows = await query(
          `SELECT ${COURSE_COLUMNS} FROM courses WHERE id = ANY($1::uuid[]) ORDER BY title`,
          [validatedCourseIds],
        );
      } else {
        rows = await query(
          `SELECT ${COURSE_COLUMNS} FROM courses ORDER BY title`,
        );
      }
      return corsResponse(origin, 200, { courses: rows });
    }

    // Tier 2: Everyone else — published courses with enabled org access and active membership
    let rows: unknown[];
    if (validatedCourseIds) {
      rows = await query(
        `SELECT DISTINCT ${COURSE_COLUMNS_PREFIXED}
           FROM courses c
           JOIN org_course_access oca ON oca.course_id = c.id AND oca.access = 'enabled'
           JOIN org_memberships om ON om.org_id = oca.org_id
          WHERE om.user_id = $1 AND om.status = 'active' AND c.is_published = TRUE
            AND c.id = ANY($2::uuid[])
          ORDER BY c.title`,
        [profile.id, validatedCourseIds],
      );
    } else {
      rows = await query(
        `SELECT DISTINCT ${COURSE_COLUMNS_PREFIXED}
           FROM courses c
           JOIN org_course_access oca ON oca.course_id = c.id AND oca.access = 'enabled'
           JOIN org_memberships om ON om.org_id = oca.org_id
          WHERE om.user_id = $1 AND om.status = 'active' AND c.is_published = TRUE
          ORDER BY c.title`,
        [profile.id],
      );
    }
    return corsResponse(origin, 200, { courses: rows });
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message });
    return internalError(context, origin, err);
  }
}

export default handler;
app.http('courses', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
