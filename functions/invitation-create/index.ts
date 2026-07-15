import { queryOne, isUniqueViolation } from '../shared/db';
import { endpoint } from '../shared/endpoint';

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
export default endpoint('invitation-create', async ({ req, profile, reply, requireOrgAdmin }) => {
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
      return reply(400, { error: 'orgId is required' });
    }
    if (!email || typeof email !== 'string' || !EMAIL_REGEX.test(email)) {
      return reply(400, { error: 'email is required and must be a valid email address' });
    }
    if (typeof role !== 'string' || !ALLOWED_ROLES.has(role)) {
      return reply(400, { error: 'role must be one of: org_admin, learner' });
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
      return reply(400, { error: 'firstName must be a string of 100 characters or fewer' });
    }
    const lnVal = validateOptionalText(lastName, 'lastName');
    if (lnVal === undefined) {
      return reply(400, { error: 'lastName must be a string of 100 characters or fewer' });
    }
    const deptVal = validateOptionalText(department, 'department');
    if (deptVal === undefined) {
      return reply(400, { error: 'department must be a string of 100 characters or fewer' });
    }

    // Authorization: platform admin OR org admin of the target org.
    // RLS provenance: supabase/migrations/20260130144031_*.sql —
    // "Admins can insert invitations" policy (WITH CHECK is_platform_admin()
    // OR (org_id IS NOT NULL AND is_org_admin(org_id))).
    await requireOrgAdmin(orgId);

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
      return reply(200, { invitation });
    } catch (dbErr: unknown) {
      if (isUniqueViolation(dbErr)) {
        return reply(409, { error: 'An invitation for this email is already pending' });
      }
      if ((dbErr as { code?: string })?.code === '23503') {
        return reply(404, { error: 'Organization not found' });
      }
      throw dbErr;
    }
});
