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

    const body = await req.json() as { courseId?: unknown; title?: unknown };
    const { courseId, title } = body;

    if (!courseId || typeof courseId !== 'string') {
      return corsResponse(origin, 400, { error: 'courseId is required' });
    }

    if (!title || typeof title !== 'string' || (title as string).trim() === '') {
      return corsResponse(origin, 400, { error: 'title is required' });
    }

    // sort_order is server-owned (issue #46): computed as MAX+1 within the course
    // inside the INSERT. Any client-supplied sortOrder is ignored — array-length
    // ranks from the client collided after delete-middle-then-add.
    const module_ = await queryOne(
      `INSERT INTO course_modules (course_id, title, sort_order)
       VALUES ($1, $2, (SELECT COALESCE(MAX(sort_order) + 1, 0) FROM course_modules WHERE course_id = $1))
       RETURNING *`,
      [courseId, title], // title stored raw — trim is validation-only (course-create parity)
    );

    return corsResponse(origin, 200, { module: module_ });
  } catch (err: unknown) {
    return internalError(context, origin, err);
  }
}

export default handler;
app.http('module-create', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
