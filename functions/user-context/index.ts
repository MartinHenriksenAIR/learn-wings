import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { query, queryOne } from '../shared/db';
import { corsPreflightResponse, corsResponse } from '../shared/cors';

async function handler(req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin) as HttpResponseInit;

  try {
    // authenticate is async (Entra ID JWKS fetch)
    const user = await authenticate(req);

    // First-login provisioning: look up by Entra oid+tid, create profile if absent
    let profile = await queryOne<{ id: string; full_name: string; first_name: string | null; last_name: string | null; department: string | null; email: string; avatar_url: string | null; is_platform_admin: boolean; preferred_language: string; created_at: string }>(
      'SELECT id, full_name, first_name, last_name, department, email, avatar_url, is_platform_admin, preferred_language, created_at FROM profiles WHERE entra_oid = $1 AND entra_tid = $2',
      [user.id, user.tid]
    );

    if (!profile) {
      // First login from this Entra identity — provision a profile row
      profile = await queryOne(
        `INSERT INTO profiles (full_name, email, entra_oid, entra_tid)
         VALUES ($1, $2, $3, $4)
         RETURNING id, full_name, first_name, last_name, department, email, avatar_url, is_platform_admin, preferred_language, created_at`,
        [user.email.split('@')[0], user.email, user.id, user.tid]
      );
    }

    const memberships = await query(
      `SELECT om.*, row_to_json(o.*) AS organization
       FROM org_memberships om
       JOIN organizations o ON o.id = om.org_id
       WHERE om.user_id = $1 AND om.status = 'active'`,
      [profile!.id]
    );

    return corsResponse(origin, 200, { profile, memberships }) as HttpResponseInit;
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message }) as HttpResponseInit;
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return corsResponse(origin, 500, { error: msg }) as HttpResponseInit;
  }
}

export default handler;
app.http('user-context', { methods: ['GET', 'POST', 'OPTIONS'], authLevel: 'anonymous', handler });
