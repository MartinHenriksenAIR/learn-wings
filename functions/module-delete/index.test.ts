import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockAuthenticate, MockAuthError, mockQuery, mockQueryOne, mockGetProfile, mockDeleteBlob,
} = vi.hoisted(() => {
  class MockAuthError extends Error {}
  return {
    mockAuthenticate: vi.fn(), MockAuthError,
    mockQuery: vi.fn(),
    mockQueryOne: vi.fn(),
    mockGetProfile: vi.fn(),
    mockDeleteBlob: vi.fn(),
  };
});
vi.mock('../shared/auth', () => ({ authenticate: mockAuthenticate, AuthError: MockAuthError }));
vi.mock('../shared/db', () => ({ query: mockQuery, queryOne: mockQueryOne, withTransaction: vi.fn(), getDb: vi.fn() }));
vi.mock('../shared/profile', () => ({
  getProfile: mockGetProfile,
  isActiveMember: vi.fn(),
  isOrgAdmin: vi.fn(),
  isOrgAdminOfAny: vi.fn(),
}));
vi.mock('../shared/blob', () => ({ deleteBlob: mockDeleteBlob }));

import handler from './index';

const baseReq = (body: unknown) => ({
  method: 'POST',
  headers: { get: (k: string) => (k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok') },
  json: async () => body,
}) as any;

const adminProfile = { id: 'admin-1', is_platform_admin: true };
const nonAdminProfile = { id: 'user-1', is_platform_admin: false };

const validBody = { moduleId: 'mod-1' };

describe('module-delete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ id: 'oid-1', tid: 'tid-1', email: 'u@x.com' });
    mockGetProfile.mockResolvedValue(adminProfile);
    mockDeleteBlob.mockResolvedValue(true);
    // Default: no descendant blob paths; DELETE returns a row
    mockQuery.mockResolvedValue([]);
    mockQueryOne.mockResolvedValue({ id: 'mod-1' });
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

  it('returns 400 when moduleId is missing', async () => {
    const res = await handler(baseReq({}), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'moduleId is required' });
  });

  it('returns 400 when moduleId is empty string', async () => {
    const res = await handler(baseReq({ moduleId: '' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'moduleId is required' });
  });

  it('returns 400 when moduleId is not a string', async () => {
    const res = await handler(baseReq({ moduleId: 42 }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'moduleId is required' });
  });

  it('returns 404 when module not found — deleteBlob never called', async () => {
    mockQuery.mockResolvedValueOnce([]);
    mockQueryOne.mockResolvedValueOnce(null);
    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(404);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Module not found' });
    expect(mockDeleteBlob).not.toHaveBeenCalled();
  });

  it('collect SQL filters by module_id and azure_blob_path IS NOT NULL', async () => {
    mockQuery.mockResolvedValueOnce([]);
    mockQueryOne.mockResolvedValueOnce({ id: 'mod-1' });
    await handler(baseReq(validBody), {} as any);
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toMatch(/azure_blob_path/i);
    expect(sql).toMatch(/FROM lessons/i);
    expect(sql).toMatch(/module_id\s*=\s*\$1/i);
    expect(sql).toMatch(/azure_blob_path IS NOT NULL/i);
  });

  it('no descendant blobs: returns blobsDeleted:0, blobsFailed:0', async () => {
    mockQuery.mockResolvedValueOnce([]);
    mockQueryOne.mockResolvedValueOnce({ id: 'mod-1' });
    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ success: true, blobsDeleted: 0, blobsFailed: 0 });
    expect(mockDeleteBlob).not.toHaveBeenCalled();
  });

  it('two blob paths both succeed: blobsDeleted:2, blobsFailed:0', async () => {
    mockQuery.mockResolvedValueOnce([
      { azure_blob_path: 'videos/a.mp4' },
      { azure_blob_path: 'videos/b.mp4' },
    ]);
    mockQueryOne.mockResolvedValueOnce({ id: 'mod-1' });
    mockDeleteBlob.mockResolvedValue(true);
    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ success: true, blobsDeleted: 2, blobsFailed: 0 });
    expect(mockDeleteBlob).toHaveBeenCalledTimes(2);
  });

  it('mixed results (one true, one false): blobsDeleted:1, blobsFailed:1, still 200', async () => {
    mockQuery.mockResolvedValueOnce([
      { azure_blob_path: 'videos/a.mp4' },
      { azure_blob_path: 'videos/b.mp4' },
    ]);
    mockQueryOne.mockResolvedValueOnce({ id: 'mod-1' });
    mockDeleteBlob
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ success: true, blobsDeleted: 1, blobsFailed: 1 });
  });

  it('returns 500 on db error propagating err.message', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db connection failed'));
    const res = await handler(baseReq(validBody), { error: vi.fn() } as any);
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Internal server error' });
  });
});
