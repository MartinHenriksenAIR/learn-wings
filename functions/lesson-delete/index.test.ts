import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const {
  mockAuthenticate, MockAuthError, mockQueryOne, mockGetProfile, mockDeleteBlob,
} = vi.hoisted(() => {
  class MockAuthError extends Error {}
  return {
    mockAuthenticate: vi.fn(), MockAuthError,
    mockQueryOne: vi.fn(),
    mockGetProfile: vi.fn(),
    mockDeleteBlob: vi.fn(),
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
vi.mock('../shared/blob', () => ({ deleteBlob: mockDeleteBlob }));

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
    mockDeleteBlob.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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

  it('returns 404 when lesson not found — DELETE RETURNING returns null, deleteBlob never called', async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(404);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Lesson not found' });
    expect(mockDeleteBlob).not.toHaveBeenCalled();
  });

  it('DELETE SQL uses RETURNING azure_blob_path', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'lesson-1', azure_blob_path: null });
    await handler(baseReq(validBody), {} as any);
    const sql = mockQueryOne.mock.calls[0][0] as string;
    expect(sql).toMatch(/DELETE FROM lessons WHERE id = \$1/i);
    expect(sql).toMatch(/RETURNING/i);
    expect(sql).toMatch(/azure_blob_path/i);
    // Single DB call — no separate SELECT before the DELETE
    expect(mockQueryOne).toHaveBeenCalledTimes(1);
  });

  it('no blob path: skips deleteBlob, deletes row, returns blobDeleted:null', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'lesson-1', azure_blob_path: null });
    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ success: true, blobDeleted: null });
    expect(mockDeleteBlob).not.toHaveBeenCalled();
  });

  it('blob path + storage 404 (already gone): blobDeleted:true', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'lesson-1', azure_blob_path: 'videos/lesson-1.mp4' });
    mockDeleteBlob.mockResolvedValue(true); // helper returns true for 404
    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ success: true, blobDeleted: true });
    expect(mockDeleteBlob).toHaveBeenCalledWith('videos/lesson-1.mp4');
  });

  it('blob path + storage 500: blobDeleted:false, still 200 success', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'lesson-1', azure_blob_path: 'videos/lesson-1.mp4' });
    mockDeleteBlob.mockResolvedValue(false);
    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ success: true, blobDeleted: false });
  });

  it('blob path + fetch rejects: blobDeleted:false, still 200 success', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'lesson-1', azure_blob_path: 'videos/lesson-1.mp4' });
    mockDeleteBlob.mockResolvedValue(false); // helper swallows the rejection and returns false
    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ success: true, blobDeleted: false });
  });

  it('row deleted + blob path present: deleteBlob is called with the path', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'lesson-1', azure_blob_path: 'videos/lesson-1.mp4' });
    mockDeleteBlob.mockResolvedValue(true);
    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(200);
    expect(mockDeleteBlob).toHaveBeenCalledWith('videos/lesson-1.mp4');
    expect(JSON.parse(res.body as string)).toEqual({ success: true, blobDeleted: true });
  });

  it('returns 500 on db error propagating err.message', async () => {
    mockQueryOne.mockRejectedValueOnce(new Error('DB down'));
    const res = await handler(baseReq(validBody), { error: vi.fn() } as any);
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Internal server error' });
  });
});
