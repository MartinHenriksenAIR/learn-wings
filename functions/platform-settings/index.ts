import { query } from '../shared/db';
import { endpoint } from '../shared/endpoint';

export default endpoint('platform-settings', async ({ profile, reply }) => {
  const settings = profile.is_platform_admin
    ? await query(`SELECT key, value FROM platform_settings ORDER BY key`)
    : await query(`SELECT key, value FROM platform_settings WHERE key = 'features'`);
  return reply(200, { settings });
});
