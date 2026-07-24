import { describe, it, expect, vi, beforeEach } from 'vitest';

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

const validBody = {
  lessonId: 'lesson-1',
  moduleId: 'mod-1',
  title: 'Updated Lesson',
  lessonType: 'video',
};

const fakeLesson = {
  id: 'lesson-1',
  module_id: 'mod-1',
  title: 'Updated Lesson',
  lesson_type: 'video',
  video_url: null,
};

/** The row the endpoint's pre-update SELECT returns (all three blob columns). */
const prevPaths = (over: Partial<Record<'video_storage_path' | 'azure_blob_path' | 'document_storage_path', string | null>> = {}) => ({
  video_storage_path: null,
  azure_blob_path: null,
  document_storage_path: null,
  ...over,
});

/** The endpoint issues exactly two queryOne calls: [0] the previous-paths SELECT, [1] the UPDATE. */
const mockDb = (previous: unknown, updated: unknown) => {
  mockQueryOne.mockResolvedValueOnce(previous).mockResolvedValueOnce(updated);
};
const updateCall = () => mockQueryOne.mock.calls[1] as [string, unknown[]];

describe('lesson-update', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ id: 'oid-1', tid: 'tid-1', email: 'u@x.com' });
    mockGetProfile.mockResolvedValue(adminProfile);
    mockDeleteBlob.mockResolvedValue(true);
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
    const { lessonId: _l, ...body } = validBody;
    const res = await handler(baseReq(body), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'lessonId is required' });
  });

  it('returns 400 when lessonId is empty string', async () => {
    const res = await handler(baseReq({ ...validBody, lessonId: '' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'lessonId is required' });
  });

  it('returns 400 when lessonId is not a string', async () => {
    const res = await handler(baseReq({ ...validBody, lessonId: 99 }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'lessonId is required' });
  });

  it('returns 400 when moduleId is missing', async () => {
    const { moduleId: _m, ...body } = validBody;
    const res = await handler(baseReq(body), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'moduleId is required' });
  });

  it('returns 400 when moduleId is not a string', async () => {
    const res = await handler(baseReq({ ...validBody, moduleId: 42 }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'moduleId is required' });
  });

  it('returns 400 when title is missing', async () => {
    const { title: _t, ...body } = validBody;
    const res = await handler(baseReq(body), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'title is required' });
  });

  it('returns 400 when title is empty after trim', async () => {
    const res = await handler(baseReq({ ...validBody, title: '   ' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'title is required' });
  });

  it('returns 400 when title is not a string', async () => {
    const res = await handler(baseReq({ ...validBody, title: 99 }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'title is required' });
  });

  it('returns 400 when lessonType is missing', async () => {
    const { lessonType: _l, ...body } = validBody;
    const res = await handler(baseReq(body), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: "lessonType must be 'video', 'document', or 'quiz'" });
  });

  it('returns 400 when lessonType is invalid', async () => {
    const res = await handler(baseReq({ ...validBody, lessonType: 'text' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: "lessonType must be 'video', 'document', or 'quiz'" });
  });

  it('returns 400 when contentText is not a string (type violation)', async () => {
    const res = await handler(baseReq({ ...validBody, contentText: 42 }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'contentText must be a string or null' });
  });

  it('returns 400 when durationMinutes is a float', async () => {
    const res = await handler(baseReq({ ...validBody, durationMinutes: 2.7 }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'durationMinutes must be an integer or null' });
  });

  it('returns 400 when durationMinutes is a non-null non-integer', async () => {
    const res = await handler(baseReq({ ...validBody, durationMinutes: 'ten' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'durationMinutes must be an integer or null' });
  });

  it('returns 400 when videoStoragePath is not a string', async () => {
    const res = await handler(baseReq({ ...validBody, videoStoragePath: 123 }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'videoStoragePath must be a non-empty string or null' });
  });

  it('returns 400 when videoStoragePath is empty string', async () => {
    const res = await handler(baseReq({ ...validBody, videoStoragePath: '' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'videoStoragePath must be a non-empty string or null' });
  });

  it('returns 400 when azureBlobPath is not a string', async () => {
    const res = await handler(baseReq({ ...validBody, azureBlobPath: false }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'azureBlobPath must be a non-empty string or null' });
  });

  it('returns 400 when azureBlobPath is empty string', async () => {
    const res = await handler(baseReq({ ...validBody, azureBlobPath: '' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'azureBlobPath must be a non-empty string or null' });
  });

  it('returns 400 when documentStoragePath is not a string', async () => {
    const res = await handler(baseReq({ ...validBody, documentStoragePath: [] }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'documentStoragePath must be a non-empty string or null' });
  });

  it('returns 400 when documentStoragePath is empty string', async () => {
    const res = await handler(baseReq({ ...validBody, documentStoragePath: '' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'documentStoragePath must be a non-empty string or null' });
  });

  it('returns 404 when lesson not found — and no blob is deleted', async () => {
    mockDb(null, null); // no previous row, UPDATE matches nothing
    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(404);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Lesson not found' });
    expect(mockDeleteBlob).not.toHaveBeenCalled();
  });

  it('reads the previous blob paths with a SELECT before the UPDATE', async () => {
    mockDb(prevPaths(), fakeLesson);
    await handler(baseReq(validBody), {} as any);

    expect(mockQueryOne).toHaveBeenCalledTimes(2);
    const [selectSql, selectParams] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(selectSql).toMatch(/SELECT[\s\S]*FROM lessons/i);
    expect(selectSql).toContain('video_storage_path');
    expect(selectSql).toContain('azure_blob_path');
    expect(selectSql).toContain('document_storage_path');
    expect(selectParams).toEqual(['lesson-1']);
  });

  it('happy path: updates lesson and returns it', async () => {
    mockDb(prevPaths(), fakeLesson);
    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ lesson: fakeLesson });

    const [sql, params] = updateCall();
    expect(sql).toContain('UPDATE lessons');
    expect(sql).toContain('RETURNING *');
    // video_url must be set to NULL in the SQL (not as a param), sort_order NOT in SET
    expect(sql).toContain('video_url=NULL');
    expect(sql).not.toMatch(/sort_order\s*=\s*\$/);
    // Params order: [moduleId, title, lessonType, contentText, durationMinutes, videoStoragePath, azureBlobPath, documentStoragePath, lessonId]
    expect(params[0]).toBe('mod-1');         // module_id
    expect(params[1]).toBe('Updated Lesson'); // title (raw)
    expect(params[2]).toBe('video');          // lesson_type
    expect(params[3]).toBeNull();             // content_text
    expect(params[4]).toBeNull();             // duration_minutes
    expect(params[5]).toBeNull();             // video_storage_path
    expect(params[6]).toBeNull();             // azure_blob_path
    expect(params[7]).toBeNull();             // document_storage_path
    expect(params[8]).toBe('lesson-1');       // WHERE id
  });

  it('happy path: optional fields passed through, video_url always NULL in SQL', async () => {
    const body = {
      ...validBody,
      lessonType: 'document',
      contentText: 'Text content',
      durationMinutes: 45,
      videoStoragePath: 'vid/path',
      azureBlobPath: 'blob/path',
      documentStoragePath: 'doc/path',
    };
    mockDb(prevPaths(), { ...fakeLesson, ...body });
    const res = await handler(baseReq(body), {} as any);
    expect(res.status).toBe(200);

    const [sql, params] = updateCall();
    expect(sql).toContain('video_url=NULL');
    expect(params[3]).toBe('Text content');  // content_text
    expect(params[4]).toBe(45);              // duration_minutes
    expect(params[5]).toBe('vid/path');      // video_storage_path
    expect(params[6]).toBe('blob/path');     // azure_blob_path
    expect(params[7]).toBe('doc/path');      // document_storage_path
  });

  it('returns 500 on db error propagating err.message — and deletes no blob', async () => {
    mockQueryOne
      .mockResolvedValueOnce(prevPaths({ azure_blob_path: 'videos/old.mp4' }))
      .mockRejectedValueOnce(new Error('connection refused'));
    const res = await handler(baseReq(validBody), { error: vi.fn() } as any);
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Internal server error' });
    // Row-first ordering: a failed UPDATE must never strand-delete a live video.
    expect(mockDeleteBlob).not.toHaveBeenCalled();
  });

  // --- Superseded-blob cleanup (#275) ---

  it('video replaced: deletes the OLD blob exactly once', async () => {
    mockDb(prevPaths({ azure_blob_path: 'videos/old.mp4' }), fakeLesson);
    const res = await handler(baseReq({ ...validBody, azureBlobPath: 'videos/new.mp4' }), {} as any);
    expect(res.status).toBe(200);
    expect(mockDeleteBlob).toHaveBeenCalledTimes(1);
    expect(mockDeleteBlob).toHaveBeenCalledWith('videos/old.mp4');
  });

  it('video cleared to null: deletes the OLD blob', async () => {
    mockDb(prevPaths({ azure_blob_path: 'videos/old.mp4' }), fakeLesson);
    const res = await handler(baseReq({ ...validBody, azureBlobPath: null }), {} as any);
    expect(res.status).toBe(200);
    expect(mockDeleteBlob).toHaveBeenCalledTimes(1);
    expect(mockDeleteBlob).toHaveBeenCalledWith('videos/old.mp4');
  });

  it('video unchanged: deletes nothing (re-saving another field must not kill a live video)', async () => {
    mockDb(prevPaths({ azure_blob_path: 'videos/keep.mp4' }), fakeLesson);
    const res = await handler(baseReq({ ...validBody, title: 'Renamed', azureBlobPath: 'videos/keep.mp4' }), {} as any);
    expect(res.status).toBe(200);
    expect(mockDeleteBlob).not.toHaveBeenCalled();
  });

  it('old path was null: deletes nothing', async () => {
    mockDb(prevPaths(), fakeLesson);
    const res = await handler(baseReq({ ...validBody, azureBlobPath: 'videos/new.mp4' }), {} as any);
    expect(res.status).toBe(200);
    expect(mockDeleteBlob).not.toHaveBeenCalled();
  });

  it('three columns: video replaced, document unchanged → exactly one delete, the right path', async () => {
    mockDb(
      prevPaths({ azure_blob_path: 'videos/old.mp4', document_storage_path: 'docs/keep.pdf' }),
      fakeLesson,
    );
    const res = await handler(baseReq({
      ...validBody,
      lessonType: 'document',
      azureBlobPath: 'videos/new.mp4',
      documentStoragePath: 'docs/keep.pdf',
    }), {} as any);
    expect(res.status).toBe(200);
    expect(mockDeleteBlob).toHaveBeenCalledTimes(1);
    expect(mockDeleteBlob).toHaveBeenCalledWith('videos/old.mp4');
  });

  it('three columns: every path replaced → one delete per old path', async () => {
    mockDb(
      prevPaths({
        video_storage_path: 'legacy/old.mp4',
        azure_blob_path: 'videos/old.mp4',
        document_storage_path: 'docs/old.pdf',
      }),
      fakeLesson,
    );
    const res = await handler(baseReq({
      ...validBody,
      videoStoragePath: 'legacy/new.mp4',
      azureBlobPath: 'videos/new.mp4',
      documentStoragePath: 'docs/new.pdf',
    }), {} as any);
    expect(res.status).toBe(200);
    expect(mockDeleteBlob).toHaveBeenCalledTimes(3);
    expect(mockDeleteBlob.mock.calls.map((c) => c[0]).sort())
      .toEqual(['docs/old.pdf', 'legacy/old.mp4', 'videos/old.mp4']);
  });

  it('a path that merely moves between columns is still referenced → not deleted', async () => {
    mockDb(prevPaths({ video_storage_path: 'videos/same.mp4' }), fakeLesson);
    const res = await handler(baseReq({ ...validBody, azureBlobPath: 'videos/same.mp4' }), {} as any);
    expect(res.status).toBe(200);
    expect(mockDeleteBlob).not.toHaveBeenCalled();
  });

  it('deleteBlob returns false (storage 500): request still succeeds with its normal body', async () => {
    mockDb(prevPaths({ azure_blob_path: 'videos/old.mp4' }), fakeLesson);
    mockDeleteBlob.mockResolvedValue(false);
    const res = await handler(baseReq({ ...validBody, azureBlobPath: 'videos/new.mp4' }), {} as any);
    expect(res.status).toBe(200);
    // Cleanup outcome is deliberately NOT surfaced — server logs are the only signal.
    expect(JSON.parse(res.body as string)).toEqual({ lesson: fakeLesson });
  });

  it('storage fetch rejects (helper swallows it → false): request still succeeds', async () => {
    mockDb(prevPaths({ azure_blob_path: 'videos/old.mp4' }), fakeLesson);
    mockDeleteBlob.mockResolvedValue(false); // deleteBlob never throws — a rejected fetch surfaces as false
    const res = await handler(baseReq({ ...validBody, azureBlobPath: 'videos/new.mp4' }), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ lesson: fakeLesson });
  });
});
