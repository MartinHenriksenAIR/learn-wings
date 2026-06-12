import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { queryOne, isUniqueViolation } from '../shared/db';
import { corsPreflightResponse, corsResponse } from '../shared/cors';
import { getProfile } from '../shared/profile';
import { validateOrgName, validateOrgSlug } from '../shared/org-validation';

async function handler(req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin);
  try {
    const user = await authenticate(req);
    const profile = await getProfile(user);
    if (!profile) return corsResponse(origin, 401, { error: 'Profile not found' });

    const body = await req.json() as Record<string, unknown>;
    const { name, slug, logo_url, seat_limit } = body;

    // Validation first (matches resource-create / org-settings-update order),
    // authz second. Rules live in shared/org-validation (mirrored by the
    // frontend zod schema in src/lib/org-validation.ts).
    const nameError = validateOrgName(name);
    if (nameError) {
      return corsResponse(origin, 400, { error: nameError });
    }
    const slugError = validateOrgSlug(slug);
    if (slugError) {
      return corsResponse(origin, 400, { error: slugError });
    }
    if (logo_url !== undefined && logo_url !== null && typeof logo_url !== 'string') {
      return corsResponse(origin, 400, { error: 'logo_url must be a string or null' });
    }
    if (
      seat_limit !== undefined &&
      seat_limit !== null &&
      (typeof seat_limit !== 'number' || !Number.isInteger(seat_limit) || seat_limit < 1)
    ) {
      return corsResponse(origin, 400, { error: 'seat_limit must be a positive integer or null' });
    }

    // Authorization: platform-admin-only.
    // RLS provenance: supabase/migrations/20260127153401_*.sql lines 269-276 —
    // "Platform admins can do everything with orgs" was the only INSERT-capable policy.
    if (!profile.is_platform_admin) {
      return corsResponse(origin, 403, { error: 'Forbidden' });
    }

    try {
      const organization = await queryOne(
        `INSERT INTO organizations (name, slug, logo_url, seat_limit)
         VALUES ($1, $2, $3, $4)
         RETURNING id, name, slug, logo_url, seat_limit, created_at`,
        [
          name,
          slug,
          (logo_url as string | null | undefined) ?? null,
          (seat_limit as number | null | undefined) ?? null,
        ],
      );

      return corsResponse(origin, 200, { organization });
    } catch (dbErr: unknown) {
      // Postgres unique_violation on the slug UNIQUE constraint.
      // `code` is the structured machine-readable error code (ADR-0013) —
      // the frontend matches on it instead of the English sentence.
      if (isUniqueViolation(dbErr)) {
        return corsResponse(origin, 409, { error: 'Slug already in use', code: 'DUPLICATE_SLUG' });
      }
      throw dbErr;
    }
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message });
    return corsResponse(origin, 500, { error: err instanceof Error ? err.message : 'Unknown error' });
  }
}

export default handler;
app.http('organization-create', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
