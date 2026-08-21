import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mintReleaseToken, verifyReleaseToken } from './release-token';

const KEY = Buffer.alloc(32, 7).toString('base64');
const OTHER_KEY = Buffer.alloc(32, 9).toString('base64');

const PATH = 'avatars/11111111-1111-1111-1111-111111111111.png';
const PROFILE = 'p1';
const NOW = 1_760_000_000_000;

describe('release tokens', () => {
  beforeEach(() => {
    process.env.AZURE_STORAGE_ACCOUNT_KEY = KEY;
  });

  afterEach(() => {
    process.env.AZURE_STORAGE_ACCOUNT_KEY = KEY;
  });

  it('a freshly minted token verifies for the path and profile it was minted for', () => {
    const token = mintReleaseToken(PATH, PROFILE, NOW)!;
    expect(verifyReleaseToken(token, PATH, PROFILE, NOW + 1000)).toBe(true);
  });

  it('refuses a token minted for a different blob path', () => {
    const token = mintReleaseToken(PATH, PROFILE, NOW)!;
    expect(verifyReleaseToken(token, 'avatars/22222222.png', PROFILE, NOW)).toBe(false);
  });

  it('refuses a token minted for a different profile — one uploader cannot release another\'s blob', () => {
    const token = mintReleaseToken(PATH, PROFILE, NOW)!;
    expect(verifyReleaseToken(token, PATH, 'p2', NOW)).toBe(false);
  });

  it('refuses an expired token', () => {
    const token = mintReleaseToken(PATH, PROFILE, NOW)!;
    expect(verifyReleaseToken(token, PATH, PROFILE, NOW + 25 * 60 * 60 * 1000)).toBe(false);
  });

  it('refuses a token whose expiry was moved forward without re-signing', () => {
    const token = mintReleaseToken(PATH, PROFILE, NOW)!;
    const signature = token.slice(token.indexOf('.') + 1);
    expect(verifyReleaseToken(`${NOW + 999_999_999}.${signature}`, PATH, PROFILE, NOW)).toBe(false);
  });

  it('refuses a token signed with a different account key', () => {
    const token = mintReleaseToken(PATH, PROFILE, NOW)!;
    process.env.AZURE_STORAGE_ACCOUNT_KEY = OTHER_KEY;
    expect(verifyReleaseToken(token, PATH, PROFILE, NOW)).toBe(false);
  });

  it('refuses malformed tokens rather than throwing', () => {
    for (const token of ['', '.', 'nodot', '.sig', 'NaN.sig', `${NOW + 1000}.`]) {
      expect(verifyReleaseToken(token, PATH, PROFILE, NOW)).toBe(false);
    }
  });

  it('mints nothing and verifies nothing when the storage key is absent', () => {
    delete process.env.AZURE_STORAGE_ACCOUNT_KEY;
    expect(mintReleaseToken(PATH, PROFILE, NOW)).toBeNull();
    expect(verifyReleaseToken(`${NOW + 1000}.sig`, PATH, PROFILE, NOW)).toBe(false);
  });

  it('two mints for the same path differ only by expiry, and both verify', () => {
    const first = mintReleaseToken(PATH, PROFILE, NOW)!;
    const second = mintReleaseToken(PATH, PROFILE, NOW + 5000)!;
    expect(first).not.toBe(second);
    expect(verifyReleaseToken(first, PATH, PROFILE, NOW)).toBe(true);
    expect(verifyReleaseToken(second, PATH, PROFILE, NOW)).toBe(true);
  });
});
