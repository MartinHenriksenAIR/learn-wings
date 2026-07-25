import { generateSasToken, buildBlobUrl } from '../shared/sas';
import { endpoint } from '../shared/endpoint';
import { resolveAssetContainer, isBrandingAssetType } from '../shared/blob';
import { fileExtension, resolveUploadKind } from '../shared/upload-limits';

export default endpoint('azure-upload-url', async ({ req, reply, requirePlatformAdmin }) => {
  const { fileName, contentType: reqContentType, assetType } = await req.json() as { fileName: string; contentType?: string; assetType?: string };
  if (!fileName) return reply(400, { error: 'fileName is required' });

  // Branding uploads (org logos, avatars) are open to any authenticated user:
  // the blob is inert until its path is persisted, and that step is separately
  // authorized (organization-update requires org admin for logo_url; profile-
  // update writes only the caller's own avatar_url). Every other upload targets
  // the course-content container and remains platform-admin only.
  if (!isBrandingAssetType(assetType)) {
    requirePlatformAdmin();
  }

  // Allow-list the DECLARED extension + content type (#276). Defence in depth
  // only: the client PUTs whatever bytes it likes to the URL we hand back, so
  // the binding check is the post-upload HEAD at persist time
  // (`enforceUploadLimits`). What this does buy is that the blob path we mint
  // always carries a known-good extension, and that an obviously-wrong pair
  // (`logo.png` declared `video/mp4`) never gets a URL at all.
  //
  // The kind is INFERRED, not declared: this endpoint serves videos, course
  // thumbnails, documents and branding assets alike, and `assetType` only
  // distinguishes branding assets from everything else.
  const kind = resolveUploadKind(fileName, reqContentType);
  if (!kind) {
    return reply(400, { error: 'File type not allowed' });
  }
  // A branding asset is an org logo or an avatar — always an image, whatever the
  // caller's filename suggests. Without this, the branding path (which skips the
  // platform-admin gate above by design) would let ANY authenticated user mint an
  // upload URL for a 2 GB "video" under the avatars/ prefix.
  if (isBrandingAssetType(assetType) && kind !== 'image') {
    return reply(400, { error: 'File type not allowed' });
  }

  const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME!;
  const accountKey = process.env.AZURE_STORAGE_ACCOUNT_KEY!;
  if (!accountName || !accountKey) {
    return reply(500, { error: 'Azure storage not configured' });
  }

  const { container: containerName, prefix } = resolveAssetContainer(assetType);

  // The allow-listed extension rather than a raw `split('.').pop()`: it is
  // already normalized to lower-case alphanumerics, so the minted path can never
  // inherit whatever the caller put after the last dot.
  const blobPath = `${prefix}${crypto.randomUUID()}.${fileExtension(fileName)}`;
  const contentType = reqContentType ?? 'application/octet-stream';

  const sasToken = generateSasToken(accountName, accountKey, containerName, blobPath, 'cw', 30);
  const uploadUrl = buildBlobUrl(accountName, containerName, blobPath, sasToken);

  return reply(200, { uploadUrl, blobPath, contentType });
});
