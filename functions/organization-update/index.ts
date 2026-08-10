import { queryOne, isUniqueViolation } from '../shared/db';
import { endpoint } from '../shared/endpoint';
import { isOrgAdmin } from '../shared/profile';
import { validateOrgName, validateOrgSlug, normalizeOrgName } from '../shared/org-validation';
import { buildUpdateSet } from '../shared/update-builder';
import { deleteBlob } from '../shared/blob';
import { enforceUploadLimits, type UploadCandidate } from '../shared/upload-limits';
import { assertBindablePaths, isBlobReleasable } from '../shared/blob-ownership';
import { CONSUMER_TENANT_ID } from '../shared/tenant-binding';

// The platform-admin-writable whitelist. Org admins are held to the narrower
// ORG_ADMIN_WRITABLE subset by the authz gate below.
//
// entra_tid / entra_tid_label are the SSO tenant binding (#353) — platform-admin
// only (absent from ORG_ADMIN_WRITABLE). Normally auto-seeded
// (functions/shared/tenant-binding); this endpoint is the set/correct/clear
// override. allow_self_registration (#356) is the per-org on/off switch for that
// tenant auto-join: platform-admin overridable here AND org-admin writable, since
// the issue puts it in the org's own hands day-to-day.
const ALLOWED_UPDATE_FIELDS = new Set(['name', 'slug', 'logo_url', 'seat_limit', 'entra_tid', 'entra_tid_label', 'allow_self_registration']);

// The subset an org admin (not a platform admin) may write for their own org —
// org-owned day-to-day settings. Every other field is platform-admin-only.
// name (#369): an org admin may rename their OWN org (within-tenant, validated by
// validateOrgName below). slug stays platform-admin-only — it is URL-facing and
// UNIQUE, so a rename there is a cross-cutting change, not a day-to-day setting.
const ORG_ADMIN_WRITABLE = new Set(['name', 'logo_url', 'allow_self_registration']);

// Entra tenant ids are lowercase GUIDs. Stored lowercased (see the transform) so
// they match the verified token `tid` exactly.
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default endpoint('organization-update', async ({ req, profile, reply }) => {
  const body = await req.json() as { orgId?: unknown; updates?: unknown };
  const { orgId, updates } = body;

  if (!orgId || typeof orgId !== 'string') {
    return reply(400, { error: 'orgId is required' });
  }

  // #353: clearing the tenant binding must also clear its label — a label with
  // no tid is a stale hint that misrepresents auto-join as active. Enforced here
  // (authoritative) so it holds regardless of what the client sent, and BEFORE
  // buildUpdateSet so the forced null lands in both validation and the SET.
  if (updates && typeof updates === 'object' && !Array.isArray(updates)
      && (updates as Record<string, unknown>).entra_tid === null) {
    (updates as Record<string, unknown>).entra_tid_label = null;
  }

  const built = buildUpdateSet(updates, ALLOWED_UPDATE_FIELDS, {
    transform: (key, value) => {
      if (key === 'name') return normalizeOrgName(value as string);
      // Normalize a tenant id to a lowercased/trimmed GUID so it matches the
      // verified token tid exactly; leave null (clear) and non-strings alone.
      if (key === 'entra_tid' && typeof value === 'string') return value.trim().toLowerCase();
      return value;
    },
  });
  if (!built.ok) {
    return reply(400, { error: built.error });
  }

  const updatesObj = updates as Record<string, unknown>;
  const updateKeys = Object.keys(updatesObj);

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
    } else if (key === 'entra_tid') {
      // null clears the binding; otherwise a GUID that is NOT the shared
      // consumer/MSA tenant (which would auto-join every personal MS account).
      if (v !== null) {
        if (typeof v !== 'string' || !GUID_RE.test(v.trim())) {
          return reply(400, { error: 'entra_tid must be a tenant GUID or null' });
        }
        if (v.trim().toLowerCase() === CONSUMER_TENANT_ID) {
          return reply(400, { error: 'That is the shared personal-Microsoft-account tenant and cannot be linked to an organization', code: 'CONSUMER_TENANT' });
        }
      }
    } else if (key === 'entra_tid_label') {
      // A domain hint; bounded at the DNS max (253) so it can't be an abuse sink.
      if (v !== null && (typeof v !== 'string' || v.length > 253)) {
        return reply(400, { error: 'entra_tid_label must be a string (max 253 chars) or null' });
      }
    } else if (key === 'allow_self_registration') {
      // #356: strictly boolean — the column is NOT NULL, so null is not a valid write.
      if (typeof v !== 'boolean') {
        return reply(400, { error: 'allow_self_registration must be a boolean' });
      }
    }
  }

  // Authorization: platform admin → any whitelisted field; org admin of the target
  // org → the ORG_ADMIN_WRITABLE subset only (name, logo_url, allow_self_registration).
  // RLS provenance: supabase/migrations/20260127153401_*.sql:269-276 ("Platform admins
  // can do everything with orgs") + 20260128223657 ("Org admins can update their org
  // logo", FOR UPDATE is_org_admin(id)). The old policy was row-scoped (technically any
  // column); we tighten to the migration's stated intent — logo_url — plus
  // allow_self_registration (#356) and name (#369, the org's own display name), both
  // handed to the org to own day-to-day.
  if (!profile.is_platform_admin) {
    const onlyOrgAdminFields = updateKeys.every((key) => ORG_ADMIN_WRITABLE.has(key));
    const allowed = onlyOrgAdminFields && await isOrgAdmin(profile.id, orgId);
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

  const { setClauses, params } = built;
  params.push(orgId);
  const idIndex = params.length;

  try {
    const organization = await queryOne(
      `UPDATE organizations SET ${setClauses.join(', ')}
       WHERE id = $${idIndex}
       RETURNING id, name, slug, logo_url, seat_limit, entra_tid, entra_tid_label, allow_self_registration, created_at`,
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
    if (isUniqueViolation(dbErr)) {
      // The org has two UNIQUE columns now — distinguish so the caller sees which.
      if ((dbErr as { constraint?: string }).constraint === 'organizations_entra_tid_key') {
        return reply(409, { error: 'This Microsoft tenant is already linked to another organization', code: 'DUPLICATE_TENANT' });
      }
      return reply(409, { error: 'Slug already in use', code: 'DUPLICATE_SLUG' });
    }
    throw dbErr;
  }
});
