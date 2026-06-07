import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── hoist mock before any module load ────────────────────────────────────
const { mockCallApi } = vi.hoisted(() => ({
  mockCallApi: vi.fn(),
}));

vi.mock('./api-client', () => ({ callApi: mockCallApi }));

import { extractLmsAssetPath, getSignedLmsAssetUrl } from './storage';

// ── extractLmsAssetPath ────────────────────────────────────────────────────

describe('extractLmsAssetPath', () => {
  // ── Azure blob URL branch ──────────────────────────────────────────────

  it('Azure SAS URL → container-relative blob path', () => {
    const url =
      'https://myaccount.blob.core.windows.net/lms-assets/course-thumbnails/abc.png' +
      '?sv=2022-11-02&st=2026-06-07T00%3A00%3A00Z&se=2026-06-07T02%3A00%3A00Z' +
      '&sr=b&sp=r&sig=FAKESIG%3D';
    expect(extractLmsAssetPath(url)).toBe('course-thumbnails/abc.png');
  });

  it('Azure SAS URL with URL-encoded characters in blob path → decoded path', () => {
    const url =
      'https://myaccount.blob.core.windows.net/lms-assets/course%20thumbnails/file%20name.png' +
      '?sv=2022-11-02&sig=FAKESIG';
    expect(extractLmsAssetPath(url)).toBe('course thumbnails/file name.png');
  });

  it('Azure URL with NO query string → still extracts path', () => {
    const url =
      'https://myaccount.blob.core.windows.net/lms-assets/course-thumbnails/abc.png';
    expect(extractLmsAssetPath(url)).toBe('course-thumbnails/abc.png');
  });

  it('Azure-lookalike host (blob.core.windows.net in attacker domain) → does NOT match Azure branch (returns null)', () => {
    // Host is "evil.blob.core.windows.net.attacker.com" — does NOT end with .blob.core.windows.net
    const url =
      'https://evil.blob.core.windows.net.attacker.com/lms-assets/course-thumbnails/evil.png?sig=x';
    // Falls through — no Supabase prefix, is an http URL but unrecognised, returns null
    expect(extractLmsAssetPath(url)).toBeNull();
  });

  it('Azure URL with deeply-nested blob path preserves full sub-path', () => {
    const url =
      'https://acct.blob.core.windows.net/container/a/b/c/d.mp4?sp=r&sig=X';
    expect(extractLmsAssetPath(url)).toBe('a/b/c/d.mp4');
  });

  // ── Supabase legacy branches (pinned — must not regress) ─────────────

  it('Supabase signed-URL prefix → storage path', () => {
    const url =
      'https://example.supabase.co/storage/v1/object/sign/lms-assets/course-thumbnails/xyz.png?token=abc';
    expect(extractLmsAssetPath(url)).toBe('course-thumbnails/xyz.png');
  });

  it('Supabase public-URL prefix → storage path', () => {
    const url =
      'https://example.supabase.co/storage/v1/object/public/lms-assets/course-thumbnails/xyz.png';
    expect(extractLmsAssetPath(url)).toBe('course-thumbnails/xyz.png');
  });

  // ── Raw / non-URL paths (pinned) ─────────────────────────────────────

  it('raw container-relative path without leading slash → returned as-is', () => {
    expect(extractLmsAssetPath('course-thumbnails/abc.png')).toBe('course-thumbnails/abc.png');
  });

  it('raw path with leading slash → slash stripped', () => {
    expect(extractLmsAssetPath('/course-thumbnails/abc.png')).toBe('course-thumbnails/abc.png');
  });

  // ── Null / empty / garbage (pinned) ──────────────────────────────────

  it('null input → null', () => {
    expect(extractLmsAssetPath(null)).toBeNull();
  });

  it('empty string → null', () => {
    expect(extractLmsAssetPath('')).toBeNull();
  });

  it('whitespace-only string → null', () => {
    expect(extractLmsAssetPath('   ')).toBeNull();
  });

  it('malformed URL that cannot be parsed → returns null without throwing', () => {
    // Starts with https:// but is malformed enough to fail URL parsing; falls through to null
    expect(extractLmsAssetPath('https://[invalid')).toBeNull();
  });

  it('HTTP URL with unrecognised host → null', () => {
    expect(extractLmsAssetPath('https://cdn.example.com/some/image.png')).toBeNull();
  });
});

// ── getSignedLmsAssetUrl ───────────────────────────────────────────────────

describe('getSignedLmsAssetUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stored full Azure SAS URL → extract succeeds → callApi called with extracted path, returns fresh URL', async () => {
    const storedSasUrl =
      'https://myaccount.blob.core.windows.net/lms-assets/course-thumbnails/thumb.png' +
      '?sv=2022-11-02&sig=EXPIREDSIG';
    const freshSignedUrl =
      'https://myaccount.blob.core.windows.net/lms-assets/course-thumbnails/thumb.png?sig=FRESHSIG';

    mockCallApi.mockResolvedValueOnce({ url: freshSignedUrl });

    const result = await getSignedLmsAssetUrl(storedSasUrl);

    // callApi must be called with the extracted (container-relative) path, NOT the full SAS URL
    expect(mockCallApi).toHaveBeenCalledOnce();
    const [_endpoint, body] = mockCallApi.mock.calls[0];
    expect(body.blobPath).toBe('course-thumbnails/thumb.png');
    expect(result).toBe(freshSignedUrl);
  });

  it('stored raw container-relative path → callApi called with path directly', async () => {
    const freshUrl =
      'https://myaccount.blob.core.windows.net/lms-assets/course-thumbnails/pic.jpg?sig=X';
    mockCallApi.mockResolvedValueOnce({ url: freshUrl });

    const result = await getSignedLmsAssetUrl('course-thumbnails/pic.jpg');

    expect(mockCallApi).toHaveBeenCalledOnce();
    const [, body] = mockCallApi.mock.calls[0];
    expect(body.blobPath).toBe('course-thumbnails/pic.jpg');
    expect(result).toBe(freshUrl);
  });

  it('null stored value → returns null, no API call', async () => {
    const result = await getSignedLmsAssetUrl(null);
    expect(result).toBeNull();
    expect(mockCallApi).not.toHaveBeenCalled();
  });

  it('unrecognised http URL (e.g. CDN) → extraction returns null → stored URL returned unchanged', async () => {
    // getSignedLmsAssetUrl falls back to storedValue when extractLmsAssetPath returns null
    const cdnUrl = 'https://cdn.example.com/image.png';
    const result = await getSignedLmsAssetUrl(cdnUrl);
    expect(mockCallApi).not.toHaveBeenCalled();
    expect(result).toBe(cdnUrl);
  });
});
