import { query } from '../shared/db';
import { adminEndpoint } from '../shared/endpoint';

// Platform-admin-only: the list of everyone holding profiles.is_platform_admin.
// Feeds the "Platform Admins" section in Platform Settings (#128). Route name
// avoids the reserved 'admin' prefix by using the 'platform-' namespace.
export default adminEndpoint('platform-admins', async ({ reply }) => {
  const admins = await query(
    `SELECT id, full_name, email
       FROM profiles
      WHERE is_platform_admin = true
      ORDER BY full_name`,
  );
  return reply(200, { admins });
});
