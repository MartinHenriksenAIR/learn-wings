import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuthenticate, MockAuthError, mockQueryOne, mockGetProfile, mockGenerateSasToken, mockBuildBlobUrl } = vi.hoisted(() => {
  class MockAuthError extends Error {}
  return {
    mockAuthenticate: vi.fn(),
    MockAuthError,
    mockQueryOne: vi.fn(),
    mockGetProfile: vi.fn(),
    mockGenerateSasToken: vi.fn().mockReturnValue('sp=cw&sig=abc'),
    mockBuildBlobUrl: vi.fn().mockReturnValue('https://testaccount.blob.core.windows.net/lms-videos/uuid.mp4?sp=cw&sig=abc'),
  };
});
vi.mock('../shared/auth', () => ({ authenticate: mockAuthenticate, AuthError: MockAuthError }));
vi.mock('../shared/db', () => ({ queryOne: mockQueryOne }));
vi.mock('../shared/profile', () => ({ getProfile: mockGetProfile }));
vi.mock('../shared/sas', () => ({ generateSasToken: mockGenerateSasToken, buildBlobUrl: mockBuildBlobUrl }));

process.env.AZURE_STORAGE_ACCOUNT_NAME = 'testaccount';
process.env.AZURE_STORAGE_ACCOUNT_KEY = Buffer.alloc(32).toString('base64');
process.env.AZURE_STORAGE_CONTAINER_NAME = 'lms-videos';
process.env.ALLOWED_ORIGINS = 'https://ai-uddannelse.dk';

import { default as handler } from './index';
import { verifyReleaseToken } from '../shared/release-token';

const baseReq = {
  method: 'POST',
  headers: { get: (k: string) => k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok' },
  json: async () => ({ fileName: 'test-video.mp4', contentType: 'video/mp4' }),
};

describe('azure-upload-url', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ id: 'oid-1', tid: 'tid-1', email: 'admin@test.com' });
    mockGetProfile.mockResolvedValue({ id: 'p1', is_platform_admin: true });
    mockGenerateSasToken.mockReturnValue('sp=cw&sig=abc');
    mockBuildBlobUrl.mockReturnValue('https://testaccount.blob.core.windows.net/lms-videos/uuid.mp4?sp=cw&sig=abc');
  });

  it('returns uploadUrl, blobPath, contentType for admin user', async () => {
    const res = await handler(baseReq as any, {} as any);
    const body = JSON.parse(res.body as string);
    expect(res.status).toBe(200);
    expect(body.uploadUrl).toMatch(/https:\/\/testaccount\.blob\.core\.windows\.net/);
    expect(body.blobPath).toMatch(/\.mp4$/);
    expect(body.contentType).toBe('video/mp4');
  });

  it('mints a releaseToken bound to the blobPath and the caller, so an abandoned upload can be reclaimed', async () => {
    const body = JSON.parse((await handler(baseReq as any, {} as any)).body as string);

    expect(typeof body.releaseToken).toBe('string');
    expect(verifyReleaseToken(body.releaseToken, body.blobPath, 'p1')).toBe(true);
    expect(verifyReleaseToken(body.releaseToken, body.blobPath, 'p2')).toBe(false);
    expect(verifyReleaseToken(body.releaseToken, 'avatars/someone-else.png', 'p1')).toBe(false);
  });

  it('returns 403 for a non-admin uploading course content (default container)', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: false });

    const res = await handler(baseReq as any, {} as any);

    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Forbidden' });
  });

  it('allows a non-admin to upload a public branding asset (avatar)', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: false });
    const req = {
      ...baseReq,
      json: async () => ({ fileName: 'photo.jpg', contentType: 'image/jpeg', assetType: 'avatar' }),
    };

    const res = await handler(req as any, {} as any);
    const body = JSON.parse(res.body as string);

    expect(res.status).toBe(200);
    expect(body.blobPath).toMatch(/^avatars\/[^/]+\.jpg$/);
  });

  it('allows a non-admin to upload a public branding asset (org-logo)', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: false });
    const req = {
      ...baseReq,
      json: async () => ({ fileName: 'logo.png', contentType: 'image/png', assetType: 'org-logo' }),
    };

    const res = await handler(req as any, {} as any);
    const body = JSON.parse(res.body as string);

    expect(res.status).toBe(200);
    expect(body.blobPath).toMatch(/^org-logos\/[^/]+\.png$/);
  });

  it('returns 403 for a non-admin when assetType is unrecognized (private default)', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: false });
    const req = {
      ...baseReq,
      json: async () => ({ fileName: 'clip.mp4', contentType: 'video/mp4', assetType: 'not-a-real-type' }),
    };

    const res = await handler(req as any, {} as any);

    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Forbidden' });
  });

  it('returns 401 when getProfile returns null', async () => {
    mockGetProfile.mockResolvedValueOnce(null);

    const res = await handler(baseReq as any, {} as any);

    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Profile not found' });
  });

  it('returns 400 when fileName is missing', async () => {
    const req = {
      ...baseReq,
      json: async () => ({ contentType: 'video/mp4' }),
    };

    const res = await handler(req as any, {} as any);

    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'fileName is required' });
  });

  it('returns 401 when authenticate throws an AuthError with a token-less message', async () => {
    mockAuthenticate.mockRejectedValueOnce(new MockAuthError('Missing oid or tid claims'));

    const res = await handler(baseReq as any, {} as any);

    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Missing oid or tid claims' });
  });

  it('returns a generic 500 (no leak) when a non-auth error mentions "token"', async () => {
    mockGetProfile.mockRejectedValueOnce(new Error('profile token lookup failed'));
    const ctx = { error: vi.fn() };

    const res = await handler(baseReq as any, ctx as any);

    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Internal server error' });
    expect(ctx.error).toHaveBeenCalledWith(expect.stringContaining('profile token lookup failed'));
  });

  it('regression: no db query contains FROM profiles WHERE id =', async () => {
    await handler(baseReq as any, {} as any);

    for (const call of mockQueryOne.mock.calls) {
      expect((call[0] as string)).not.toContain('FROM profiles WHERE id =');
    }
  });

  it('routes assetType "org-logo" to the org-logos/ prefix in the private default container', async () => {
    const req = {
      ...baseReq,
      json: async () => ({ fileName: 'logo.png', contentType: 'image/png', assetType: 'org-logo' }),
    };

    const res = await handler(req as any, {} as any);
    const body = JSON.parse(res.body as string);

    expect(res.status).toBe(200);
    expect(body.blobPath).toMatch(/^org-logos\/[^/]+\.png$/);
    expect(mockGenerateSasToken).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      'lms-videos',
      body.blobPath,
      'cw',
      30,
    );
    expect(mockBuildBlobUrl).toHaveBeenCalledWith(
      expect.any(String),
      'lms-videos',
      body.blobPath,
      expect.any(String),
    );
  });

  it('routes assetType "avatar" to the avatars/ prefix in the private default container', async () => {
    const req = {
      ...baseReq,
      json: async () => ({ fileName: 'photo.jpg', contentType: 'image/jpeg', assetType: 'avatar' }),
    };

    const res = await handler(req as any, {} as any);
    const body = JSON.parse(res.body as string);

    expect(res.status).toBe(200);
    expect(body.blobPath).toMatch(/^avatars\/[^/]+\.jpg$/);
    expect(mockGenerateSasToken).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      'lms-videos',
      body.blobPath,
      'cw',
      30,
    );
    expect(mockBuildBlobUrl).toHaveBeenCalledWith(
      expect.any(String),
      'lms-videos',
      body.blobPath,
      expect.any(String),
    );
  });

  it('with no assetType, keeps legacy behaviour: default container, bare <uuid>.<ext> blobPath', async () => {
    const res = await handler(baseReq as any, {} as any);
    const body = JSON.parse(res.body as string);

    expect(res.status).toBe(200);
    expect(body.blobPath).toMatch(/^[^/]+\.mp4$/);
    expect(mockGenerateSasToken).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      'lms-videos',
      body.blobPath,
      'cw',
      30,
    );
  });

  it('falls through to the private default when assetType is not a recognized value', async () => {
    const req = {
      ...baseReq,
      json: async () => ({ fileName: 'clip.mp4', contentType: 'video/mp4', assetType: 'not-a-real-type' }),
    };

    const res = await handler(req as any, {} as any);
    const body = JSON.parse(res.body as string);

    expect(res.status).toBe(200);
    expect(body.blobPath).toMatch(/^[^/]+\.mp4$/);
    expect(mockGenerateSasToken).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      'lms-videos',
      body.blobPath,
      'cw',
      30,
    );
  });

  it('reaches the container fall-through with an UNUSUAL extension and no declared type', async () => {
    const req = {
      ...baseReq,
      json: async () => ({ fileName: 'clip.ogv', assetType: 'not-a-real-type' }),
    };

    const res = await handler(req as any, {} as any);
    const body = JSON.parse(res.body as string);

    expect(res.status).toBe(200);
    expect(body.blobPath).toMatch(/^[^/]+\.ogv$/);
    expect(body.contentType).toBe('application/octet-stream');
    expect(mockGenerateSasToken).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      'lms-videos',
      body.blobPath,
      'cw',
      30,
    );
  });

  const mint = (body: Record<string, unknown>) => handler(
    { ...baseReq, json: async () => body } as any,
    {} as any,
  );

  it('returns 400 for an off-allowlist extension, minting no SAS', async () => {
    const res = await mint({ fileName: 'payload.exe', contentType: 'application/octet-stream' });
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'File type not allowed' });
    expect(mockGenerateSasToken).not.toHaveBeenCalled();
  });

  it('returns 400 for a filename with no extension at all', async () => {
    const res = await mint({ fileName: 'noextension', contentType: 'video/mp4' });
    expect(res.status).toBe(400);
    expect(mockGenerateSasToken).not.toHaveBeenCalled();
  });

  it('returns 400 when the declared contentType contradicts the extension', async () => {
    const res = await mint({ fileName: 'logo.png', contentType: 'video/mp4' });
    expect(res.status).toBe(400);
    expect(mockGenerateSasToken).not.toHaveBeenCalled();
  });

  it('still mints when the browser reports no contentType (extension decides)', async () => {
    const res = await mint({ fileName: 'clip.mov' });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string).blobPath).toMatch(/^[^/]+\.mov$/);
  });

  it('normalizes the extension into the blob path rather than echoing the caller', async () => {
    const res = await mint({ fileName: 'Holiday.Clip.MP4', contentType: 'video/mp4' });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string).blobPath).toMatch(/^[^/]+\.mp4$/);
  });

  it('refuses a non-image branding asset — the branding path skips the admin gate', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: false });
    const res = await mint({ fileName: 'clip.mp4', contentType: 'video/mp4', assetType: 'avatar' });
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'File type not allowed' });
    expect(mockGenerateSasToken).not.toHaveBeenCalled();
  });

  it('authz still comes first: a non-admin gets 403, not 400, for a disallowed course-content file', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: false });
    const res = await mint({ fileName: 'payload.exe', contentType: 'application/octet-stream' });
    expect(res.status).toBe(403);
  });
});
