import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuthenticate, MockAuthError, mockQueryOne, mockGetProfile, mockDeleteBlob } = vi.hoisted(() => {
  class MockAuthError extends Error {}
  return {
    mockAuthenticate: vi.fn(),
    MockAuthError,
    mockQueryOne: vi.fn(),
    mockGetProfile: vi.fn(),
    mockDeleteBlob: vi.fn().mockResolvedValue(true),
  };
});
vi.mock('../shared/auth', () => ({ authenticate: mockAuthenticate, AuthError: MockAuthError }));
vi.mock('../shared/db', () => ({ queryOne: mockQueryOne }));
vi.mock('../shared/profile', () => ({ getProfile: mockGetProfile }));
vi.mock('../shared/blob', () => ({ deleteBlob: mockDeleteBlob }));

process.env.AZURE_STORAGE_ACCOUNT_NAME = 'testaccount';
process.env.AZURE_STORAGE_ACCOUNT_KEY = Buffer.alloc(32).toString('base64');
process.env.AZURE_STORAGE_CONTAINER_NAME = 'lms-videos';
process.env.ALLOWED_ORIGINS = 'https://ai-uddannelse.dk';

import { default as handler } from './index';

const baseReq = {
  method: 'POST',
  headers: { get: (k: string) => k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok' },
  json: async () => ({ blobPath: 'some-uuid.mp4' }),
};

describe('azure-delete-blob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ id: 'oid-1', tid: 'tid-1', email: 'admin@test.com' });
    mockGetProfile.mockResolvedValue({ id: 'p1', is_platform_admin: true });
    mockDeleteBlob.mockResolvedValue(true);
  });

  it('returns success when admin deletes existing blob', async () => {
    const res = await handler(baseReq as any, {} as any);
    const body = JSON.parse(res.body as string);

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.message).toBe('Blob deleted');
    expect(mockDeleteBlob).toHaveBeenCalledWith('some-uuid.mp4');
  });

  it('returns 200 when blob not found (404 from storage is acceptable — helper returns true)', async () => {
    // deleteBlob returns true for 404 (already gone) — caller sees success
    mockDeleteBlob.mockResolvedValue(true);

    const res = await handler(baseReq as any, {} as any);
    const body = JSON.parse(res.body as string);

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
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

  it('returns 400 when blobPath is missing', async () => {
    const req = {
      ...baseReq,
      json: async () => ({}),
    };

    const res = await handler(req as any, {} as any);

    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'blobPath is required' });
  });

  it('returns 401 on auth token error', async () => {
    mockAuthenticate.mockRejectedValueOnce(new Error('Invalid token'));

    const res = await handler(baseReq as any, {} as any);

    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Invalid token' });
  });

  it('returns 500 when blob delete fails (helper returns false)', async () => {
    mockDeleteBlob.mockResolvedValue(false);

    const res = await handler(baseReq as any, {} as any);

    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string).error).toContain('Blob delete failed');
  });

  it('regression: no db query contains FROM profiles WHERE id =', async () => {
    await handler(baseReq as any, {} as any);

    for (const call of mockQueryOne.mock.calls) {
      expect((call[0] as string)).not.toContain('FROM profiles WHERE id =');
    }
  });
});
