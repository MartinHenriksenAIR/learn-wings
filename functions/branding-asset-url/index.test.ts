import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuthenticate, MockAuthError, mockGetProfile, mockGenerateSasToken, mockBuildBlobUrl } = vi.hoisted(() => {
  class MockAuthError extends Error {}
  return {
    mockAuthenticate: vi.fn(),
    MockAuthError,
    mockGetProfile: vi.fn(),
    mockGenerateSasToken: vi.fn().mockReturnValue('sp=r&sig=abc'),
    mockBuildBlobUrl: vi.fn().mockReturnValue('https://testaccount.blob.core.windows.net/lms-videos/avatars/x.png?sp=r&sig=abc'),
  };
});
vi.mock('../shared/auth', () => ({ authenticate: mockAuthenticate, AuthError: MockAuthError }));
vi.mock('../shared/db', () => ({ queryOne: vi.fn() }));
vi.mock('../shared/profile', () => ({ getProfile: mockGetProfile }));
vi.mock('../shared/sas', () => ({ generateSasToken: mockGenerateSasToken, buildBlobUrl: mockBuildBlobUrl }));

process.env.AZURE_STORAGE_ACCOUNT_NAME = 'testaccount';
process.env.AZURE_STORAGE_ACCOUNT_KEY = Buffer.alloc(32).toString('base64');
process.env.AZURE_STORAGE_CONTAINER_NAME = 'lms-videos';
process.env.ALLOWED_ORIGINS = 'https://ai-uddannelse.dk';

import { default as handler } from './index';

const req = (body: unknown) => ({
  method: 'POST',
  headers: { get: (k: string) => (k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok') },
  json: async () => body,
}) as any;

describe('branding-asset-url', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ id: 'oid-1', tid: 'tid-1', email: 'u@test.com' });
    // A plain, non-admin authenticated user — branding assets are viewable by anyone signed in.
    mockGetProfile.mockResolvedValue({ id: 'p1', is_platform_admin: false });
    mockGenerateSasToken.mockReturnValue('sp=r&sig=abc');
    mockBuildBlobUrl.mockReturnValue('https://testaccount.blob.core.windows.net/lms-videos/avatars/x.png?sp=r&sig=abc');
  });

  it('signs an avatar path for a non-admin user (read SAS, 120 min, default container)', async () => {
    const res = await handler(req({ blobPath: 'avatars/abc.png' }), {} as any);
    const body = JSON.parse(res.body as string);

    expect(res.status).toBe(200);
    expect(body.url).toContain('https://testaccount.blob.core.windows.net');
    expect(mockGenerateSasToken).toHaveBeenCalledWith(
      expect.any(String), expect.any(String), 'lms-videos', 'avatars/abc.png', 'r', 120,
    );
  });

  it('signs an org-logo path', async () => {
    const res = await handler(req({ blobPath: 'org-logos/abc.png' }), {} as any);
    expect(res.status).toBe(200);
    expect(mockGenerateSasToken).toHaveBeenCalledWith(
      expect.any(String), expect.any(String), 'lms-videos', 'org-logos/abc.png', 'r', 120,
    );
  });

  it('returns 400 when blobPath is missing', async () => {
    const res = await handler(req({}), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'blobPath is required' });
  });

  it('refuses to sign a non-branding path (course content) even for an authed user', async () => {
    const res = await handler(req({ blobPath: 'lessons/secret-video.mp4' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Not a branding asset path' });
    expect(mockGenerateSasToken).not.toHaveBeenCalled();
  });

  it('refuses a branding-prefixed path that escapes into nested segments (no traversal)', async () => {
    const res = await handler(req({ blobPath: 'avatars/../lessons/x.mp4' }), {} as any);
    expect(res.status).toBe(400);
    expect(mockGenerateSasToken).not.toHaveBeenCalled();
  });

  it('returns 401 when the caller is unauthenticated', async () => {
    mockAuthenticate.mockRejectedValueOnce(new MockAuthError('Missing Bearer token'));
    const res = await handler(req({ blobPath: 'avatars/abc.png' }), {} as any);
    expect(res.status).toBe(401);
  });

  it('returns 401 when the profile is not provisioned', async () => {
    mockGetProfile.mockResolvedValueOnce(null);
    const res = await handler(req({ blobPath: 'avatars/abc.png' }), {} as any);
    expect(res.status).toBe(401);
  });
});
