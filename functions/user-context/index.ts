// Hand-rolled (not shared/endpoint.ts): provisions the profile on first login (the factory 401s when getProfile misses) and serves GET as well as POST.
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { query, queryOne, withTransaction } from '../shared/db';
import { convertInvitation } from '../shared/invitation-convert';
import type { ConvertibleInvitation } from '../shared/invitation-convert';
import { corsPreflightResponse, corsResponse } from '../shared/cors';
import { internalError } from '../shared/errors';

/**
 * Auto-adopt any pending organization invitations addressed to the caller's
 * Entra email, at login (#176). Runs on EVERY user-context call — not just
 * first-provision — so an invite created AFTER a user self-signed-up is still
 * honored on their next login (the common "won't click the link" case).
 *
 * Best-effort: adoption must never break login. Any failure is logged and
 * swallowed; because it runs every login, the next one retries. Scope is
 * deliberately ORG invites only — platform-admin invites (org_id NULL) stay
 * gated behind the explicit accept-link flow (#175), since this path
 * authenticates on email match alone (no secret link). Seat-neutral by
 * construction — see functions/shared/invitation-convert.ts.
 */
async function adoptPendingInvites(profileId: string, rawEmail: string, context: InvocationContext): Promise<void> {
  const email = rawEmail.trim().toLowerCase();
  if (!email) return; // never match a blank/absent email claim against invitations

  try {
    await withTransaction(async (client) => {
      // Lock every matching pending, unexpired org invite so a concurrent
      // accept-link flow for the same invite serializes instead of racing.
      const { rows } = await client.query<ConvertibleInvitation>(
        `SELECT id, org_id, role
           FROM invitations
          WHERE status = 'pending'
            AND org_id IS NOT NULL
            AND expires_at > now()
            AND lower(trim(email)) = $1
          FOR UPDATE`,
        [email],
      );
      for (const invitation of rows) {
        await convertInvitation(client, invitation, profileId);
      }
    });
  } catch (err) {
    context.error('user-context: pending-invite adoption failed', err);
  }
}

async function handler(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin);

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

    // #176: honor any pending org invites for this email BEFORE loading orgs,
    // so a freshly adopted org shows up in this same response (no refresh).
    await adoptPendingInvites(profile!.id, user.email, context);

    const memberships = await query(
      `SELECT om.*, row_to_json(o.*) AS organization
       FROM org_memberships om
       JOIN organizations o ON o.id = om.org_id
       WHERE om.user_id = $1 AND om.status = 'active'`,
      [profile!.id]
    );

    return corsResponse(origin, 200, { profile, memberships });
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message });
    return internalError(context, origin, err);
  }
}

export default handler;
app.http('user-context', { methods: ['GET', 'POST', 'OPTIONS'], authLevel: 'anonymous', handler });
