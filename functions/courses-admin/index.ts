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

    const [courses, accessRecords] = await Promise.all([
      query(`SELECT * FROM courses ORDER BY created_at DESC`),
      query(`SELECT * FROM org_course_access`),
    ]);

    return corsResponse(origin, 200, { courses, accessRecords });
  } catch (err: unknown) {
    return internalError(context, origin, err);
  }
}

export default handler;
app.http('courses-admin', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
