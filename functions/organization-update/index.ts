import { queryOne, isUniqueViolation } from '../shared/db';
import { endpoint } from '../shared/endpoint';
import { isOrgAdmin } from '../shared/profile';
import { validateOrgName, validateOrgSlug, normalizeOrgName } from '../shared/org-validation';
import { buildUpdateSet } from '../shared/update-builder';
import { deleteBlob } from '../shared/blob';

const ALLOWED_UPDATE_FIELDS = new Set(['name', 'slug', 'logo_url', 'seat_limit']);

export default endpoint('organization-update', async ({ req, profile, reply }) => {
  const body = await req.json() as { orgId?: unknown; updates?: unknown };
  const { orgId, updates } = body;

  // Validation first (matches resource-update order), authz second.
  if (!orgId || typeof orgId !== 'string') {
    return reply(400, { error: 'orgId is required' });
  }

  // Shape check + whitelist walk + SET-clause build (shared #252). The transform
  // persists the trimmed name (parity with organization-create); other fields
  // pass through as validated.
  const built = buildUpdateSet(updates, ALLOWED_UPDATE_FIELDS, {
    transform: (key, value) => (key === 'name' ? normalizeOrgName(value as string) : value),
  });
  if (!built.ok) {
    return reply(400, { error: built.error });
  }

  const updatesObj = updates as Record<string, unknown>;
  const updateKeys = Object.keys(updatesObj);

  // Per-field validation — messages aligned with organization-create.
  for (const key of updateKeys) {
    const v = updatesObj[key];
    if (key === 'name') {
      const nameError = validateOrgName(v);
      if (nameError) {
        return reply(400, { error: nameError });
      }
    } else if (key === 'slug') {
      const slugError = validateOrgSlug(v);
      if (slugError) {
        return reply(400, { error: slugError });
      }
    } else if (key === 'logo_url') {
      if (v !== null && typeof v !== 'string') {
        return reply(400, { error: 'logo_url must be a string or null' });
      }
    } else if (key === 'seat_limit') {
      if (v !== null && (typeof v !== 'number' || !Number.isInteger(v) || v < 1)) {
        return reply(400, { error: 'seat_limit must be a positive integer or null' });
      }
    }
  }

  // Authorization: platform admin → any whitelisted field; org admin of the target
  // org → logo_url ONLY.
  // RLS provenance: supabase/migrations/20260127153401_*.sql:269-276 ("Platform admins
  // can do everything with orgs") + 20260128223657 ("Org admins can update their org
  // logo", FOR UPDATE is_org_admin(id)). The old policy was row-scoped (technically any
  // column); we tighten to the migration's stated intent — logo_url only (deliberate).
  if (!profile.is_platform_admin) {
    const onlyLogoUrl = updateKeys.every((key) => key === 'logo_url');
    const allowed = onlyLogoUrl && await isOrgAdmin(profile.id, orgId);
    if (!allowed) {
      return reply(403, { error: 'Forbidden' });
    }
  }

  // The blob path this update will write to logo_url — `undefined` when the caller
  // never supplied logo_url, which is NOT a clear: an absent key leaves the column
  // (and its blob) alone. Validated above as string | null.
  const nextLogoUrl = 'logo_url' in updatesObj
    ? (updatesObj.logo_url as string | null)
    : undefined;

  // Previous logo blob path, read before the write so the superseded blob can be
  // deleted afterwards — a replace (or a clear-to-null) used to strand the file.
  // Placed AFTER the authz gate (an unauthorized caller must still never reach the
  // DB — pinned by the 403 tests) and issued ONLY when the update actually writes
  // the column, so an unrelated field change costs no extra round trip and can
  // never delete a live logo.
  //
  // A plain SELECT rather than pulling the old value out of the UPDATE itself: the
  // RETURNING row is handed straight back to the client, so the self-join form
  // would leak a prev_* column into the response body.
  //
  // Deliberately NOT transactional: blob deletes are irreversible and cannot join a
  // DB transaction, and a stranded blob is strictly less bad than a failed update.
  let previousLogoUrl: string | null = null;
  if (nextLogoUrl !== undefined) {
    const prev = await queryOne<{ logo_url: string | null }>(
      `SELECT logo_url FROM organizations WHERE id = $1`,
      [orgId],
    );
    previousLogoUrl = prev?.logo_url ?? null;
  }

  // Dynamic UPDATE over the whitelisted keys (SET clauses built above).
  // UPDATE ... RETURNING returns no row when WHERE matches nothing, giving us
  // the 404 distinction without a separate existence SELECT.
  const { setClauses, params } = built;
  params.push(orgId);
  const idIndex = params.length;

  try {
    const organization = await queryOne(
      `UPDATE organizations SET ${setClauses.join(', ')}
       WHERE id = $${idIndex}
       RETURNING id, name, slug, logo_url, seat_limit, created_at`,
      params,
    );

    if (!organization) return reply(404, { error: 'Organization not found' });

    // Best-effort cleanup of the superseded logo, only after the row write
    // succeeded. An unchanged path is left alone; a null old path has nothing to
    // delete. deleteBlob never throws (so it can never reach the unique-violation
    // catch below) and its result is deliberately NOT surfaced in the response —
    // server logs are the only failure signal.
    if (previousLogoUrl && previousLogoUrl !== nextLogoUrl) {
      await deleteBlob(previousLogoUrl);
    }

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
