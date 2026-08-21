import { createHmac, timingSafeEqual } from 'node:crypto';

const KEY_LABEL = 'blob-release-v1';
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

function signingKey(): Buffer | null {
  const accountKey = process.env.AZURE_STORAGE_ACCOUNT_KEY;
  if (!accountKey) return null;
  return createHmac('sha256', Buffer.from(accountKey, 'base64')).update(KEY_LABEL).digest();
}

function sign(key: Buffer, blobPath: string, profileId: string, expiresAt: number): string {
  return createHmac('sha256', key)
    .update(`${blobPath}\n${profileId}\n${expiresAt}`)
    .digest('base64url');
}

function matches(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

export function mintReleaseToken(blobPath: string, profileId: string, now = Date.now()): string | null {
  const key = signingKey();
  if (!key) return null;
  const expiresAt = now + TOKEN_TTL_MS;
  return `${expiresAt}.${sign(key, blobPath, profileId, expiresAt)}`;
}

export function verifyReleaseToken(
  token: string,
  blobPath: string,
  profileId: string,
  now = Date.now(),
): boolean {
  const key = signingKey();
  if (!key) return false;

  const separator = token.indexOf('.');
  if (separator <= 0) return false;

  const expiresAt = Number(token.slice(0, separator));
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) return false;

  return matches(token.slice(separator + 1), sign(key, blobPath, profileId, expiresAt));
}
