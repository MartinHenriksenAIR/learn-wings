import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockAuthenticate, MockAuthError, mockQuery, mockQueryOne, mockGetProfile, mockDeleteBlob, mockCleanupBlobs,
} = vi.hoisted(() => {
  class MockAuthError extends Error {}
  const mockDeleteBlob = vi.fn();
  return {
    mockAuthenticate: vi.fn(), MockAuthError,
    mockQuery: vi.fn(),
    mockQueryOne: vi.fn(),
    mockGetProfile: vi.fn(),
    mockDeleteBlob,
    mockCleanupBlobs: vi.fn(async (paths: string[], _logTag: string, _id: string) => {
      const results = await Promise.all(paths.map((p) => mockDeleteBlob(p)));
      const blobsDeleted = results.filter(Boolean).length;
      return { blobsDeleted, blobsFailed: results.length - blobsDeleted };
    }),
  };
});
vi.mock('../shared/auth', () => ({ authenticate: mockAuthenticate, AuthError: MockAuthError }));
// `query` serves two callers here: the endpoint's own collect SELECT (first call)
// and the reference query the REAL blob-ownership release gate issues afterwards
// (second call). The gate is exercised rather than stubbed, so "referenced by
// another row" is expressed as the rows that second call returns.
vi.mock('../shared/db', () => ({ query: mockQuery, queryOne: mockQueryOne, withTransaction: vi.fn(), getDb: vi.fn() }));
vi.mock('../shared/profile', () => ({
  getProfile: mockGetProfile,
  isActiveMember: vi.fn(),
  isOrgAdmin: vi.fn(),
  isOrgAdminOfAny: vi.fn(),
}));
// cleanupBlobs is faked in terms of mockDeleteBlob so the assertions below still pin what
// belongs to THIS endpoint: which paths it collects, that it attempts one delete per path,
// and that it echoes the returned counts into the response body. The arithmetic those
// assertions compare against comes from the fake, not from the real helper — cleanupBlobs'
// own counting/warning contract is covered by describe('cleanupBlobs') in shared/blob.test.ts.
//
// `classifyBlobPath` stays REAL (spread from the original) because blob-ownership
// imports it from here and it is a pure string check — stubbing it would make
// every release-gate assertion below vacuous.
vi.mock('../shared/blob', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../shared/blob')>()),
  deleteBlob: mockDeleteBlob,
  cleanupBlobs: mockCleanupBlobs,
}));

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
    // Default: no descendant blob paths; DELETE returns a row. The same default
    // answers the release gate's reference query with "nobody references these".
    mockQuery.mockResolvedValue([]);
    mockQueryOne.mockResolvedValue({ id: 'mod-1' });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
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

  it('collect SQL filters by module_id and covers all three lesson blob columns', async () => {
    mockQuery.mockResolvedValueOnce([]);
    mockQueryOne.mockResolvedValueOnce({ id: 'mod-1' });
    await handler(baseReq(validBody), {} as any);
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toMatch(/azure_blob_path/i);
    expect(sql).toMatch(/FROM lessons/i);
    expect(sql).toMatch(/module_id\s*=\s*\$1/i);
    expect(sql).toMatch(/azure_blob_path IS NOT NULL/i);
    // #280: collecting only azure_blob_path stranded every document lesson's file
    // and every Supabase-era video_storage_path.
    expect(sql).toMatch(/video_storage_path IS NOT NULL/i);
    expect(sql).toMatch(/document_storage_path IS NOT NULL/i);
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

  it('passes the collected paths to cleanupBlobs tagged with the endpoint name and moduleId', async () => {
    mockQuery.mockResolvedValueOnce([
      { azure_blob_path: 'videos/a.mp4' },
      { azure_blob_path: 'videos/b.mp4' },
    ]);
    mockQueryOne.mockResolvedValueOnce({ id: 'mod-1' });
    await handler(baseReq(validBody), {} as any);
    expect(mockCleanupBlobs).toHaveBeenCalledWith(['videos/a.mp4', 'videos/b.mp4'], 'module-delete', 'mod-1');
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

  it('deletes video, document AND legacy video_storage_path blobs, not just azure_blob_path — #280', async () => {
    mockQuery.mockResolvedValueOnce([
      { video_storage_path: 'videos/legacy.mp4', azure_blob_path: 'new.mp4', document_storage_path: null },
      { video_storage_path: null, azure_blob_path: null, document_storage_path: 'documents/handout.pdf' },
    ]);
    mockQueryOne.mockResolvedValueOnce({ id: 'mod-1' });
    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ success: true, blobsDeleted: 3, blobsFailed: 0 });
    expect(mockCleanupBlobs).toHaveBeenCalledWith(
      ['videos/legacy.mp4', 'new.mp4', 'documents/handout.pdf'],
      'module-delete',
      'mod-1',
    );
  });

  it('deletes a path duplicated across columns exactly once', async () => {
    mockQuery.mockResolvedValueOnce([
      { video_storage_path: 'same.mp4', azure_blob_path: 'same.mp4', document_storage_path: null },
      { video_storage_path: null, azure_blob_path: 'same.mp4', document_storage_path: null },
    ]);
    mockQueryOne.mockResolvedValueOnce({ id: 'mod-1' });
    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ success: true, blobsDeleted: 1, blobsFailed: 0 });
    expect(mockDeleteBlob).toHaveBeenCalledTimes(1);
    expect(mockDeleteBlob).toHaveBeenCalledWith('same.mp4');
  });

  it('leaves a path another row still references, and still deletes its sibling — #280', async () => {
    // Pre-#279 rows can share a path; cascading this module must not destroy the
    // blob a surviving lesson elsewhere points at. The sibling that IS deleted in
    // the same run is what keeps this test non-vacuous.
    mockQuery
      .mockResolvedValueOnce([
        { video_storage_path: null, azure_blob_path: 'shared.mp4', document_storage_path: null },
        { video_storage_path: null, azure_blob_path: 'own.mp4', document_storage_path: null },
      ])
      .mockResolvedValueOnce([{ path: 'shared.mp4' }]);
    mockQueryOne.mockResolvedValueOnce({ id: 'mod-1' });
    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ success: true, blobsDeleted: 1, blobsFailed: 0 });
    expect(mockDeleteBlob).toHaveBeenCalledTimes(1);
    expect(mockDeleteBlob).toHaveBeenCalledWith('own.mp4');
    expect(mockDeleteBlob).not.toHaveBeenCalledWith('shared.mp4');
  });

  it('release-check DB failure: nothing deleted, request still succeeds', async () => {
    // The gate fails SAFE — an unanswered "is anyone else using this?" must never
    // resolve to "delete it", and must never turn a completed row delete into a 500.
    // A standing implementation rather than a queued `…Once`, so the assertion
    // cannot be satisfied by the collect query alone: whatever the endpoint asks
    // second, it gets an error. beforeEach's `mockResolvedValue([])` replaces it.
    let call = 0;
    mockQuery.mockReset();
    mockQuery.mockImplementation(async () => {
      call += 1;
      if (call === 1) return [{ video_storage_path: null, azure_blob_path: 'a.mp4', document_storage_path: null }];
      throw new Error('connection refused');
    });
    mockQueryOne.mockResolvedValueOnce({ id: 'mod-1' });
    const res = await handler(baseReq(validBody), { error: vi.fn() } as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ success: true, blobsDeleted: 0, blobsFailed: 0 });
    expect(mockDeleteBlob).not.toHaveBeenCalled();
  });

  it('returns 500 on db error propagating err.message', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db connection failed'));
    const res = await handler(baseReq(validBody), { error: vi.fn() } as any);
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Internal server error' });
  });
});
