import { describe, it, expect, afterEach, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { generateSasToken, generateContainerSasToken, buildBlobUrl, SAS_SIGNED_VERSION } from './sas';

// Test account key (base64 of 32 zero bytes — not a real key)
const TEST_KEY = Buffer.alloc(32).toString('base64');

/**
 * The signature Azure would compute for `stringToSign`. Recomputing it here from
 * a LITERAL string-to-sign is the point of these tests: it pins the exact field
 * order, the empty-field count and the canonical resource. Anything that shifts a
 * newline changes `sig`, and a silent change to the blob-scoped form would break
 * every upload, read and delete in the system.
 */
const sign = (stringToSign: string) =>
  createHmac('sha256', Buffer.from(TEST_KEY, 'base64')).update(stringToSign, 'utf8').digest('base64');

// Frozen clock → deterministic st/se, so the whole string-to-sign can be literal.
// start is now-5min (skew buffer), expiry is now+expiryMinutes.
const FROZEN_NOW = new Date('2026-01-01T12:00:00.000Z');
const FROZEN_START = '2026-01-01T11:55:00Z';
const FROZEN_EXPIRY_120M = '2026-01-01T14:00:00Z';

const freezeClock = () => {
  vi.useFakeTimers();
  vi.setSystemTime(FROZEN_NOW);
};

describe('generateSasToken', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns a query string with required SAS params', () => {
    const qs = generateSasToken('myaccount', TEST_KEY, 'mycontainer', 'folder/file.mp4', 'r', 120);
    const params = new URLSearchParams(qs);
    expect(params.get('sp')).toBe('r');
    expect(params.get('sv')).toBe('2022-11-02');
    expect(params.get('sr')).toBe('b');
    expect(params.get('sig')).toBeTruthy();
    expect(params.get('se')).toBeTruthy();
  });

  it('expiry is approximately expiryMinutes in the future', () => {
    const before = new Date();
    const qs = generateSasToken('a', TEST_KEY, 'c', 'b.mp4', 'r', 120);
    const params = new URLSearchParams(qs);
    const expiry = new Date(params.get('se')!);
    const diffMinutes = (expiry.getTime() - before.getTime()) / 60000;
    expect(diffMinutes).toBeGreaterThan(115);
    expect(diffMinutes).toBeLessThan(125);
  });

  it('pins the blob-scoped (sr=b) string-to-sign byte for byte', () => {
    freezeClock();
    const expected = [
      'r',                                            // signedPermissions
      FROZEN_START,                                   // signedStart
      FROZEN_EXPIRY_120M,                             // signedExpiry
      '/blob/myaccount/mycontainer/folder/file.mp4',  // canonicalizedResource — blob segment INCLUDED
      '',                                             // signedIdentifier
      '',                                             // signedIP
      'https',                                        // signedProtocol
      '2022-11-02',                                   // signedVersion
      'b',                                            // signedResource
      '',                                             // signedSnapshotTime
      '',                                             // signedEncryptionScope
      '',                                             // rscc
      '',                                             // rscd
      '',                                             // rsce
      '',                                             // rscl
      '',                                             // rsct
    ].join('\n');

    const params = new URLSearchParams(
      generateSasToken('myaccount', TEST_KEY, 'mycontainer', 'folder/file.mp4', 'r', 120),
    );
    expect(params.get('sig')).toBe(sign(expected));
    expect(params.get('sr')).toBe('b');
    expect(params.get('st')).toBe(FROZEN_START);
    expect(params.get('se')).toBe(FROZEN_EXPIRY_120M);
  });

  it('defaults to sr=b, so the six-argument (pre-#277) call is byte-identical to the explicit one', () => {
    freezeClock();
    const implicit = generateSasToken('myaccount', TEST_KEY, 'mycontainer', 'a.mp4', 'cw', 30);
    const explicit = generateSasToken('myaccount', TEST_KEY, 'mycontainer', 'a.mp4', 'cw', 30, 'b');
    expect(implicit).toBe(explicit);
  });

  it('pins the container-scoped (sr=c) string-to-sign byte for byte', () => {
    freezeClock();
    const expected = [
      'l',                              // signedPermissions — list
      FROZEN_START,
      FROZEN_EXPIRY_120M,
      '/blob/myaccount/mycontainer',    // canonicalizedResource — NO blob segment, NO trailing slash
      '',
      '',
      'https',
      '2022-11-02',
      'c',                              // signedResource
      '',
      '',
      '',
      '',
      '',
      '',
      '',
    ].join('\n');

    const params = new URLSearchParams(
      generateSasToken('myaccount', TEST_KEY, 'mycontainer', '', 'l', 120, 'c'),
    );
    expect(params.get('sig')).toBe(sign(expected));
    expect(params.get('sr')).toBe('c');
    expect(params.get('sp')).toBe('l');
  });

  it('ignores blobName entirely for sr=c (a stray blob name cannot corrupt the signature)', () => {
    freezeClock();
    const withoutName = generateSasToken('myaccount', TEST_KEY, 'mycontainer', '', 'l', 120, 'c');
    const withName = generateSasToken('myaccount', TEST_KEY, 'mycontainer', 'stray.mp4', 'l', 120, 'c');
    expect(withName).toBe(withoutName);
  });

  it('signs a different resource for sr=b and sr=c (the two forms are not interchangeable)', () => {
    freezeClock();
    const blobScoped = new URLSearchParams(generateSasToken('a', TEST_KEY, 'c1', '', 'l', 60));
    const containerScoped = new URLSearchParams(generateSasToken('a', TEST_KEY, 'c1', '', 'l', 60, 'c'));
    expect(blobScoped.get('sig')).not.toBe(containerScoped.get('sig'));
  });
});

describe('generateContainerSasToken', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is exactly the sr=c form of generateSasToken', () => {
    freezeClock();
    expect(generateContainerSasToken('myaccount', TEST_KEY, 'mycontainer', 'l', 15)).toBe(
      generateSasToken('myaccount', TEST_KEY, 'mycontainer', '', 'l', 15, 'c'),
    );
  });
});

describe('SAS_SIGNED_VERSION', () => {
  it('is the version actually emitted as sv (so x-ms-version callers cannot drift)', () => {
    const params = new URLSearchParams(generateSasToken('a', TEST_KEY, 'c', 'b.mp4', 'r', 5));
    expect(params.get('sv')).toBe(SAS_SIGNED_VERSION);
    expect(SAS_SIGNED_VERSION).toBe('2022-11-02');
  });
});

describe('buildBlobUrl', () => {
  it('assembles full blob URL', () => {
    const url = buildBlobUrl('myaccount', 'mycontainer', 'path/to/blob.mp4', 'tok=1&sp=r');
    expect(url).toBe('https://myaccount.blob.core.windows.net/mycontainer/path/to/blob.mp4?tok=1&sp=r');
  });
});
