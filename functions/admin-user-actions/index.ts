// Hand-rolled (not shared/endpoint.ts): legacy oid-only identity lookup (entra_oid without tid) and a custom 403 body — pending identity normalization.
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { query, queryOne, withTransaction } from '../shared/db';
import { isAtSeatLimit, lockSeatUsage } from '../shared/seats';
import { corsPreflightResponse, corsResponse } from '../shared/cors';
import { internalError } from '../shared/errors';

async function handler(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin);

  try {
    const user = await authenticate(req);

    // Verify requesting user is a platform admin
    const requester = await queryOne<{ is_platform_admin: boolean }>(
      'SELECT is_platform_admin FROM profiles WHERE entra_oid = $1',
      [user.id]
    );
    if (!requester?.is_platform_admin) {
      return corsResponse(origin, 403, { error: 'Platform admin access required' });
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

      case 'add-membership': {
        const result = await withTransaction(async (client) => {
          const usage = await lockSeatUsage(client, body.org_id as string);
          if (!usage.exists) return { kind: 'not_found' as const };
          if (isAtSeatLimit(usage)) return { kind: 'seat_limit' as const };
          await client.query(
            `INSERT INTO org_memberships (org_id, user_id, role, status)
             VALUES ($1, $2, $3, 'active')`,
            [body.org_id, body.target_user_id, body.role ?? 'learner'],
          );
          return { kind: 'created' as const };
        });
        if (result.kind === 'not_found') return corsResponse(origin, 404, { error: 'Organization not found' });
        if (result.kind === 'seat_limit') return corsResponse(origin, 409, { error: 'Organization is at seat limit', code: 'SEAT_LIMIT_REACHED' });
        break;
      }

      default:
        return corsResponse(origin, 400, { error: `Unknown action: ${body.action}` });
    }

    return corsResponse(origin, 200, { ok: true });
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message });
    return internalError(context, origin, err);
  }
}

export default handler;
// Route must not start with 'admin' — a reserved route prefix in Azure Functions
// (admin/runtime/host). Suffix style matches courses-admin.
app.http('user-actions-admin', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
