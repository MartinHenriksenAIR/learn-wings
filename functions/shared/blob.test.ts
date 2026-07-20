import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockGenerateSasToken, mockBuildBlobUrl } = vi.hoisted(() => ({
  mockGenerateSasToken: vi.fn().mockReturnValue('sp=d&sig=abc'),
  mockBuildBlobUrl: vi.fn().mockReturnValue('https://testaccount.blob.core.windows.net/lms-videos/blob?sp=d&sig=abc'),
}));

vi.mock('./sas', () => ({
  generateSasToken: mockGenerateSasToken,
  buildBlobUrl: mockBuildBlobUrl,
}));

import { deleteBlob, resolveAssetContainer, isBrandingAssetType, isBrandingAssetPath } from './blob';

const BLOB_PATH = 'videos/lesson-1.mp4';
const BLOB_URL = 'https://testaccount.blob.core.windows.net/lms-videos/blob?sp=d&sig=abc';

describe('deleteBlob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerateSasToken.mockReturnValue('sp=d&sig=abc');
    mockBuildBlobUrl.mockReturnValue(BLOB_URL);
    process.env.AZURE_STORAGE_ACCOUNT_NAME = 'testaccount';
    process.env.AZURE_STORAGE_ACCOUNT_KEY = Buffer.alloc(32).toString('base64');
    process.env.AZURE_STORAGE_CONTAINER_NAME = 'lms-videos';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.AZURE_STORAGE_ACCOUNT_NAME;
    delete process.env.AZURE_STORAGE_ACCOUNT_KEY;
    delete process.env.AZURE_STORAGE_CONTAINER_NAME;
  });

  it('returns true when storage responds ok (2xx)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
    const result = await deleteBlob(BLOB_PATH);
    expect(result).toBe(true);
    expect(mockGenerateSasToken).toHaveBeenCalledWith(
      'testaccount',
      expect.any(String),
      'lms-videos',
      BLOB_PATH,
      'd',
      10,
    );
  });

  it('returns true when storage responds 404 (blob already gone)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    const result = await deleteBlob(BLOB_PATH);
    expect(result).toBe(true);
  });

  it('returns false when storage responds 500', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await deleteBlob(BLOB_PATH);
    expect(result).toBe(false);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('returns false and never throws when fetch rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await deleteBlob(BLOB_PATH);
    expect(result).toBe(false);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('returns false and warns when env vars are missing', async () => {
    delete process.env.AZURE_STORAGE_ACCOUNT_NAME;
    delete process.env.AZURE_STORAGE_ACCOUNT_KEY;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await deleteBlob(BLOB_PATH);
    expect(result).toBe(false);
    expect(mockGenerateSasToken).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('uses the container fallback lms-videos when env var is absent', async () => {
    delete process.env.AZURE_STORAGE_CONTAINER_NAME;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
    await deleteBlob(BLOB_PATH);
    expect(mockGenerateSasToken).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      'lms-videos',
      BLOB_PATH,
      'd',
      10,
    );
  });
});

describe('resolveAssetContainer', () => {
  beforeEach(() => {
    process.env.AZURE_STORAGE_CONTAINER_NAME = 'lms-videos';
  });
  afterEach(() => {
    delete process.env.AZURE_STORAGE_CONTAINER_NAME;
  });

  it("routes 'org-logo' to the private default container with an org-logos/ prefix", () => {
    expect(resolveAssetContainer('org-logo')).toEqual({ container: 'lms-videos', prefix: 'org-logos/' });
  });

  it("routes 'avatar' to the private default container with an avatars/ prefix", () => {
    expect(resolveAssetContainer('avatar')).toEqual({ container: 'lms-videos', prefix: 'avatars/' });
  });

  it('gives no prefix for an unknown assetType (allow-list, not error)', () => {
    expect(resolveAssetContainer('bogus')).toEqual({ container: 'lms-videos', prefix: '' });
  });

  it('gives no prefix when assetType is absent', () => {
    expect(resolveAssetContainer(undefined)).toEqual({ container: 'lms-videos', prefix: '' });
  });

  it('falls back to lms-videos when AZURE_STORAGE_CONTAINER_NAME is unset', () => {
    delete process.env.AZURE_STORAGE_CONTAINER_NAME;
    expect(resolveAssetContainer('org-logo')).toEqual({ container: 'lms-videos', prefix: 'org-logos/' });
  });
});

describe('isBrandingAssetType', () => {
  it('accepts org-logo and avatar', () => {
    expect(isBrandingAssetType('org-logo')).toBe(true);
    expect(isBrandingAssetType('avatar')).toBe(true);
  });
  it('rejects unknown/absent types', () => {
    expect(isBrandingAssetType('video')).toBe(false);
    expect(isBrandingAssetType(undefined)).toBe(false);
    expect(isBrandingAssetType('')).toBe(false);
  });
});

describe('isBrandingAssetPath', () => {
  it('accepts a flat org-logos/ or avatars/ path', () => {
    expect(isBrandingAssetPath('org-logos/abc-123.png')).toBe(true);
    expect(isBrandingAssetPath('avatars/abc-123.jpg')).toBe(true);
  });
  it('rejects non-branding, nested, and traversal paths', () => {
    expect(isBrandingAssetPath('lessons/secret.mp4')).toBe(false);
    expect(isBrandingAssetPath('avatars/../lessons/secret.mp4')).toBe(false);
    expect(isBrandingAssetPath('org-logos/sub/deep.png')).toBe(false);
    expect(isBrandingAssetPath('avatars/')).toBe(false);
    expect(isBrandingAssetPath('')).toBe(false);
  });
});
