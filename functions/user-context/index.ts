import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { query, queryOne, withTransaction } from '../shared/db';
import { convertInvitation } from '../shared/invitation-convert';
import type { ConvertibleInvitation, ConvertResult } from '../shared/invitation-convert';
import { seedTenantBinding, autoJoinByTenant, individualTierEnabled } from '../shared/tenant-binding';
import { INDIVIDUAL_ORG_KIND } from '../shared/individual-tier';
import { orgDefaultLanguageForNewProfile, resolveProvisioningLanguage } from '../shared/member-language';
import { corsPreflightResponse, corsResponse } from '../shared/cors';
import { internalError } from '../shared/errors';

const PROFILE_SELECT = `id, full_name, first_name, last_name, department, email, avatar_url, is_platform_admin, preferred_language, created_at,
              assessment_level, assessment_skipped_at,
              (SELECT max(aa.created_at) FROM assessment_attempts aa WHERE aa.user_id = profiles.id) AS assessment_taken_at`;

const PENDING_ORG_INVITE_FILTER =
  `status = 'pending' AND org_id IS NOT NULL AND expires_at > now() AND lower(trim(email)) = $1`;

async function adoptPendingInvites(profileId: string, rawEmail: string, tid: string, context: InvocationContext): Promise<void> {
  const email = rawEmail.trim().toLowerCase();
  if (!email) return; // never match a blank/absent email claim against invitations

  try {
    const pending = await query<{ id: string }>(
      `SELECT id FROM invitations WHERE ${PENDING_ORG_INVITE_FILTER} LIMIT 1`,
      [email],
    );
    if (pending.length === 0) return;

    const converted: ConvertResult[] = [];
    await withTransaction(async (client) => {
      const { rows } = await client.query<ConvertibleInvitation>(
        `SELECT id, org_id, role FROM invitations WHERE ${PENDING_ORG_INVITE_FILTER} FOR UPDATE`,
        [email],
      );
      for (const invitation of rows) {
        converted.push(await convertInvitation(client, invitation, profileId));
      }
    });

    for (const result of converted) {
      if (result.kind === 'org' && result.role === 'org_admin') {
        await seedTenantBinding(result.orgId, tid, rawEmail, context);
      }
    }
  } catch (err) {
    context.error('user-context: pending-invite adoption failed', err);
  }
}

async function ensureIndividualMembership(profileId: string, context: InvocationContext): Promise<void> {
  try {
    if (!(await individualTierEnabled())) return;

    const active = await query(
      `SELECT 1 FROM org_memberships WHERE user_id = $1 AND status = 'active' LIMIT 1`,
      [profileId],
    );
    if (active.length > 0) return; // already belongs somewhere — leave untouched

    const placeholder = await queryOne<{ id: string }>(
      `SELECT id FROM organizations WHERE kind = $1 LIMIT 1`,
      [INDIVIDUAL_ORG_KIND],
    );
    if (!placeholder) return; // not seeded yet — graceful fallback

    await query(
      `INSERT INTO org_memberships (org_id, user_id, role, status)
       VALUES ($1, $2, 'learner', 'active')
       ON CONFLICT (org_id, user_id) DO NOTHING`,
      [placeholder.id, profileId],
    );
  } catch (err) {
    context.error('user-context: individual-tier auto-join failed', err);
  }
}

async function handler(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin);

  try {
    const user = await authenticate(req);

    let profile = await queryOne<{ id: string; full_name: string; first_name: string | null; last_name: string | null; department: string | null; email: string; avatar_url: string | null; is_platform_admin: boolean; preferred_language: string; created_at: string; assessment_level: string | null; assessment_skipped_at: string | null; assessment_taken_at: string | null }>(
      `SELECT ${PROFILE_SELECT}
         FROM profiles WHERE entra_oid = $1 AND entra_tid = $2`,
      [user.id, user.tid]
    );

    const profileCreated = !profile;

    if (!profile) {
      if (!user.email) {
        return corsResponse(origin, 403, {
          error: 'Your Microsoft account did not supply an email address, so an account cannot be created.',
        });
      }

      let requestedLanguage: unknown;
      try {
        const body = (await req.json()) as { language?: unknown } | null;
        requestedLanguage = body?.language;
      } catch {
      }

      const orgDefault = await orgDefaultLanguageForNewProfile(user.email, user.tid);
      const language = resolveProvisioningLanguage(orgDefault, requestedLanguage);

      const inserted = await queryOne<{ id: string }>(
        `INSERT INTO profiles (full_name, email, entra_oid, entra_tid, preferred_language)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [user.email.split('@')[0], user.email, user.id, user.tid, language]
      );
      profile = await queryOne(
        `SELECT ${PROFILE_SELECT}
           FROM profiles WHERE id = $1`,
        [inserted!.id]
      );
    }

    await adoptPendingInvites(profile!.id, user.email, user.tid, context);

    await autoJoinByTenant(profile!.id, user.tid, context);

    await ensureIndividualMembership(profile!.id, context);

    const memberships = await query(
      `SELECT om.*, row_to_json(o.*) AS organization
       FROM org_memberships om
       JOIN organizations o ON o.id = om.org_id
       WHERE om.user_id = $1 AND om.status = 'active'`,
      [profile!.id]
    );

    for (const m of memberships) {
      const org = (m as { organization?: Record<string, unknown> | null }).organization;
      if (org) {
        delete org.entra_tid;
        delete org.entra_tid_label;
      }
    }

    return corsResponse(origin, 200, { profile, memberships, profileCreated });
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message });
    return internalError(context, origin, err);
  }
}

export default handler;
app.http('user-context', { methods: ['GET', 'POST', 'OPTIONS'], authLevel: 'anonymous', handler });
