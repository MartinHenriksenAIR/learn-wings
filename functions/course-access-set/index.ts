import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { queryOne } from '../shared/db';
import { corsPreflightResponse, corsResponse } from '../shared/cors';
import { internalError } from '../shared/errors';
import { requirePlatformAdmin } from '../shared/guards';

async function handler(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin);
  try {
    const gate = await requirePlatformAdmin(req, origin);
    if (!gate.ok) return gate.response;

    const body = await req.json() as {
      orgId?: unknown;
      courseId?: unknown;
      access?: unknown;
    };

    const { orgId, courseId, access } = body;

    if (!orgId || typeof orgId !== 'string') {
      return corsResponse(origin, 400, { error: 'orgId is required' });
    }

    if (!courseId || typeof courseId !== 'string') {
      return corsResponse(origin, 400, { error: 'courseId is required' });
    }

    if (access !== 'enabled' && access !== 'disabled') {
      return corsResponse(origin, 400, { error: "access must be 'enabled' or 'disabled'" });
    }

    const record = await queryOne(
      `INSERT INTO org_course_access (org_id, course_id, access)
       VALUES ($1, $2, $3)
       ON CONFLICT (org_id, course_id) DO UPDATE SET access = EXCLUDED.access
       RETURNING *`,
      [orgId, courseId, access],
    );

    return corsResponse(origin, 200, { record });
  } catch (err: unknown) {
    return internalError(context, origin, err);
  }
}

export default handler;
app.http('course-access-set', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
