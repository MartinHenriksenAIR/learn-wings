import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const {
  mockAuthenticate, MockAuthError, mockQueryOne, mockGetProfile,
  mockGenerateSasToken, mockBuildBlobUrl,
} = vi.hoisted(() => {
  class MockAuthError extends Error {}
  return {
    mockAuthenticate: vi.fn(), MockAuthError,
    mockQueryOne: vi.fn(),
    mockGetProfile: vi.fn(),
    mockGenerateSasToken: vi.fn(),
    mockBuildBlobUrl: vi.fn(),
  };
});
vi.mock('../shared/auth', () => ({ authenticate: mockAuthenticate, AuthError: MockAuthError }));
vi.mock('../shared/db', () => ({ query: vi.fn(), queryOne: mockQueryOne, withTransaction: vi.fn(), getDb: vi.fn() }));
vi.mock('../shared/profile', () => ({
  getProfile: mockGetProfile,
  isActiveMember: vi.fn(),
  isOrgAdmin: vi.fn(),
  isOrgAdminOfAny: vi.fn(),
}));
vi.mock('../shared/sas', () => ({
  generateSasToken: mockGenerateSasToken,
  buildBlobUrl: mockBuildBlobUrl,
}));

import handler from './index';

const baseReq = (body: unknown) => ({
  method: 'POST',
  headers: { get: (k: string) => (k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok') },
  json: async () => body,
}) as any;

const adminProfile = { id: 'admin-1', is_platform_admin: true };
const nonAdminProfile = { id: 'user-1', is_platform_admin: false };

const validBody = { lessonId: 'lesson-1' };

describe('lesson-delete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ id: 'oid-1', tid: 'tid-1', email: 'u@x.com' });
    mockGetProfile.mockResolvedValue(adminProfile);
    mockGenerateSasToken.mockReturnValue('sas-token-123');
    mockBuildBlobUrl.mockReturnValue('https://storage.blob.core.windows.net/container/blob?sas-token-123');
    // Restore env vars before each test
    process.env.AZURE_STORAGE_ACCOUNT_NAME = 'testaccount';
    process.env.AZURE_STORAGE_ACCOUNT_KEY = 'dGVzdGtleQ==';
    process.env.AZURE_STORAGE_CONTAINER_NAME = 'lms-videos';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.AZURE_STORAGE_ACCOUNT_NAME;
    delete process.env.AZURE_STORAGE_ACCOUNT_KEY;
    delete process.env.AZURE_STORAGE_CONTAINER_NAME;
  });

  it('handles OPTIONS preflight', async () => {
    const req = { method: 'OPTIONS', headers: { get: () => 'https://ai-uddannelse.dk' } } as any;
    const res = await handler(req, {} as any);
    expect(res.status).toBe(204);
  });

  it('returns 401 when bearer token is invalid', async () => {
    mockAuthenticate.mockRejectedValueOnce(new MockAuthError('Missing Bearer token'));
    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Missing Bearer token' });
  });

  it('returns 401 when profile is not provisioned', async () => {
    mockGetProfile.mockResolvedValueOnce(null);
    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Profile not found' });
  });

  it('returns 403 for non-platform-admin', async () => {
    mockGetProfile.mockResolvedValueOnce(nonAdminProfile);
    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Forbidden' });
  });

  it('returns 400 when lessonId is missing', async () => {
    const res = await handler(baseReq({}), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'lessonId is required' });
  });

  it('returns 400 when lessonId is empty string', async () => {
    const res = await handler(baseReq({ lessonId: '' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'lessonId is required' });
  });

  it('returns 400 when lessonId is not a string', async () => {
    const res = await handler(baseReq({ lessonId: 42 }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'lessonId is required' });
  });

  it('returns 404 when lesson not found (before any blob work)', async () => {
    mockQueryOne.mockResolvedValueOnce(null); // SELECT returns null
    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(404);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Lesson not found' });
    // No SAS or fetch work should have happened
    expect(mockGenerateSasToken).not.toHaveBeenCalled();
  });

  it('(a) no blob path: skips SAS/fetch, deletes row, returns blobDeleted:false', async () => {
    mockQueryOne.mockResolvedValueOnce({ azure_blob_path: null });   // SELECT
    mockQueryOne.mockResolvedValueOnce({ id: 'lesson-1' });           // DELETE RETURNING
    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ success: true, blobDeleted: false });
    expect(mockGenerateSasToken).not.toHaveBeenCalled();
  });

  it('(b) blob path + successful DELETE (202): blobDeleted:true, SAS called with permission "d"', async () => {
    mockQueryOne.mockResolvedValueOnce({ azure_blob_path: 'videos/lesson-1.mp4' }); // SELECT
    mockQueryOne.mockResolvedValueOnce({ id: 'lesson-1' });                           // DELETE RETURNING
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 202 }));

    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ success: true, blobDeleted: true });
    expect(mockGenerateSasToken).toHaveBeenCalledWith(
      'testaccount',
      'dGVzdGtleQ==',
      'lms-videos',
      'videos/lesson-1.mp4',
      'd',
      10,
    );
  });

  it('(c) blob delete fetch rejects: warning logged, row still deleted, blobDeleted:false', async () => {
    mockQueryOne.mockResolvedValueOnce({ azure_blob_path: 'videos/lesson-1.mp4' }); // SELECT
    mockQueryOne.mockResolvedValueOnce({ id: 'lesson-1' });                           // DELETE RETURNING
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ success: true, blobDeleted: false });
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('(d) blob delete non-2xx response: blobDeleted:false, row still deleted', async () => {
    mockQueryOne.mockResolvedValueOnce({ azure_blob_path: 'videos/lesson-1.mp4' }); // SELECT
    mockQueryOne.mockResolvedValueOnce({ id: 'lesson-1' });                           // DELETE RETURNING
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ success: true, blobDeleted: false });
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('(e) missing storage env vars: blobDeleted:false, row still deleted', async () => {
    delete process.env.AZURE_STORAGE_ACCOUNT_NAME;
    delete process.env.AZURE_STORAGE_ACCOUNT_KEY;
    mockQueryOne.mockResolvedValueOnce({ azure_blob_path: 'videos/lesson-1.mp4' }); // SELECT
    mockQueryOne.mockResolvedValueOnce({ id: 'lesson-1' });                           // DELETE RETURNING
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ success: true, blobDeleted: false });
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('row delete race (DELETE returns null): 404', async () => {
    mockQueryOne.mockResolvedValueOnce({ azure_blob_path: null }); // SELECT found
    mockQueryOne.mockResolvedValueOnce(null);                       // DELETE returns null (race)
    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(404);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Lesson not found' });
  });

  it('returns 500 on db error propagating err.message', async () => {
    mockQueryOne.mockRejectedValueOnce(new Error('DB down'));
    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'DB down' });
  });
});
