import { endpoint } from '../shared/endpoint';
import { mintLmsAssetUrl } from '../shared/lms-asset';

export default endpoint('azure-view-url', async ({ req, profile, reply }) => {
  const body = await req.json() as { blobPath?: unknown };
  const result = await mintLmsAssetUrl(profile, body.blobPath);
  if (!result.ok) return reply(result.status, { error: result.error });
  return reply(200, { viewUrl: result.url });
});
