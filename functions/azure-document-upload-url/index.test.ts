import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuthenticate, MockAuthError, mockQueryOne, mockGetProfile, mockGenerateSasToken, mockBuildBlobUrl } = vi.hoisted(() => {
  class MockAuthError extends Error {}
  return {
    mockAuthenticate: vi.fn(),
    MockAuthError,
    mockQueryOne: vi.fn(),
    mockGetProfile: vi.fn(),
    mockGenerateSasToken: vi.fn().mockReturnValue('sp=cw&sig=abc'),
    mockBuildBlobUrl: vi.fn().mockReturnValue('https://testaccount.blob.core.windows.net/lms-videos/documents/uuid.pdf?sp=cw&sig=abc'),
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
  json: async () => ({ fileName: 'curriculum.pdf', contentType: 'application/pdf' }),
};

describe('azure-document-upload-url', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ id: 'oid-1', tid: 'tid-1', email: 'admin@test.com' });
    mockGetProfile.mockResolvedValue({ id: 'p1', is_platform_admin: true });
    mockGenerateSasToken.mockReturnValue('sp=cw&sig=abc');
    mockBuildBlobUrl.mockReturnValue('https://testaccount.blob.core.windows.net/lms-videos/documents/uuid.pdf?sp=cw&sig=abc');
  });

  it('returns uploadUrl, blobPath with documents/ prefix, and contentType for admin user', async () => {
    const res = await handler(baseReq as any, {} as any);
    const body = JSON.parse(res.body as string);

    expect(res.status).toBe(200);
    expect(body.uploadUrl).toMatch(/https:\/\/testaccount\.blob\.core\.windows\.net/);
    expect(body.blobPath).toContain('documents/');
    expect(body.contentType).toBe('application/pdf');
  });

  it('returns 403 when getProfile returns non-admin', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: false });

    const res = await handler(baseReq as any, {} as any);

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
      json: async () => ({ contentType: 'application/pdf' }),
    };

    const res = await handler(req as any, {} as any);

    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'fileName is required' });
  });

  it('defaults contentType to application/pdf when not provided', async () => {
    const req = {
      ...baseReq,
      json: async () => ({ fileName: 'doc.pdf' }),
    };

    const res = await handler(req as any, {} as any);
    const body = JSON.parse(res.body as string);

    expect(res.status).toBe(200);
    expect(body.contentType).toBe('application/pdf');
  });

  // issue #104: an AuthError (even one whose message lacks "token") maps to 401
  // through the platform-admin gate — not the old catch-block substring check.
  it('returns 401 when authenticate throws an AuthError with a token-less message', async () => {
    mockAuthenticate.mockRejectedValueOnce(new MockAuthError('Missing oid or tid claims'));

    const res = await handler(baseReq as any, {} as any);

    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Missing oid or tid claims' });
  });

  // issue #104: a non-auth error whose message merely contains "token" must NOT
  // be mistaken for a 401 — it routes to a generic, logged 500 (no leak).
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
});
