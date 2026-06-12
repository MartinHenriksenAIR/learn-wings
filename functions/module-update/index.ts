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

    const body = await req.json() as { moduleId?: unknown; title?: unknown };
    const { moduleId, title } = body;

    if (!moduleId || typeof moduleId !== 'string') {
      return corsResponse(origin, 400, { error: 'moduleId is required' });
    }

    if (!title || typeof title !== 'string' || (title as string).trim() === '') {
      return corsResponse(origin, 400, { error: 'title is required' });
    }

    const module_ = await queryOne(
      `UPDATE course_modules SET title = $1 WHERE id = $2 RETURNING *`,
      [title, moduleId], // title stored raw — trim is validation-only (course-create parity)
    );

    if (!module_) {
      return corsResponse(origin, 404, { error: 'Module not found' });
    }

    return corsResponse(origin, 200, { module: module_ });
  } catch (err: unknown) {
    return corsResponse(origin, 500, { error: err instanceof Error ? err.message : 'Unknown error' });
  }
}

export default handler;
app.http('module-update', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
