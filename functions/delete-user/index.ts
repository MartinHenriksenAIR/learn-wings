import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { query, queryOne } from '../shared/db';
import { corsPreflightResponse, corsResponse } from '../shared/cors';

async function handler(req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin) as HttpResponseInit;
  try {
    const user = await authenticate(req);

    // Look up requester's profile to get their UUID (needed for self-deletion guard)
    const requester = await queryOne<{ id: string; is_platform_admin: boolean }>(
      'SELECT id, is_platform_admin FROM profiles WHERE entra_oid = $1', [user.id]
    );
    if (!requester?.is_platform_admin) {
      return corsResponse(origin, 403, { error: 'Only platform admins can delete users' }) as HttpResponseInit;
    }

    const { userId } = await req.json() as { userId: string };
    if (!userId) {
      return corsResponse(origin, 400, { error: 'Missing userId' }) as HttpResponseInit;
    }

    // Prevent self-deletion (compare profile UUIDs)
    if (userId === requester.id) {
      return corsResponse(origin, 400, { error: 'Cannot delete your own account' }) as HttpResponseInit;
    }

    // Delete profile — FK cascades handle org_memberships, enrollments, etc.
    await query('DELETE FROM profiles WHERE id = $1', [userId]);

    return corsResponse(origin, 200, { success: true }) as HttpResponseInit;
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message }) as HttpResponseInit;
    return corsResponse(origin, 500, { error: err instanceof Error ? err.message : 'error' }) as HttpResponseInit;
  }
}

export default handler;
app.http('delete-user', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
