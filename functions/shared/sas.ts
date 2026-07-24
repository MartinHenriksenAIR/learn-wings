import { createHmac } from 'node:crypto';

/**
 * The Blob Service SAS version every token in this fleet is signed with.
 *
 * Exported because a request whose SHAPE depends on the service version (List
 * Blobs, whose response schema is versioned) must send the SAME value as
 * `x-ms-version`. Sharing one constant is what stops the signed `sv` and the
 * request header from silently drifting apart.
 */
export const SAS_SIGNED_VERSION = '2022-11-02';

/**
 * Which Azure resource a SAS is scoped to — the `sr` field, which also decides
 * the shape of the canonical resource inside the string-to-sign.
 *
 *  - `'b'` — a single blob (`/blob/{account}/{container}/{blob}`). Every
 *    upload / read / delete in the fleet. This is the DEFAULT, so no existing
 *    call site changes behaviour.
 *  - `'c'` — the whole container (`/blob/{account}/{container}`). Required for
 *    List Blobs (`sp=l` plus `restype=container&comp=list`), which a
 *    blob-scoped SAS cannot authorize at all. `blobName` is ignored.
 */
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
  // A container SAS signs the container itself — appending a blob segment (even
  // an empty one, which would leave a trailing slash) produces a signature Azure
  // rejects with AuthenticationFailed.
  const canonicalResource =
    resourceType === 'c'
      ? `/blob/${accountName}/${containerName}`
      : `/blob/${accountName}/${containerName}/${blobName}`;

  // Azure Blob Service SAS string-to-sign (sv=2022-11-02, blob OR container resource —
  // the field order and count are identical; only signedResource + canonicalResource differ)
  // https://learn.microsoft.com/en-us/rest/api/storageservices/create-service-sas
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

/**
 * Container-scoped SAS (`sr=c`) — the only form that can authorize List Blobs.
 *
 * A named wrapper rather than a raw `generateSasToken(..., '', perms, mins, 'c')`
 * at the call site: the empty blob-name argument in the middle of a positional
 * list is exactly the kind of thing a later edit "fixes" by putting a blob name
 * back, which would silently sign the wrong canonical resource.
 */
export function generateContainerSasToken(
  accountName: string,
  accountKey: string,
  containerName: string,
  permissions: string,
  expiryMinutes: number
): string {
  return generateSasToken(accountName, accountKey, containerName, '', permissions, expiryMinutes, 'c');
}

export function buildBlobUrl(
  accountName: string,
  containerName: string,
  blobName: string,
  sasToken: string
): string {
  return `https://${accountName}.blob.core.windows.net/${containerName}/${blobName}?${sasToken}`;
}
