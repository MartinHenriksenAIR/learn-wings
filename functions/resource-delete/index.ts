import { query } from '../shared/db';
import { endpoint } from '../shared/endpoint';
import { loadResourceForWrite } from '../shared/resources';

export default endpoint('resource-delete', async ({ req, profile, reply }) => {
  const body = await req.json() as { resourceId?: unknown };
  const { resourceId } = body;

  if (!resourceId || typeof resourceId !== 'string') {
    return reply(400, { error: 'resourceId is required' });
  }

  const resource = await loadResourceForWrite(resourceId, profile);
  if (!resource) return reply(404, { error: 'Resource not found' });

  await query(`DELETE FROM community_resources WHERE id = $1`, [resourceId]);

  return reply(200, { ok: true });
});
