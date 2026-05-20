import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { query, queryOne } from '../shared/db';
import { corsPreflightResponse, corsResponse } from '../shared/cors';

async function handler(req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin) as HttpResponseInit;

  try {
    const user = await authenticate(req);

    // Verify requesting user is a platform admin
    const requester = await queryOne<{ is_platform_admin: boolean }>(
      'SELECT is_platform_admin FROM profiles WHERE entra_oid = $1',
      [user.id]
    );
    if (!requester?.is_platform_admin) {
      return corsResponse(origin, 403, { error: 'Platform admin access required' }) as HttpResponseInit;
    }

    const body = await req.json() as {
      action: string;
      target_user_id?: string;
      value?: boolean;
      membership_id?: string;
      org_id?: string;
      role?: string;
    };

    switch (body.action) {
      case 'toggle-platform-admin':
        await query(
          'UPDATE profiles SET is_platform_admin = $1 WHERE id = $2',
          [body.value, body.target_user_id]
        );
        break;

      case 'update-member-role':
        await query(
          'UPDATE org_memberships SET role = $1 WHERE id = $2',
          [body.role, body.membership_id]
        );
        break;

      case 'remove-membership':
        await query(
          'DELETE FROM org_memberships WHERE id = $1',
          [body.membership_id]
        );
        break;

      case 'add-membership':
        await query(
          `INSERT INTO org_memberships (org_id, user_id, role, status)
           VALUES ($1, $2, $3, 'active')`,
          [body.org_id, body.target_user_id, body.role ?? 'member']
        );
        break;

      default:
        return corsResponse(origin, 400, { error: `Unknown action: ${body.action}` }) as HttpResponseInit;
    }

    return corsResponse(origin, 200, { ok: true }) as HttpResponseInit;
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message }) as HttpResponseInit;
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return corsResponse(origin, 500, { error: msg }) as HttpResponseInit;
  }
}

export default handler;
app.http('admin-user-actions', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
