import { queryOne, isUniqueViolation } from '../shared/db';
import { endpoint } from '../shared/endpoint';
import { isOrgAdmin } from '../shared/profile';
import { validateOrgName, validateOrgSlug, normalizeOrgName } from '../shared/org-validation';
import { buildUpdateSet } from '../shared/update-builder';
import { deleteBlob } from '../shared/blob';
import { enforceUploadLimits, type UploadCandidate } from '../shared/upload-limits';
import { assertBindablePaths, isBlobReleasable } from '../shared/blob-ownership';

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

  // One candidate list, handed to both gates in order, so they can never be given
  // different views of the same write. `family: 'org-logo'` is the column's
  // property, not the caller's claim.
  const candidates: UploadCandidate[] = [{ path: nextLogoUrl, kind: 'image', family: 'org-logo' }];

  // Ownership gate FIRST — an org admin is authorized to write THIS org's
  // logo_url, which says nothing about whether the path they supplied is theirs.
  // `organizations` hands `logo_url` to plain learners, so every other org's logo
  // path is readable; before this gate, posting one here aimed the storage probe
  // (and the superseded-blob delete) straight at it. Placed after the authz gate
  // for the same reason as the SELECT above, and before `enforceUploadLimits` so
  // that no foreign path is ever handed to `headBlob`.
  const bindError = await assertBindablePaths(candidates, [previousLogoUrl]);
  if (bindError) {
    return reply(400, { error: bindError });
  }

  // Size/type gate on a newly-referenced logo (#276). Any org admin can write
  // logo_url and `azure-upload-url` mints org-logo URLs without a platform-admin
  // gate, so this is the only place a logo's real size is ever checked. Reuses the
  // same change detection as the cleanup below: an unchanged path is not new, so
  // it costs no HEAD.
  const limitError = await enforceUploadLimits(candidates, [previousLogoUrl]);
  if (limitError) {
    return reply(413, { error: limitError });
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
    //
    // `isBlobReleasable` runs AFTER the UPDATE on purpose: the row now points at
    // the new value, so "does any row still reference the old path?" is exactly
    // the question worth asking. It also never throws, so it cannot reach the
    // unique-violation catch below either.
    if (previousLogoUrl
      && previousLogoUrl !== nextLogoUrl
      && await isBlobReleasable(previousLogoUrl, 'org-logo')) {
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
