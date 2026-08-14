import { createHmac } from 'node:crypto';

export const SAS_SIGNED_VERSION = '2022-11-02';

export type SasResourceType = 'b' | 'c';

export function generateSasToken(
  accountName: string,
  accountKey: string,
  containerName: string,
  blobName: string,
  permissions: string,
  expiryMinutes: number,
  resourceType: SasResourceType = 'b'
): string {
  const start = new Date();
  start.setMinutes(start.getMinutes() - 5); // clock skew buffer
  const expiry = new Date();
  expiry.setMinutes(expiry.getMinutes() + expiryMinutes);

  const startTime = start.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const expiryTime = expiry.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const signedVersion = SAS_SIGNED_VERSION;
  const signedResource = resourceType;
  const canonicalResource =
    resourceType === 'c'
      ? `/blob/${accountName}/${containerName}`
      : `/blob/${accountName}/${containerName}/${blobName}`;

  const stringToSign = [
    permissions,      // signedPermissions
    startTime,        // signedStart
    expiryTime,       // signedExpiry
    canonicalResource,
    '',               // signedIdentifier
    '',               // signedIP
    'https',          // signedProtocol
    signedVersion,
    signedResource,
    '',               // signedSnapshotTime
    '',               // signedEncryptionScope
    '',               // rscc (cache-control)
    '',               // rscd (content-disposition)
    '',               // rsce (content-encoding)
    '',               // rscl (content-language)
    '',               // rsct (content-type)
  ].join('\n');

  const keyBuffer = Buffer.from(accountKey, 'base64');
  const signature = createHmac('sha256', keyBuffer).update(stringToSign, 'utf8').digest('base64');

  return new URLSearchParams({
    sp: permissions,
    st: startTime,
    se: expiryTime,
    sr: signedResource,
    sv: signedVersion,
    spr: 'https',
    sig: signature,
  }).toString();
}

export function generateContainerSasToken(
  accountName: string,
  accountKey: string,
  containerName: string,
  permissions: string,
  expiryMinutes: number
): string {
  return generateSasToken(accountName, accountKey, containerName, '', permissions, expiryMinutes, 'c');
}

function encodeBlobPath(blobName: string): string {
  return blobName.split('/').map(encodeSegment).join('/');
}

function encodeSegment(segment: string): string {
  try {
    return encodeURIComponent(segment);
  } catch {
    return encodeURIComponent(segment.replace(/[\uD800-\uDFFF]/g, '�'));
  }
}

export function buildBlobUrl(
  accountName: string,
  containerName: string,
  blobName: string,
  sasToken: string
): string {
  return `https://${accountName}.blob.core.windows.net/${containerName}/${encodeBlobPath(blobName)}?${sasToken}`;
}
