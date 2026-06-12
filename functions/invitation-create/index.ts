import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { queryOne, isUniqueViolation } from '../shared/db';
import { corsPreflightResponse, corsResponse } from '../shared/cors';
import { getProfile, isOrgAdmin } from '../shared/profile';

const ALLOWED_ROLES = new Set(['org_admin', 'learner']);
// Basic email regex — matches the BulkInviteDialog row validation.
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Creates a pending org invitation. Replaces the legacy frontend pattern that
 * did a direct `INSERT INTO invitations(...)` followed by an RPC
 * `get_invitation_link_id(invitation_id)` to retrieve the shareable link_id.
 * By returning the freshly-created row INCLUDING `link_id`, we eliminate that
 * second roundtrip. `token` / `token_hash` are NEVER exposed in the response
 * (security-sensitive — see shared invitation safety notes / invitations LIST).
 */
async function handler(req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin);
  try {
    const user = await authenticate(req);
    const profile = await getProfile(user);
    if (!profile) return corsResponse(origin, 401, { error: 'Profile not found' });

    const body = await req.json() as {
      orgId?: unknown;
      email?: unknown;
      role?: unknown;
      firstName?: unknown;
      lastName?: unknown;
      department?: unknown;
    };
    const { orgId, email, role, firstName, lastName, department } = body;

    // Validation first, authz second, db third (mirrors org-membership-create).
    if (!orgId || typeof orgId !== 'string') {
      return corsResponse(origin, 400, { error: 'orgId is required' });
    }
    if (!email || typeof email !== 'string' || !EMAIL_REGEX.test(email)) {
      return corsResponse(origin, 400, { error: 'email is required and must be a valid email address' });
    }
    if (typeof role !== 'string' || !ALLOWED_ROLES.has(role)) {
      return corsResponse(origin, 400, { error: 'role must be one of: org_admin, learner' });
    }
    // firstName/lastName/department: optional. If provided and not null, must be string ≤ 100.
    const validateOptionalText = (val: unknown, field: string): string | null | undefined => {
      if (val === undefined || val === null) return null;
      if (typeof val !== 'string') return undefined;
      if (val.length > 100) return undefined;
      // Empty string → null on insert (matches BulkInviteDialog `invite.first_name || null`).
      return val === '' ? null : val;
    };
    const fnVal = validateOptionalText(firstName, 'firstName');
    if (fnVal === undefined) {
      return corsResponse(origin, 400, { error: 'firstName must be a string of 100 characters or fewer' });
    }
    const lnVal = validateOptionalText(lastName, 'lastName');
    if (lnVal === undefined) {
      return corsResponse(origin, 400, { error: 'lastName must be a string of 100 characters or fewer' });
    }
    const deptVal = validateOptionalText(department, 'department');
    if (deptVal === undefined) {
      return corsResponse(origin, 400, { error: 'department must be a string of 100 characters or fewer' });
    }

    // Authorization: platform admin OR org admin of the target org.
    // RLS provenance: supabase/migrations/20260130144031_*.sql —
    // "Admins can insert invitations" policy (WITH CHECK is_platform_admin()
    // OR (org_id IS NOT NULL AND is_org_admin(org_id))).
    const authorized = profile.is_platform_admin || await isOrgAdmin(profile.id, orgId);
    if (!authorized) return corsResponse(origin, 403, { error: 'Forbidden' });

    // Normalize email casing (matches BulkInviteDialog row normalization).
    const normalizedEmail = email.toLowerCase().trim();

    try {
      // `token`, `token_hash`, `status`, `expires_at`, `link_id`,
      // `is_platform_admin_invite` all have DB defaults — let the DB populate them.
      const invitation = await queryOne(
        `INSERT INTO invitations (org_id, email, role, invited_by_user_id, first_name, last_name, department)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, org_id, email, role, status, expires_at, created_at, link_id,
                   is_platform_admin_invite, invited_by_user_id, first_name, last_name, department`,
        [orgId, normalizedEmail, role, profile.id, fnVal, lnVal, deptVal],
      );
      return corsResponse(origin, 200, { invitation });
    } catch (dbErr: unknown) {
      if (isUniqueViolation(dbErr)) {
        return corsResponse(origin, 409, { error: 'An invitation for this email is already pending' });
      }
      if ((dbErr as { code?: string })?.code === '23503') {
        return corsResponse(origin, 404, { error: 'Organization not found' });
      }
      throw dbErr;
    }
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message });
    return corsResponse(origin, 500, { error: err instanceof Error ? err.message : 'Unknown error' });
  }
}

export default handler;
app.http('invitation-create', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
