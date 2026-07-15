import { deleteBlob } from '../shared/blob';
import { adminEndpoint } from '../shared/endpoint';

export default adminEndpoint('azure-delete-blob', async ({ req, reply }) => {
  const { blobPath } = await req.json() as { blobPath: string };
  if (!blobPath) return reply(400, { error: 'blobPath is required' });

  const deleted = await deleteBlob(blobPath);
  if (!deleted) {
    return reply(500, { error: 'Blob delete failed' });
  }

  return reply(200, { success: true, message: 'Blob deleted' });
});
