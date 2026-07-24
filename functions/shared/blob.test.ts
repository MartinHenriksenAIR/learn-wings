import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockGenerateSasToken, mockBuildBlobUrl } = vi.hoisted(() => ({
  mockGenerateSasToken: vi.fn().mockReturnValue('sp=d&sig=abc'),
  mockBuildBlobUrl: vi.fn().mockReturnValue('https://testaccount.blob.core.windows.net/lms-videos/blob?sp=d&sig=abc'),
}));

vi.mock('./sas', () => ({
  generateSasToken: mockGenerateSasToken,
  buildBlobUrl: mockBuildBlobUrl,
}));

import { deleteBlob, headBlob, cleanupBlobs, resolveAssetContainer, isBrandingAssetType, isBrandingAssetPath } from './blob';

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

describe('headBlob', () => {
  /** A fetch Response stub carrying just the headers headBlob reads. */
  const okResponse = (headers: Record<string, string>) => ({
    ok: true,
    status: 200,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerateSasToken.mockReturnValue('sp=r&sig=abc');
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

  it('returns size and content type from a 2xx, minting a read-only SAS', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({ 'content-length': '1234', 'content-type': 'video/mp4' }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(headBlob(BLOB_PATH)).resolves.toEqual({
      ok: true,
      exists: true,
      contentLength: 1234,
      contentType: 'video/mp4',
    });
    // 'r', not 'd' — a size probe must never be able to delete.
    expect(mockGenerateSasToken).toHaveBeenCalledWith(
      'testaccount',
      expect.any(String),
      'lms-videos',
      BLOB_PATH,
      'r',
      10,
    );
    expect(fetchMock).toHaveBeenCalledWith(BLOB_URL, { method: 'HEAD' });
  });

  it('reports a conclusive absence for 404 (ok, but exists false)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    await expect(headBlob(BLOB_PATH)).resolves.toEqual({
      ok: true,
      exists: false,
      contentLength: null,
      contentType: null,
    });
  });

  it('reports inconclusive (ok false) when storage responds 500', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await headBlob(BLOB_PATH);
    expect(result.ok).toBe(false);
    expect(result.exists).toBe(false);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('reports inconclusive and never throws when fetch rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(headBlob(BLOB_PATH)).resolves.toEqual({
      ok: false,
      exists: false,
      contentLength: null,
      contentType: null,
    });
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('reports inconclusive and warns when env vars are missing, without minting a SAS', async () => {
    delete process.env.AZURE_STORAGE_ACCOUNT_NAME;
    delete process.env.AZURE_STORAGE_ACCOUNT_KEY;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await headBlob(BLOB_PATH);
    expect(result.ok).toBe(false);
    expect(mockGenerateSasToken).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('still reports the blob as existing when Content-Length is absent or unparseable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse({ 'content-type': 'image/png' })));
    await expect(headBlob(BLOB_PATH)).resolves.toEqual({
      ok: true,
      exists: true,
      contentLength: null,
      contentType: 'image/png',
    });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse({ 'content-length': 'not-a-number' })));
    await expect(headBlob(BLOB_PATH)).resolves.toEqual({
      ok: true,
      exists: true,
      contentLength: null,
      contentType: null,
    });
  });

  it('tolerates a response with no headers object at all', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
    await expect(headBlob(BLOB_PATH)).resolves.toEqual({
      ok: true,
      exists: true,
      contentLength: null,
      contentType: null,
    });
  });

  it('uses the container fallback lms-videos when env var is absent', async () => {
    delete process.env.AZURE_STORAGE_CONTAINER_NAME;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse({ 'content-length': '10' })));
    await headBlob(BLOB_PATH);
    expect(mockGenerateSasToken).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      'lms-videos',
      BLOB_PATH,
      'r',
      10,
    );
  });
});

describe('cleanupBlobs', () => {
  const PATH_A = 'videos/a.mp4';
  const PATH_B = 'videos/b.mp4';
  const PATH_C = 'videos/c.mp4';

  let warnSpy: ReturnType<typeof vi.spyOn>;

  /**
   * Drives the REAL `deleteBlob` through the same seam the suite above uses — `./sas`
   * is module-mocked and `fetch` is stubbed, so nothing leaves the process. (`cleanupBlobs`
   * calls `deleteBlob` through the module-local binding, so it cannot be mocked away.)
   * `outcomes[path] === true` → storage 200 → `deleteBlob` true; false → 500 → false.
   */
  const stubStorage = (outcomes: Record<string, boolean>) => {
    mockBuildBlobUrl.mockImplementation(
      (_account: string, _container: string, blobPath: string) =>
        `https://testaccount.blob.core.windows.net/lms-videos/${blobPath}?sp=d&sig=abc`,
    );
    const fetchMock = vi.fn(async (url: string) => {
      const hit = Object.entries(outcomes).find(([path]) => url.includes(path));
      return hit?.[1] ? { ok: true, status: 200 } : { ok: false, status: 500 };
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerateSasToken.mockReturnValue('sp=d&sig=abc');
    process.env.AZURE_STORAGE_ACCOUNT_NAME = 'testaccount';
    process.env.AZURE_STORAGE_ACCOUNT_KEY = Buffer.alloc(32).toString('base64');
    process.env.AZURE_STORAGE_CONTAINER_NAME = 'lms-videos';
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    vi.unstubAllGlobals();
    mockBuildBlobUrl.mockReset();
    delete process.env.AZURE_STORAGE_ACCOUNT_NAME;
    delete process.env.AZURE_STORAGE_ACCOUNT_KEY;
    delete process.env.AZURE_STORAGE_CONTAINER_NAME;
  });

  it('counts every path as deleted, and never warns, when all deletes succeed', async () => {
    const fetchMock = stubStorage({ [PATH_A]: true, [PATH_B]: true, [PATH_C]: true });
    const result = await cleanupBlobs([PATH_A, PATH_B, PATH_C], 'course-delete', 'course-1');
    expect(result).toEqual({ blobsDeleted: 3, blobsFailed: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('splits the counts on mixed results and still attempts every path', async () => {
    const fetchMock = stubStorage({ [PATH_A]: true, [PATH_B]: false, [PATH_C]: true });
    const result = await cleanupBlobs([PATH_A, PATH_B, PATH_C], 'module-delete', 'mod-7');
    expect(result).toEqual({ blobsDeleted: 2, blobsFailed: 1 });
    // A failure mid-list must not short-circuit the remaining deletes.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('counts every path as failed when all deletes fail', async () => {
    stubStorage({ [PATH_A]: false, [PATH_B]: false });
    await expect(cleanupBlobs([PATH_A, PATH_B], 'course-delete', 'course-2')).resolves.toEqual({
      blobsDeleted: 0,
      blobsFailed: 2,
    });
  });

  it('returns zeroed counts and does NOT warn for an empty path list', async () => {
    const fetchMock = stubStorage({});
    const result = await cleanupBlobs([], 'course-delete', 'course-3');
    expect(result).toEqual({ blobsDeleted: 0, blobsFailed: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
    // blobsFailed is 0, not "not > 0" by accident — an empty cleanup is silent.
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('resolves rather than rejecting when the underlying delete blows up', async () => {
    mockBuildBlobUrl.mockReturnValue(BLOB_URL);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    await expect(cleanupBlobs([PATH_A, PATH_B], 'course-delete', 'course-4')).resolves.toEqual({
      blobsDeleted: 0,
      blobsFailed: 2,
    });
  });

  it('warns exactly once, tagged with logTag and id, when at least one path fails', async () => {
    stubStorage({ [PATH_A]: true, [PATH_B]: false });
    await cleanupBlobs([PATH_A, PATH_B], 'module-delete', 'mod-42');
    expect(warnSpy).toHaveBeenCalledWith('[module-delete] 1 blob(s) failed to delete for', 'mod-42');
    const cleanupWarnings = warnSpy.mock.calls.filter(
      ([msg]) => typeof msg === 'string' && msg.startsWith('[module-delete]'),
    );
    expect(cleanupWarnings).toHaveLength(1);
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
