import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { queryOne } from '../shared/db';
import { corsPreflightResponse, corsResponse } from '../shared/cors';
import { getProfile } from '../shared/profile';

async function handler(req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin) as HttpResponseInit;
  try {
    const user = await authenticate(req);
    const profile = await getProfile(user);
    if (!profile) return corsResponse(origin, 401, { error: 'Profile not found' }) as HttpResponseInit;

    if (!profile.is_platform_admin) {
      return corsResponse(origin, 403, { error: 'Forbidden' }) as HttpResponseInit;
    }

    const body = await req.json() as { moduleId?: unknown; title?: unknown };
    const { moduleId, title } = body;

    if (!moduleId || typeof moduleId !== 'string') {
      return corsResponse(origin, 400, { error: 'moduleId is required' }) as HttpResponseInit;
    }

    if (!title || typeof title !== 'string' || (title as string).trim() === '') {
      return corsResponse(origin, 400, { error: 'title is required' }) as HttpResponseInit;
    }

    const module_ = await queryOne(
      `UPDATE course_modules SET title = $1 WHERE id = $2 RETURNING *`,
      [title, moduleId], // title stored raw — trim is validation-only (course-create parity)
    );

    if (!module_) {
      return corsResponse(origin, 404, { error: 'Module not found' }) as HttpResponseInit;
    }

    return corsResponse(origin, 200, { module: module_ }) as HttpResponseInit;
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message }) as HttpResponseInit;
    return corsResponse(origin, 500, { error: err instanceof Error ? err.message : 'Unknown error' }) as HttpResponseInit;
  }
}

export default handler;
app.http('module-update', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
