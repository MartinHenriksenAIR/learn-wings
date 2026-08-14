import { queryOne } from '../shared/db';
import { endpoint } from '../shared/endpoint';
import { deleteBlob } from '../shared/blob';
import { enforceUploadLimits, type UploadCandidate } from '../shared/upload-limits';
import { assertBindablePaths, isBlobReleasable } from '../shared/blob-ownership';

interface ProfileUpdateBody {
  first_name?: unknown;
  last_name?: unknown;
  department?: unknown;
  preferred_language?: unknown;
  avatar_url?: unknown;
}

export default endpoint('profile-update', async ({ req, profile, reply }) => {
  const body = await req.json() as ProfileUpdateBody;

  for (const key of ['first_name', 'last_name', 'department', 'preferred_language', 'avatar_url'] as const) {
    if (body[key] !== undefined && typeof body[key] !== 'string') {
      return reply(400, { error: `${key} must be a string` });
    }
  }

  const firstName  = body.first_name  !== undefined ? (body.first_name  as string).trim() : undefined;
  const lastName   = body.last_name   !== undefined ? (body.last_name   as string).trim() : undefined;
  const department = body.department  !== undefined ? (body.department  as string).trim() : undefined;
  const prefLang   = body.preferred_language !== undefined ? (body.preferred_language as string).trim() : undefined;
  const avatarUrl  = body.avatar_url  !== undefined ? (body.avatar_url  as string).trim() : undefined;

  if (lastName !== undefined && firstName === undefined) {
    return reply(400, { error: 'first_name is required when last_name is provided' });
  }

  if (firstName !== undefined) {
    if (firstName.length === 0) {
      return reply(400, { error: 'first_name must not be empty' });
    }
    if (firstName.length > 50) {
      return reply(400, { error: 'first_name must be 50 characters or fewer' });
    }
  }

  if (lastName !== undefined && lastName.length > 50) {
    return reply(400, { error: 'last_name must be 50 characters or fewer' });
  }

  if (department !== undefined && department.length > 100) {
    return reply(400, { error: 'department must be 100 characters or fewer' });
  }

  if (prefLang !== undefined && prefLang !== 'en' && prefLang !== 'da') {
    return reply(400, { error: "preferred_language must be 'en' or 'da'" });
  }

  if (avatarUrl !== undefined && avatarUrl.length > 255) {
    return reply(400, { error: 'avatar_url must be 255 characters or fewer' });
  }

  const setClauses: string[] = [];
  const params: unknown[] = [];

  if (firstName !== undefined) {
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

  let previousAvatarUrl: string | null = null;
  if (nextAvatarUrl !== undefined) {
    const prev = await queryOne<{ avatar_url: string | null }>(
      `SELECT avatar_url FROM profiles WHERE id = $1`,
      [profile.id],
    );
    previousAvatarUrl = prev?.avatar_url ?? null;
  }

  const candidates: UploadCandidate[] = [{ path: nextAvatarUrl, kind: 'image', family: 'avatar' }];

  const bindError = await assertBindablePaths(candidates, [previousAvatarUrl]);
  if (bindError) {
    return reply(400, { error: bindError });
  }

  const limitError = await enforceUploadLimits(candidates, [previousAvatarUrl]);
  if (limitError) {
    return reply(413, { error: limitError });
  }

  params.push(profile.id);
  const whereParam = `$${params.length}`;

  const sql = `UPDATE profiles SET ${setClauses.join(', ')} WHERE id = ${whereParam} RETURNING id, full_name, first_name, last_name, department, email, avatar_url, is_platform_admin, preferred_language, created_at`;

  const updated = await queryOne(sql, params);

  if (!updated) return reply(404, { error: 'Profile not found' });

  if (previousAvatarUrl
    && previousAvatarUrl !== nextAvatarUrl
    && await isBlobReleasable(previousAvatarUrl, 'avatar')) {
    await deleteBlob(previousAvatarUrl);
  }

  return reply(200, { profile: updated });
});
