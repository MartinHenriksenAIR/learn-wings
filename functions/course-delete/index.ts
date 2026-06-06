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

    const body = await req.json() as { courseId?: unknown };
    const { courseId } = body;

    if (!courseId || typeof courseId !== 'string') {
      return corsResponse(origin, 400, { error: 'courseId is required' }) as HttpResponseInit;
    }

    const deleted = await queryOne<{ id: string }>(
      `DELETE FROM courses WHERE id = $1 RETURNING id`,
      [courseId],
    );

    if (!deleted) return corsResponse(origin, 404, { error: 'Course not found' }) as HttpResponseInit;

    return corsResponse(origin, 200, { success: true }) as HttpResponseInit;
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message }) as HttpResponseInit;
    return corsResponse(origin, 500, { error: err instanceof Error ? err.message : 'Unknown error' }) as HttpResponseInit;
  }
}

export default handler;
app.http('course-delete', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
