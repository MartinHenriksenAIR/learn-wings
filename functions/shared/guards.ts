import type { HttpRequest, HttpResponseInit } from '@azure/functions';
import { authenticate, AuthError } from './auth';
import { corsResponse } from './cors';
import { getProfile } from './profile';
import type { CallerProfile } from './profile';

/**
 * Discriminated result of the platform-admin gate: either the caller's profile
 * (authorized) or the exact 401/403 response the endpoint must return as-is.
 */
export type PlatformAdminGate =
  | { ok: true; profile: CallerProfile }
  | { ok: false; response: HttpResponseInit };

/**
 * The shared platform-admin preamble: authenticate → getProfile → 401 if the
 * profile is not provisioned → 403 if the caller is not a platform admin.
 *
 * Response contract (pinned by every gated endpoint's tests — do not change):
 * - AuthError from authenticate → 401 { error: err.message }
 * - profile not provisioned     → 401 { error: 'Profile not found' }
 * - not a platform admin        → 403 { error: opts.forbiddenError ?? 'Forbidden' }
 *
 * Non-AuthError failures (e.g. DB errors from getProfile) are rethrown so the
 * endpoint's own catch keeps producing its 500 shape.
 */
export async function requirePlatformAdmin(
  req: Pick<HttpRequest, 'headers'>,
  origin: string | null,
  opts?: { forbiddenError?: string },
): Promise<PlatformAdminGate> {
  let profile: CallerProfile | null;
  try {
    const user = await authenticate(req);
    profile = await getProfile(user);
  } catch (err: unknown) {
    if (err instanceof AuthError) {
      return { ok: false, response: corsResponse(origin, 401, { error: err.message }) };
    }
    throw err;
  }
  if (!profile) {
    return { ok: false, response: corsResponse(origin, 401, { error: 'Profile not found' }) };
  }
  if (!profile.is_platform_admin) {
    return {
      ok: false,
      response: corsResponse(origin, 403, { error: opts?.forbiddenError ?? 'Forbidden' }),
    };
  }
  return { ok: true, profile };
}
