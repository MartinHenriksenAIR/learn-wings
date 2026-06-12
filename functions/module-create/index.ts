import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { queryOne } from '../shared/db';
import { corsPreflightResponse, corsResponse } from '../shared/cors';
import { requirePlatformAdmin } from '../shared/guards';

async function handler(req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin);
  try {
    const gate = await requirePlatformAdmin(req, origin);
    if (!gate.ok) return gate.response;

    const body = await req.json() as { courseId?: unknown; title?: unknown; sortOrder?: unknown };
    const { courseId, title, sortOrder } = body;

    if (!courseId || typeof courseId !== 'string') {
      return corsResponse(origin, 400, { error: 'courseId is required' });
    }

    if (!title || typeof title !== 'string' || (title as string).trim() === '') {
      return corsResponse(origin, 400, { error: 'title is required' });
    }

    if (!Number.isInteger(sortOrder)) {
      return corsResponse(origin, 400, { error: 'sortOrder must be an integer' });
    }

    const module_ = await queryOne(
      `INSERT INTO course_modules (course_id, title, sort_order) VALUES ($1, $2, $3) RETURNING *`,
      [courseId, title, sortOrder], // title stored raw — trim is validation-only (course-create parity)
    );

    return corsResponse(origin, 200, { module: module_ });
  } catch (err: unknown) {
    return corsResponse(origin, 500, { error: err instanceof Error ? err.message : 'Unknown error' });
  }
}

export default handler;
app.http('module-create', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
