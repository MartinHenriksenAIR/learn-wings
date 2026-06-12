import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { queryOne } from '../shared/db';
import { corsPreflightResponse, corsResponse } from '../shared/cors';
import { getProfile, isOrgAdmin } from '../shared/profile';

const ALLOWED_ROLES = new Set(['org_admin', 'learner']);
// Basic email regex — matches the BulkInviteDialog / invitation-create validation.
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_INVITES = 500;

type RawInvite = {
  email?: unknown;
  role?: unknown;
  firstName?: unknown;
  lastName?: unknown;
  department?: unknown;
};

type RowResult = {
  email: string;
  success: boolean;
  invitation?: unknown;
  error?: string;
};

/**
 * Bulk variant of invitation-create — replaces the per-row loop the BulkInviteDialog
 * used to run on the client (one network call per CSV row). The dialog now sends
 * a single call with an array of invites; we INSERT each row independently so one
 * bad row does not abort the rest. Sequential (no Promise.all) to keep deterministic
 * ordering and avoid hammering the small connection pool. NOT wrapped in a
 * transaction — partial success is intentional and matches the original UX.
 * `token` / `token_hash` are NEVER exposed in the response (same security note as
 * invitation-create).
 */
async function handler(req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin);
  try {
    const user = await authenticate(req);
    const profile = await getProfile(user);
    if (!profile) return corsResponse(origin, 401, { error: 'Profile not found' });

    const body = await req.json() as { orgId?: unknown; invites?: unknown };
    const { orgId, invites } = body;

    // Request-level validation: shape errors abort the whole request with 400.
    if (!orgId || typeof orgId !== 'string') {
      return corsResponse(origin, 400, { error: 'orgId is required' });
    }
    if (invites === undefined || invites === null) {
      return corsResponse(origin, 400, { error: 'invites is required' });
    }
    if (!Array.isArray(invites)) {
      return corsResponse(origin, 400, { error: 'invites must be an array' });
    }
    if (invites.length === 0) {
      return corsResponse(origin, 400, { error: 'invites must not be empty' });
    }
    if (invites.length > MAX_INVITES) {
      return corsResponse(origin, 400, { error: `invites must not exceed ${MAX_INVITES} entries` });
    }

    // Authorization: platform admin OR org admin of the target org.
    // RLS provenance: supabase/migrations/20260130144031_*.sql —
    // "Admins can insert invitations" policy (WITH CHECK is_platform_admin()
    // OR (org_id IS NOT NULL AND is_org_admin(org_id))). Same gate as invitation-create.
    const authorized = profile.is_platform_admin || await isOrgAdmin(profile.id, orgId);
    if (!authorized) return corsResponse(origin, 403, { error: 'Forbidden' });

    // Per-row processing. Each row resolves to a result entry — never throws out
    // of this loop. Sequential by design (see header comment).
    const results: RowResult[] = [];
    for (const raw of invites as RawInvite[]) {
      const rawEmail = typeof raw?.email === 'string' ? raw.email : '';
      const normalizedEmail = rawEmail.toLowerCase().trim();

      // Per-row validation — non-fatal. Failed rows surface as success: false.
      if (!rawEmail || typeof raw.email !== 'string' || !EMAIL_REGEX.test(rawEmail)) {
        results.push({ email: normalizedEmail, success: false, error: 'email is required and must be a valid email address' });
        continue;
      }
      if (typeof raw.role !== 'string' || !ALLOWED_ROLES.has(raw.role)) {
        results.push({ email: normalizedEmail, success: false, error: 'role must be one of: org_admin, learner' });
        continue;
      }

      const validateOptionalText = (val: unknown): { ok: true; value: string | null } | { ok: false } => {
        if (val === undefined || val === null) return { ok: true, value: null };
        if (typeof val !== 'string') return { ok: false };
        if (val.length > 100) return { ok: false };
        return { ok: true, value: val === '' ? null : val };
      };

      const fnRes = validateOptionalText(raw.firstName);
      if (!fnRes.ok) {
        results.push({ email: normalizedEmail, success: false, error: 'firstName must be a string of 100 characters or fewer' });
        continue;
      }
      const lnRes = validateOptionalText(raw.lastName);
      if (!lnRes.ok) {
        results.push({ email: normalizedEmail, success: false, error: 'lastName must be a string of 100 characters or fewer' });
        continue;
      }
      const deptRes = validateOptionalText(raw.department);
      if (!deptRes.ok) {
        results.push({ email: normalizedEmail, success: false, error: 'department must be a string of 100 characters or fewer' });
        continue;
      }

      try {
        const invitation = await queryOne(
          `INSERT INTO invitations (org_id, email, role, invited_by_user_id, first_name, last_name, department)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id, org_id, email, role, status, expires_at, created_at, link_id,
                     is_platform_admin_invite, invited_by_user_id, first_name, last_name, department`,
          [orgId, normalizedEmail, raw.role, profile.id, fnRes.value, lnRes.value, deptRes.value],
        );
        results.push({ email: normalizedEmail, success: true, invitation });
      } catch (dbErr: unknown) {
        const code = (dbErr as { code?: string })?.code;
        if (code === '23505') {
          results.push({ email: normalizedEmail, success: false, error: 'An invitation for this email is already pending' });
        } else if (code === '23503') {
          results.push({ email: normalizedEmail, success: false, error: 'Organization not found' });
        } else {
          const msg = dbErr instanceof Error ? dbErr.message : 'Unknown error';
          results.push({ email: normalizedEmail, success: false, error: msg });
        }
      }
    }

    return corsResponse(origin, 200, { results });
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message });
    return corsResponse(origin, 500, { error: err instanceof Error ? err.message : 'Unknown error' });
  }
}

export default handler;
app.http('invitation-bulk-create', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
