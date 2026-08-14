import { query } from '../shared/db';
import { endpoint } from '../shared/endpoint';

export default endpoint('platform-settings', async ({ profile, reply }) => {
  if (!profile.is_platform_admin) {
    return reply(200, { settings: [] });
  }

  const settings = await query(
    `SELECT key, value FROM platform_settings ORDER BY key`,
  );
  return reply(200, { settings });
});
