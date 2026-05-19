import { describe, it, expect } from 'vitest';
import { generateSasToken, buildBlobUrl } from './sas';

// Test account key (base64 of 32 zero bytes — not a real key)
const TEST_KEY = Buffer.alloc(32).toString('base64');

describe('generateSasToken', () => {
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
});

describe('buildBlobUrl', () => {
  it('assembles full blob URL', () => {
    const url = buildBlobUrl('myaccount', 'mycontainer', 'path/to/blob.mp4', 'tok=1&sp=r');
    expect(url).toBe('https://myaccount.blob.core.windows.net/mycontainer/path/to/blob.mp4?tok=1&sp=r');
  });
});
