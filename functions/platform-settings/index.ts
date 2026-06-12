import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { query } from '../shared/db';
import { corsPreflightResponse, corsResponse } from '../shared/cors';
import { getProfile } from '../shared/profile';

async function handler(req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin);
  try {
    const user = await authenticate(req);
    const profile = await getProfile(user);
    if (!profile) return corsResponse(origin, 401, { error: 'Profile not found' });

    if (!profile.is_platform_admin) {
      // RLS parity: the original Supabase RLS restricted platform_settings SELECT to platform admins only.
      // Non-admins receive an empty array (not 403) because the frontend hook runs for every authenticated
      // user and treats empty settings as "use client-side defaults". A 403 would break normal users.
      // This also prevents leaking SMTP credentials stored in the 'email' settings key to non-admins.
      return corsResponse(origin, 200, { settings: [] });
    }

    const settings = await query(
      `SELECT key, value FROM platform_settings ORDER BY key`,
    );
    return corsResponse(origin, 200, { settings });
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message });
    return corsResponse(origin, 500, { error: err instanceof Error ? err.message : 'Unknown error' });
  }
}

export default handler;
app.http('platform-settings', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
