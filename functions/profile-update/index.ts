import { queryOne } from '../shared/db';
import { endpoint } from '../shared/endpoint';
import { deleteBlob } from '../shared/blob';
import { enforceUploadLimits } from '../shared/upload-limits';

interface ProfileUpdateBody {
  first_name?: unknown;
  last_name?: unknown;
  department?: unknown;
  preferred_language?: unknown;
  avatar_url?: unknown;
}

export default endpoint('profile-update', async ({ req, profile, reply }) => {
  const body = await req.json() as ProfileUpdateBody;

  // Validate types — all provided values must be strings
  for (const key of ['first_name', 'last_name', 'department', 'preferred_language', 'avatar_url'] as const) {
    if (body[key] !== undefined && typeof body[key] !== 'string') {
      return reply(400, { error: `${key} must be a string` });
    }
  }

  // Extract and trim string fields (only those actually provided in the body)
  const firstName  = body.first_name  !== undefined ? (body.first_name  as string).trim() : undefined;
  const lastName   = body.last_name   !== undefined ? (body.last_name   as string).trim() : undefined;
  const department = body.department  !== undefined ? (body.department  as string).trim() : undefined;
  const prefLang   = body.preferred_language !== undefined ? (body.preferred_language as string).trim() : undefined;
  const avatarUrl  = body.avatar_url  !== undefined ? (body.avatar_url  as string).trim() : undefined;

  // last_name without first_name: reject (full_name derivation requires first_name)
  if (lastName !== undefined && firstName === undefined) {
    return reply(400, { error: 'first_name is required when last_name is provided' });
  }

  // Validate first_name non-empty and max 50 chars
  if (firstName !== undefined) {
    if (firstName.length === 0) {
      return reply(400, { error: 'first_name must not be empty' });
    }
    if (firstName.length > 50) {
      return reply(400, { error: 'first_name must be 50 characters or fewer' });
    }
  }

  // Validate last_name max 50 chars (empty string is allowed → stored as NULL)
  if (lastName !== undefined && lastName.length > 50) {
    return reply(400, { error: 'last_name must be 50 characters or fewer' });
  }

  // Validate department max 100 chars (empty string is allowed → stored as NULL)
  if (department !== undefined && department.length > 100) {
    return reply(400, { error: 'department must be 100 characters or fewer' });
  }

  // Validate preferred_language
  if (prefLang !== undefined && prefLang !== 'en' && prefLang !== 'da') {
    return reply(400, { error: "preferred_language must be 'en' or 'da'" });
  }

  // Validate avatar_url max 255 chars (empty string is allowed → stored as NULL to clear the photo)
  if (avatarUrl !== undefined && avatarUrl.length > 255) {
    return reply(400, { error: 'avatar_url must be 255 characters or fewer' });
  }

  // Build dynamic parameterized SET clause
  const setClauses: string[] = [];
  const params: unknown[] = [];

  if (firstName !== undefined) {
    // When first_name is provided, always update first_name, last_name, and full_name together
    params.push(firstName);
    setClauses.push(`first_name = $${params.length}`);

    const lastNameStored = lastName !== undefined && lastName.length > 0 ? lastName : null;
    params.push(lastNameStored);
    setClauses.push(`last_name = $${params.length}`);

    const fullName = lastNameStored != null ? `${firstName} ${lastNameStored}` : firstName;
    params.push(fullName);
    setClauses.push(`full_name = $${params.length}`);
  }

  if (department !== undefined) {
    const departmentStored = department.length > 0 ? department : null;
    params.push(departmentStored);
    setClauses.push(`department = $${params.length}`);
  }

  if (prefLang !== undefined) {
    params.push(prefLang);
    setClauses.push(`preferred_language = $${params.length}`);
  }

  // The blob path this update will write to avatar_url. Empty string clears the
  // photo (stored as NULL); otherwise store the raw container-relative blob path
  // verbatim (display composes the URL). `undefined` = the caller never supplied
  // avatar_url, which is NOT a clear: an absent key leaves the column (and its
  // blob) alone.
  const nextAvatarUrl = avatarUrl === undefined
    ? undefined
    : (avatarUrl.length > 0 ? avatarUrl : null);

  if (nextAvatarUrl !== undefined) {
    params.push(nextAvatarUrl);
    setClauses.push(`avatar_url = $${params.length}`);
  }

  if (setClauses.length === 0) {
    return reply(400, { error: 'No updatable fields provided' });
  }

  // Previous avatar blob path, read before the write so the superseded blob can be
  // deleted afterwards — a replace (or a clear-to-null) used to strand the file.
  // Issued ONLY when the update actually writes the column, so a name/language
  // change costs no extra round trip and can never delete a live avatar. The path
  // has to be queried explicitly: CallerProfile is deliberately minimal (id +
  // is_platform_admin) and does not carry avatar_url.
  //
  // A plain SELECT rather than pulling the old value out of the UPDATE itself: the
  // RETURNING row is handed straight back to the client, so the self-join form
  // would leak a prev_* column into the response body.
  //
  // Deliberately NOT transactional: blob deletes are irreversible and cannot join a
  // DB transaction, and a stranded blob is strictly less bad than a failed update.
  let previousAvatarUrl: string | null = null;
  if (nextAvatarUrl !== undefined) {
    const prev = await queryOne<{ avatar_url: string | null }>(
      `SELECT avatar_url FROM profiles WHERE id = $1`,
      [profile.id],
    );
    previousAvatarUrl = prev?.avatar_url ?? null;
  }

  // Size/type gate on a newly-referenced avatar (#276). This endpoint is open to
  // every authenticated user, and `azure-upload-url` mints avatar URLs without a
  // platform-admin gate, so it is the only place an avatar's real size is ever
  // checked. Reuses the same change detection as the cleanup below: an unchanged
  // path is not new, so a name/language change costs no HEAD.
  const limitError = await enforceUploadLimits(
    [{ path: nextAvatarUrl, kind: 'image' }],
    [previousAvatarUrl],
  );
  if (limitError) {
    return reply(413, { error: limitError });
  }

  // Caller can ONLY update their own row — id comes from the authenticated profile, never from the body
  params.push(profile.id);
  const whereParam = `$${params.length}`;

  const sql = `UPDATE profiles SET ${setClauses.join(', ')} WHERE id = ${whereParam} RETURNING id, full_name, first_name, last_name, department, email, avatar_url, is_platform_admin, preferred_language, created_at`;

  const updated = await queryOne(sql, params);

  // The row can vanish between getProfile and the UPDATE (account deletion race) —
  // without this guard the endpoint would answer 200 { profile: null }.
  if (!updated) return reply(404, { error: 'Profile not found' });

  // Best-effort cleanup of the superseded avatar, only after the row write
  // succeeded. An unchanged path is left alone; a null old path has nothing to
  // delete. deleteBlob never throws and its result is deliberately NOT surfaced in
  // the response — server logs are the only failure signal.
  if (previousAvatarUrl && previousAvatarUrl !== nextAvatarUrl) {
    await deleteBlob(previousAvatarUrl);
  }

  return reply(200, { profile: updated });
});
