import { queryOne, isUniqueViolation } from '../shared/db';
import { endpoint } from '../shared/endpoint';
import { validateOrgName, validateOrgSlug, normalizeOrgName } from '../shared/org-validation';

export default endpoint('organization-create', async ({ req, profile, reply }) => {
    const body = await req.json() as Record<string, unknown>;
    const { name, slug, logo_url, seat_limit } = body;

    // Validation first (matches resource-create / org-settings-update order),
    // authz second. Rules live in shared/org-validation (mirrored by the
    // frontend zod schema in src/lib/org-validation.ts).
    const nameError = validateOrgName(name);
    if (nameError) {
      return reply(400, { error: nameError });
    }
    const slugError = validateOrgSlug(slug);
    if (slugError) {
      return reply(400, { error: slugError });
    }
    if (logo_url !== undefined && logo_url !== null && typeof logo_url !== 'string') {
      return reply(400, { error: 'logo_url must be a string or null' });
    }
    if (
      seat_limit !== undefined &&
      seat_limit !== null &&
      (typeof seat_limit !== 'number' || !Number.isInteger(seat_limit) || seat_limit < 1)
    ) {
      return reply(400, { error: 'seat_limit must be a positive integer or null' });
    }

    // Authorization: platform-admin-only.
    // RLS provenance: supabase/migrations/20260127153401_*.sql lines 269-276 —
    // "Platform admins can do everything with orgs" was the only INSERT-capable policy.
    if (!profile.is_platform_admin) {
      return reply(403, { error: 'Forbidden' });
    }

    try {
      const organization = await queryOne(
        `INSERT INTO organizations (name, slug, logo_url, seat_limit)
         VALUES ($1, $2, $3, $4)
         RETURNING id, name, slug, logo_url, seat_limit, created_at`,
        [
          normalizeOrgName(name as string),
          slug,
          (logo_url as string | null | undefined) ?? null,
          (seat_limit as number | null | undefined) ?? null,
        ],
      );

      return reply(200, { organization });
    } catch (dbErr: unknown) {
      // Postgres unique_violation on the slug UNIQUE constraint.
      // `code` is the structured machine-readable error code (ADR-0013) —
      // the frontend matches on it instead of the English sentence.
      if (isUniqueViolation(dbErr)) {
        return reply(409, { error: 'Slug already in use', code: 'DUPLICATE_SLUG' });
      }
      throw dbErr;
    }
});
