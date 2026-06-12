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

  it('returns 403 when getProfile returns non-admin', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: false });

    const res = await handler(baseReq as any, {} as any);

    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Only platform admins can upload videos' });
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

  it('returns 401 on auth token error', async () => {
    mockAuthenticate.mockRejectedValueOnce(new Error('Invalid token'));

    const res = await handler(baseReq as any, {} as any);

    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Invalid token' });
  });

  it('regression: no db query contains FROM profiles WHERE id =', async () => {
    await handler(baseReq as any, {} as any);

    for (const call of mockQueryOne.mock.calls) {
      expect((call[0] as string)).not.toContain('FROM profiles WHERE id =');
    }
  });
});
