import { generateSasToken, buildBlobUrl } from '../shared/sas';
import { endpoint } from '../shared/endpoint';
import { canAccessLmsAsset } from '../shared/lms-asset';

export default endpoint('azure-view-url', async ({ req, profile, reply }) => {
    const { blobPath } = await req.json() as { blobPath: string };
    if (!blobPath) return reply(400, { error: 'blobPath is required' });

    // Access check — short-circuit for platform admins; otherwise the shared
    // can_user_access_lms_asset parity predicate (lesson asset columns + thumbnail).
    if (!profile.is_platform_admin) {
      const hasAccess = await canAccessLmsAsset(profile.id, blobPath);
      if (!hasAccess) return reply(403, { error: 'Access denied' });
    }

    const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME!;
    const accountKey = process.env.AZURE_STORAGE_ACCOUNT_KEY!;
    const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME ?? 'lms-videos';

    const sasToken = generateSasToken(accountName, accountKey, containerName, blobPath, 'r', 120);
    const viewUrl = buildBlobUrl(accountName, containerName, blobPath, sasToken);

    return reply(200, { viewUrl });
});
