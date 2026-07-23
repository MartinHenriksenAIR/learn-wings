// Hand-rolled (not shared/endpoint.ts): provisions the profile on first login (the factory 401s when getProfile misses) and serves GET as well as POST.
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { query, queryOne, withTransaction } from '../shared/db';
import { convertInvitation } from '../shared/invitation-convert';
import type { ConvertibleInvitation } from '../shared/invitation-convert';
import { corsPreflightResponse, corsResponse } from '../shared/cors';
import { internalError } from '../shared/errors';

// Shared projection used by both the lookup SELECT and the post-insert re-select.
// The scalar subquery for assessment_taken_at cannot be expressed in a RETURNING clause,
// so both branches use a full SELECT to guarantee an identical response shape.
const PROFILE_SELECT = `id, full_name, first_name, last_name, department, email, avatar_url, is_platform_admin, preferred_language, created_at,
              assessment_level, assessment_skipped_at,
              (SELECT max(aa.created_at) FROM assessment_attempts aa WHERE aa.user_id = profiles.id) AS assessment_taken_at`;

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
const PENDING_ORG_INVITE_FILTER =
  `status = 'pending' AND org_id IS NOT NULL AND expires_at > now() AND lower(trim(email)) = $1`;

async function adoptPendingInvites(profileId: string, rawEmail: string, context: InvocationContext): Promise<void> {
  const email = rawEmail.trim().toLowerCase();
  if (!email) return; // never match a blank/absent email claim against invitations

  try {
    // Cheap, non-transactional pre-check first: the overwhelmingly common case
    // is "no pending invite", and we don't want to check out a connection and
    // run BEGIN/COMMIT on every login just to find nothing. Only open the
    // locking transaction when there is actually something to adopt.
    const pending = await query<{ id: string }>(
      `SELECT id FROM invitations WHERE ${PENDING_ORG_INVITE_FILTER} LIMIT 1`,
      [email],
    );
    if (pending.length === 0) return;

    await withTransaction(async (client) => {
      // Re-select under FOR UPDATE inside the transaction so the conversion
      // locks each invite against a concurrent accept-link flow and sees fresh
      // state (an invite may have been accepted between the pre-check and here).
      const { rows } = await client.query<ConvertibleInvitation>(
        `SELECT id, org_id, role FROM invitations WHERE ${PENDING_ORG_INVITE_FILTER} FOR UPDATE`,
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

const SUPPORTED_LANGUAGES = ['da', 'en'] as const;

/**
 * Resolve the language to stamp on a first-login profile (#226). The client
 * sends its browser-derived UI language on the user-context call; validate it
 * against the supported set and default to English for a missing/unknown value.
 * English is the platform's last-resort language (see src/i18n fallbackLng),
 * so a non-da/en browser correctly lands on English content and emails.
 */
function resolveProvisioningLanguage(raw: unknown): string {
  return typeof raw === 'string' && (SUPPORTED_LANGUAGES as readonly string[]).includes(raw)
    ? raw
    : 'en';
}

async function handler(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin);

  try {
    // authenticate is async (Entra ID JWKS fetch)
    const user = await authenticate(req);

    // First-login provisioning: look up by Entra oid+tid, create profile if absent
    let profile = await queryOne<{ id: string; full_name: string; first_name: string | null; last_name: string | null; department: string | null; email: string; avatar_url: string | null; is_platform_admin: boolean; preferred_language: string; created_at: string; assessment_level: string | null; assessment_skipped_at: string | null; assessment_taken_at: string | null }>(
      `SELECT ${PROFILE_SELECT}
         FROM profiles WHERE entra_oid = $1 AND entra_tid = $2`,
      [user.id, user.tid]
    );

    if (!profile) {
      // #226: stamp the caller's browser-derived language onto the new profile so
      // it drives server-generated documents (e.g. #193 seat-request emails) from
      // the first login. Best-effort parse — a bodyless call (e.g. a GET probe)
      // falls through to the English default.
      let requestedLanguage = 'en';
      try {
        const body = (await req.json()) as { language?: unknown } | null;
        requestedLanguage = resolveProvisioningLanguage(body?.language);
      } catch {
        // no/invalid JSON body — keep the English default
      }

      // First login from this Entra identity — provision a profile row.
      // We INSERT then re-select using PROFILE_SELECT: RETURNING cannot express the
      // assessment_taken_at scalar subquery, so a re-select is the only way to return
      // a shape identical to the lookup branch. assessment_* are all null for a new profile.
      const inserted = await queryOne<{ id: string }>(
        `INSERT INTO profiles (full_name, email, entra_oid, entra_tid, preferred_language)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [user.email.split('@')[0], user.email, user.id, user.tid, requestedLanguage]
      );
      // Re-select with the full projection so both branches always return an identical shape.
      profile = await queryOne(
        `SELECT ${PROFILE_SELECT}
           FROM profiles WHERE id = $1`,
        [inserted!.id]
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
