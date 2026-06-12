import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { query } from '../shared/db';
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
    };

    const { orgId } = body;

    if (!orgId || typeof orgId !== 'string') {
      return corsResponse(origin, 400, { error: 'orgId is required' });
    }

    const records = await query(
      `INSERT INTO org_course_access (org_id, course_id, access)
       SELECT $1, c.id, 'enabled' FROM courses c WHERE c.is_published = true
       ON CONFLICT (org_id, course_id) DO UPDATE SET access = 'enabled'
       RETURNING *`,
      [orgId],
    );

    return corsResponse(origin, 200, { records });
  } catch (err: unknown) {
    return internalError(context, origin, err);
  }
}

export default handler;
app.http('course-access-bulk', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
