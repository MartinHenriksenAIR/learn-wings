import { queryOne, isUniqueViolation } from '../shared/db';
import { endpoint } from '../shared/endpoint';
import { isOrgAdmin } from '../shared/profile';
import { validateOrgName, validateOrgSlug, normalizeOrgName } from '../shared/org-validation';
import { buildUpdateSet } from '../shared/update-builder';
import { deleteBlob } from '../shared/blob';
import { enforceUploadLimits, type UploadCandidate } from '../shared/upload-limits';
import { assertBindablePaths, isBlobReleasable } from '../shared/blob-ownership';
import { CONSUMER_TENANT_ID } from '../shared/tenant-binding';
import { isMemberLanguage } from '../shared/member-language';

const ALLOWED_UPDATE_FIELDS = new Set(['name', 'slug', 'logo_url', 'seat_limit', 'entra_tid', 'entra_tid_label', 'allow_self_registration', 'default_member_language']);

const ORG_ADMIN_WRITABLE = new Set(['name', 'logo_url', 'allow_self_registration', 'default_member_language']);

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default endpoint('organization-update', async ({ req, profile, reply }) => {
  const body = await req.json() as { orgId?: unknown; updates?: unknown };
  const { orgId, updates } = body;

  if (!orgId || typeof orgId !== 'string') {
    return reply(400, { error: 'orgId is required' });
  }

  if (updates && typeof updates === 'object' && !Array.isArray(updates)
      && (updates as Record<string, unknown>).entra_tid === null) {
    (updates as Record<string, unknown>).entra_tid_label = null;
  }

  const built = buildUpdateSet(updates, ALLOWED_UPDATE_FIELDS, {
    transform: (key, value) => {
      if (key === 'name') return normalizeOrgName(value as string);
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
      if (v !== null) {
        if (typeof v !== 'string' || !GUID_RE.test(v.trim())) {
          return reply(400, { error: 'entra_tid must be a tenant GUID or null' });
        }
        if (v.trim().toLowerCase() === CONSUMER_TENANT_ID) {
          return reply(400, { error: 'That is the shared personal-Microsoft-account tenant and cannot be linked to an organization', code: 'CONSUMER_TENANT' });
        }
      }
    } else if (key === 'entra_tid_label') {
      if (v !== null && (typeof v !== 'string' || v.length > 253)) {
        return reply(400, { error: 'entra_tid_label must be a string (max 253 chars) or null' });
      }
    } else if (key === 'allow_self_registration') {
      if (typeof v !== 'boolean') {
        return reply(400, { error: 'allow_self_registration must be a boolean' });
      }
    } else if (key === 'default_member_language') {
      if (v !== null && !isMemberLanguage(v)) {
        return reply(400, { error: "default_member_language must be 'en', 'da', or null" });
      }
    }
  }

  if (!profile.is_platform_admin) {
    const onlyOrgAdminFields = updateKeys.every((key) => ORG_ADMIN_WRITABLE.has(key));
    const allowed = onlyOrgAdminFields && await isOrgAdmin(profile.id, orgId);
    if (!allowed) {
      return reply(403, { error: 'Forbidden' });
    }
  }

  const nextLogoUrl = 'logo_url' in updatesObj
    ? (updatesObj.logo_url as string | null)
    : undefined;

  let previousLogoUrl: string | null = null;
  if (nextLogoUrl !== undefined) {
    const prev = await queryOne<{ logo_url: string | null }>(
      `SELECT logo_url FROM organizations WHERE id = $1`,
      [orgId],
    );
    previousLogoUrl = prev?.logo_url ?? null;
  }

  const candidates: UploadCandidate[] = [{ path: nextLogoUrl, kind: 'image', family: 'org-logo' }];

  const bindError = await assertBindablePaths(candidates, [previousLogoUrl]);
  if (bindError) {
    return reply(400, { error: bindError });
  }

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
       RETURNING id, name, slug, logo_url, seat_limit, entra_tid, entra_tid_label, allow_self_registration, default_member_language, created_at`,
      params,
    );

    if (!organization) return reply(404, { error: 'Organization not found' });

    if (previousLogoUrl
      && previousLogoUrl !== nextLogoUrl
      && await isBlobReleasable(previousLogoUrl, 'org-logo')) {
      await deleteBlob(previousLogoUrl);
    }

    return reply(200, { organization });
  } catch (dbErr: unknown) {
    if (isUniqueViolation(dbErr)) {
      if ((dbErr as { constraint?: string }).constraint === 'organizations_entra_tid_key') {
        return reply(409, { error: 'This Microsoft tenant is already linked to another organization', code: 'DUPLICATE_TENANT' });
      }
      return reply(409, { error: 'Slug already in use', code: 'DUPLICATE_SLUG' });
    }
    throw dbErr;
  }
});
