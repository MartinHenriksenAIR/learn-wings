// Hand-rolled (not shared/endpoint.ts): accepting an invite can be the user's very
// first authenticated call, so the profile is provisioned here on demand — the
// factory 401s ('Profile not found') when getProfile misses (mirrors user-context).
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { queryOne, withTransaction } from '../shared/db';
import { convertInvitation } from '../shared/invitation-convert';
import type { ConvertResult } from '../shared/invitation-convert';
import { corsPreflightResponse, corsResponse } from '../shared/cors';
import { internalError } from '../shared/errors';

interface LockedInvitation {
  id: string;
  org_id: string | null;
  email: string;
  role: string;
  status: 'pending' | 'accepted' | 'expired';
  expires_at: string | Date;
  org_name: string | null;
}

type AcceptOutcome =
  | { kind: 'not_found' }
  | { kind: 'already_accepted' }
  | { kind: 'expired' }
  | { kind: 'email_mismatch' }
  | { kind: 'converted'; result: ConvertResult; orgName: string | null };

/**
 * Accepts a pending invitation by its shareable link_id (the /signup?invite=<link_id>
 * secret — a bearer credential: NEVER log it). Atomically converts the invitation
 * into membership via the shared convertInvitation helper (#175; reused by #176).
 * No seat check: the accept transition is net-zero against the seat cap — see the
 * reasoning in functions/shared/invitation-convert.ts.
 */
async function handler(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin);

  try {
    const user = await authenticate(req);

    const body = await req.json() as { linkId?: unknown };
    const linkId = body.linkId;
    if (!linkId || typeof linkId !== 'string') {
      return corsResponse(origin, 400, { error: 'linkId is required' });
    }

    // First-login provisioning (mirrors user-context): accept must be
    // self-contained — never assume the frontend called user-context first.
    let profile = await queryOne<{ id: string }>(
      'SELECT id FROM profiles WHERE entra_oid = $1 AND entra_tid = $2',
      [user.id, user.tid],
    );
    if (!profile) {
      profile = await queryOne<{ id: string }>(
        `INSERT INTO profiles (full_name, email, entra_oid, entra_tid)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [user.email.split('@')[0], user.email, user.id, user.tid],
      );
    }
    const profileId = profile!.id;

    const outcome = await withTransaction<AcceptOutcome>(async (client) => {
      // Lock the invitation row for the whole transaction so concurrent accepts
      // of the same link serialize instead of double-consuming the invite.
      const invRes = await client.query<LockedInvitation>(
        `SELECT i.id, i.org_id, i.email, i.role, i.status,
                i.expires_at, o.name AS org_name
           FROM invitations i
           LEFT JOIN organizations o ON o.id = i.org_id
          WHERE i.link_id = $1
          FOR UPDATE OF i`,
        [linkId],
      );
      const invitation = invRes.rows[0];
      if (!invitation) return { kind: 'not_found' };
      if (invitation.status === 'accepted') return { kind: 'already_accepted' };
      // Expired-but-still-pending is rejected too; the expiry job owns flipping
      // status to 'expired' — never mutate it here.
      if (invitation.status === 'expired' || new Date(invitation.expires_at) < new Date()) {
        return { kind: 'expired' };
      }
      // Strict, case-insensitive match between the invited email and the
      // authenticated Entra identity (both sides normalized defensively).
      if (invitation.email.trim().toLowerCase() !== user.email.trim().toLowerCase()) {
        return { kind: 'email_mismatch' };
      }
      const result = await convertInvitation(client, invitation, profileId);
      return { kind: 'converted', result, orgName: invitation.org_name };
    });

    if (outcome.kind === 'not_found') {
      return corsResponse(origin, 404, { error: 'Invitation not found', code: 'INVITE_NOT_FOUND' });
    }
    if (outcome.kind === 'already_accepted') {
      return corsResponse(origin, 409, { error: 'Invitation has already been accepted', code: 'INVITE_ALREADY_ACCEPTED' });
    }
    if (outcome.kind === 'expired') {
      return corsResponse(origin, 410, { error: 'Invitation has expired', code: 'INVITE_EXPIRED' });
    }
    if (outcome.kind === 'email_mismatch') {
      return corsResponse(origin, 403, { error: 'Invitation was issued to a different email address', code: 'INVITE_EMAIL_MISMATCH' });
    }
    if (outcome.result.kind === 'platform') {
      return corsResponse(origin, 200, { kind: 'platform' });
    }
    return corsResponse(origin, 200, {
      kind: 'org',
      orgId: outcome.result.orgId,
      orgName: outcome.orgName,
      role: outcome.result.role,
      alreadyMember: outcome.result.alreadyMember,
    });
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message });
    return internalError(context, origin, err);
  }
}

export default handler;
app.http('invitation-accept', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
