import { query } from '../shared/db';
import { endpoint } from '../shared/endpoint';

export default endpoint('platform-settings', async ({ profile, reply }) => {
  if (!profile.is_platform_admin) {
    // RLS parity: the original Supabase RLS restricted platform_settings SELECT to platform admins only.
    // Non-admins receive an empty array (not 403) because the frontend hook runs for every authenticated
    // user and treats empty settings as "use client-side defaults". A 403 would break normal users.
    // This also prevents leaking SMTP credentials stored in the 'email' settings key to non-admins.
    return reply(200, { settings: [] });
  }

  const settings = await query(
    `SELECT key, value FROM platform_settings ORDER BY key`,
  );
  return reply(200, { settings });
});
