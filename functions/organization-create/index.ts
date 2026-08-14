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

  requirePlatformAdmin();

  const nextLogoUrl = (logo_url as string | null | undefined) ?? null;

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
