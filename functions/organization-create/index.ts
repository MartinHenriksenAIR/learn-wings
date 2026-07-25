import { queryOne, isUniqueViolation } from '../shared/db';
import { endpoint } from '../shared/endpoint';
import { validateOrgName, validateOrgSlug, normalizeOrgName } from '../shared/org-validation';
import { assertBindablePaths } from '../shared/blob-ownership';
import type { UploadCandidate } from '../shared/upload-limits';

export default endpoint('organization-create', async ({ req, reply, requirePlatformAdmin }) => {
  const body = await req.json() as Record<string, unknown>;
  const { name, slug, logo_url, seat_limit } = body;

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
  requirePlatformAdmin();

  const nextLogoUrl = (logo_url as string | null | undefined) ?? null;

  // Ownership gate on the bound logo path (#280). This endpoint was the seventh
  // writer into a column in the reconciliation union and the only one outside the
  // gates: it accepted any string, so a path belonging to another org's live logo
  // (readable by any learner via `/organizations`) or to a lesson video could be
  // bound here — and once bound, `organization-update`'s superseded-blob cleanup
  // is what would eventually act on it. Family `'org-logo'` is the COLUMN's
  // property, never the caller's claim, and there is no `previousPaths`: the row
  // does not exist yet, so every path is fresh and must clear the check.
  //
  // Placed after `requirePlatformAdmin()` so an unauthorized caller still never
  // reaches the DB (pinned by the 403 test), and before the INSERT so a refused
  // path never lands in a row. Unlike `organization-update` there is no
  // `enforceUploadLimits` to order against — creation is platform-admin-only and
  // the org logo is re-checked on every subsequent update.
  const candidates: UploadCandidate[] = [{ path: nextLogoUrl, kind: 'image', family: 'org-logo' }];
  const bindError = await assertBindablePaths(candidates);
  if (bindError) {
    return reply(400, { error: bindError });
  }

  try {
    const organization = await queryOne(
      `INSERT INTO organizations (name, slug, logo_url, seat_limit)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, slug, logo_url, seat_limit, created_at`,
      [
        normalizeOrgName(name as string),
        slug,
        nextLogoUrl,
        (seat_limit as number | null | undefined) ?? null,
      ],
    );

    return reply(200, { organization });
  } catch (dbErr: unknown) {
    if (isUniqueViolation(dbErr)) {
      return reply(409, { error: 'Slug already in use', code: 'DUPLICATE_SLUG' });
    }
    throw dbErr;
  }
});
