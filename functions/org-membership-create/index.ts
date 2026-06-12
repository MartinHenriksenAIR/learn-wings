import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { queryOne, isUniqueViolation } from '../shared/db';
import { corsPreflightResponse, corsResponse } from '../shared/cors';
import { internalError } from '../shared/errors';
import { getProfile, isOrgAdmin } from '../shared/profile';

const ALLOWED_ROLES = new Set(['org_admin', 'learner']);
// 'invited' is deliberately NOT accepted here — the invitation flow (invitation-create /
// invitation-accept) is the only entry point to that state (issue #66).
const ALLOWED_STATUSES = new Set(['active', 'disabled']);

async function handler(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin);
  try {
    const user = await authenticate(req);
    const profile = await getProfile(user);
    if (!profile) return corsResponse(origin, 401, { error: 'Profile not found' });

    const body = await req.json() as { orgId?: unknown; userId?: unknown; role?: unknown; status?: unknown };
    const { orgId, userId, role, status } = body;

    // Validation first, authz second, db third (mirrors organization-update).
    if (!orgId || typeof orgId !== 'string') {
      return corsResponse(origin, 400, { error: 'orgId is required' });
    }
    if (!userId || typeof userId !== 'string') {
      return corsResponse(origin, 400, { error: 'userId is required' });
    }
    if (typeof role !== 'string' || !ALLOWED_ROLES.has(role)) {
      return corsResponse(origin, 400, { error: 'role must be one of: org_admin, learner' });
    }
    if (status !== undefined && (typeof status !== 'string' || !ALLOWED_STATUSES.has(status))) {
      return corsResponse(origin, 400, { error: 'status must be one of: active, disabled' });
    }

    // Authorization: platform admin OR org admin of the target org.
    // RLS provenance: supabase/migrations/20260127153401_*.sql lines 279-285 —
    // "Platform admins can do everything with memberships" (is_platform_admin())
    // + "Org admins can manage memberships in their org" (is_org_admin(org_id)).
    const authorized = profile.is_platform_admin || await isOrgAdmin(profile.id, orgId);
    if (!authorized) return corsResponse(origin, 403, { error: 'Forbidden' });

    const effectiveStatus = status ?? 'active';

    // Seat-limit enforcement (issue #66): the UI disables the add button at the limit,
    // but the backend must hold the line for any caller. Counts ACTIVE members only —
    // parity with OrganizationDetail's activeMembers semantics.
    const org = await queryOne<{ seat_limit: number | null; active_count: number }>(
      `SELECT o.seat_limit,
              (SELECT COUNT(*)::int FROM org_memberships m
                WHERE m.org_id = o.id AND m.status = 'active') AS active_count
         FROM organizations o
        WHERE o.id = $1`,
      [orgId],
    );
    if (!org) {
      return corsResponse(origin, 404, { error: 'Organization or user not found' });
    }
    if (org.seat_limit !== null && Number(org.active_count) >= org.seat_limit) {
      return corsResponse(origin, 409, { error: 'Organization is at seat limit', code: 'SEAT_LIMIT_REACHED' });
    }

    try {
      const membership = await queryOne(
        `INSERT INTO org_memberships (org_id, user_id, role, status)
         VALUES ($1, $2, $3, $4)
         RETURNING id, org_id, user_id, role, status, created_at`,
        [orgId, userId, role, effectiveStatus],
      );
      return corsResponse(origin, 200, { membership });
    } catch (dbErr: unknown) {
      if (isUniqueViolation(dbErr)) {
        return corsResponse(origin, 409, { error: 'User is already a member of this organization' });
      }
      if ((dbErr as { code?: string })?.code === '23503') {
        return corsResponse(origin, 404, { error: 'Organization or user not found' });
      }
      throw dbErr;
    }
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message });
    return internalError(context, origin, err);
  }
}

export default handler;
app.http('org-membership-create', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
