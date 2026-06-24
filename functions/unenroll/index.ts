import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { queryOne } from '../shared/db';
import { corsPreflightResponse, corsResponse } from '../shared/cors';
import { internalError } from '../shared/errors';
import { getProfile } from '../shared/profile';

async function handler(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin);

  try {
    const user = await authenticate(req);
    const profile = await getProfile(user);
    if (!profile) return corsResponse(origin, 401, { error: 'Profile not found' });

    const { enrollmentId } = await req.json() as { enrollmentId?: unknown };

    if (!enrollmentId || typeof enrollmentId !== 'string') {
      return corsResponse(origin, 400, { error: 'enrollmentId is required' });
    }

    // NOTE: Platform admins get NO special path here — unenroll is strictly self-service.
    // Admin-driven unenrollment will be a separate admin endpoint in a later slice.

    // Ownership enforced in WHERE: only the caller's own enrollment can match.
    // This doubles as authorization — no separate authz query needed.
    // Deliberately indistinguishable 404 for nonexistent vs. other users' enrollments
    // to prevent enrollment-id probing.
    const deleted = await queryOne<{ id: string }>(
      `-- Ownership enforced in WHERE: only the caller's own enrollment can match.
DELETE FROM enrollments
 WHERE id = $1 AND user_id = $2
RETURNING id`,
      [enrollmentId, profile.id],
    );

    if (!deleted) {
      // 404 covers both nonexistent ids and other users' enrollments —
      // deliberately indistinguishable to prevent enrollment-id probing.
      return corsResponse(origin, 404, { error: 'Enrollment not found' });
    }

    return corsResponse(origin, 200, { success: true });
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message });
    return internalError(context, origin, err);
  }
}

export default handler;
app.http('unenroll', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
