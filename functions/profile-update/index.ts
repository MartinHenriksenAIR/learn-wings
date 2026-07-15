import { queryOne } from '../shared/db';
import { endpoint } from '../shared/endpoint';

interface ProfileUpdateBody {
  first_name?: unknown;
  last_name?: unknown;
  department?: unknown;
  preferred_language?: unknown;
}

export default endpoint('profile-update', async ({ req, profile, reply }) => {
  const body = await req.json() as ProfileUpdateBody;

  // Validate types — all provided values must be strings
  for (const key of ['first_name', 'last_name', 'department', 'preferred_language'] as const) {
    if (body[key] !== undefined && typeof body[key] !== 'string') {
      return reply(400, { error: `${key} must be a string` });
    }
  }

  // Extract and trim string fields (only those actually provided in the body)
  const firstName  = body.first_name  !== undefined ? (body.first_name  as string).trim() : undefined;
  const lastName   = body.last_name   !== undefined ? (body.last_name   as string).trim() : undefined;
  const department = body.department  !== undefined ? (body.department  as string).trim() : undefined;
  const prefLang   = body.preferred_language !== undefined ? (body.preferred_language as string).trim() : undefined;

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

  if (setClauses.length === 0) {
    return reply(400, { error: 'No updatable fields provided' });
  }

  // Caller can ONLY update their own row — id comes from the authenticated profile, never from the body
  params.push(profile.id);
  const whereParam = `$${params.length}`;

  const sql = `UPDATE profiles SET ${setClauses.join(', ')} WHERE id = ${whereParam} RETURNING id, full_name, first_name, last_name, department, email, avatar_url, is_platform_admin, preferred_language, created_at`;

  const updated = await queryOne(sql, params);

  // The row can vanish between getProfile and the UPDATE (account deletion race) —
  // without this guard the endpoint would answer 200 { profile: null }.
  if (!updated) return reply(404, { error: 'Profile not found' });

  return reply(200, { profile: updated });
});
