import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuthenticate, MockAuthError, mockQueryOne, mockGetProfile } = vi.hoisted(() => {
  class MockAuthError extends Error {}
  return {
    mockAuthenticate: vi.fn(), MockAuthError,
    mockQueryOne: vi.fn(),
    mockGetProfile: vi.fn(),
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

import handler from './index';

const baseReq = (body: unknown) => ({
  method: 'POST',
  headers: { get: (k: string) => (k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok') },
  json: async () => body,
}) as any;

const adminProfile = { id: 'admin-1', is_platform_admin: true };
const nonAdminProfile = { id: 'user-1', is_platform_admin: false };

const validBody = {
  moduleId: 'mod-1',
  title: 'Lesson One',
  lessonType: 'video',
  sortOrder: 0,
};

const fakeLesson = {
  id: 'lesson-1',
  module_id: 'mod-1',
  title: 'Lesson One',
  lesson_type: 'video',
  sort_order: 0,
  video_url: null,
};

describe('lesson-create', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ id: 'oid-1', tid: 'tid-1', email: 'u@x.com' });
    mockGetProfile.mockResolvedValue(adminProfile);
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
    const { moduleId: _m, ...body } = validBody;
    const res = await handler(baseReq(body), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'moduleId is required' });
  });

  it('returns 400 when moduleId is empty string', async () => {
    const res = await handler(baseReq({ ...validBody, moduleId: '' }), {} as any);
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
    const res = await handler(baseReq({ ...validBody, lessonType: 'audio' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: "lessonType must be 'video', 'document', or 'quiz'" });
  });

  it('returns 400 when sortOrder is missing', async () => {
    const { sortOrder: _s, ...body } = validBody;
    const res = await handler(baseReq(body), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'sortOrder must be an integer' });
  });

  it('returns 400 when sortOrder is a float', async () => {
    const res = await handler(baseReq({ ...validBody, sortOrder: 1.5 }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'sortOrder must be an integer' });
  });

  it('returns 400 when sortOrder is a string', async () => {
    const res = await handler(baseReq({ ...validBody, sortOrder: '0' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'sortOrder must be an integer' });
  });

  it('returns 400 when contentText is not a string (type violation)', async () => {
    const res = await handler(baseReq({ ...validBody, contentText: 42 }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'contentText must be a string or null' });
  });

  it('returns 400 when durationMinutes is a float', async () => {
    const res = await handler(baseReq({ ...validBody, durationMinutes: 1.5 }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'durationMinutes must be an integer or null' });
  });

  it('returns 400 when durationMinutes is a non-null non-integer', async () => {
    const res = await handler(baseReq({ ...validBody, durationMinutes: 'five' }), {} as any);
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
    const res = await handler(baseReq({ ...validBody, azureBlobPath: true }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'azureBlobPath must be a non-empty string or null' });
  });

  it('returns 400 when azureBlobPath is empty string', async () => {
    const res = await handler(baseReq({ ...validBody, azureBlobPath: '' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'azureBlobPath must be a non-empty string or null' });
  });

  it('returns 400 when documentStoragePath is not a string', async () => {
    const res = await handler(baseReq({ ...validBody, documentStoragePath: {} }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'documentStoragePath must be a non-empty string or null' });
  });

  it('returns 400 when documentStoragePath is empty string', async () => {
    const res = await handler(baseReq({ ...validBody, documentStoragePath: '' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'documentStoragePath must be a non-empty string or null' });
  });

  it('happy path: inserts lesson and returns it', async () => {
    mockQueryOne.mockResolvedValueOnce(fakeLesson);
    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ lesson: fakeLesson });

    const [sql, params] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('INSERT INTO lessons');
    expect(sql).toContain('RETURNING *');
    // Params order: [moduleId, title, lessonType, contentText, durationMinutes, videoStoragePath, null (video_url), azureBlobPath, documentStoragePath, sortOrder]
    expect(params[0]).toBe('mod-1');    // module_id
    expect(params[1]).toBe('Lesson One'); // title (raw)
    expect(params[2]).toBe('video');     // lesson_type
    expect(params[3]).toBeNull();        // content_text
    expect(params[4]).toBeNull();        // duration_minutes
    expect(params[5]).toBeNull();        // video_storage_path
    expect(params[6]).toBeNull();        // video_url — always null
    expect(params[7]).toBeNull();        // azure_blob_path
    expect(params[8]).toBeNull();        // document_storage_path
    expect(params[9]).toBe(0);           // sort_order
  });

  it('happy path: optional fields passed through, video_url always null', async () => {
    const body = {
      ...validBody,
      lessonType: 'document',
      contentText: 'Some text',
      durationMinutes: 30,
      videoStoragePath: 'path/to/video',
      azureBlobPath: 'blob/path',
      documentStoragePath: 'doc/path',
      sortOrder: 5,
    };
    mockQueryOne.mockResolvedValueOnce({ ...fakeLesson, ...body });
    const res = await handler(baseReq(body), {} as any);
    expect(res.status).toBe(200);

    const [, params] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(params[3]).toBe('Some text');      // content_text
    expect(params[4]).toBe(30);               // duration_minutes
    expect(params[5]).toBe('path/to/video');  // video_storage_path
    expect(params[6]).toBeNull();             // video_url always null
    expect(params[7]).toBe('blob/path');      // azure_blob_path
    expect(params[8]).toBe('doc/path');       // document_storage_path
    expect(params[9]).toBe(5);               // sort_order
  });

  it('accepts durationMinutes: null', async () => {
    mockQueryOne.mockResolvedValueOnce(fakeLesson);
    const res = await handler(baseReq({ ...validBody, durationMinutes: null }), {} as any);
    expect(res.status).toBe(200);
    const [, params] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(params[4]).toBeNull();
  });

  it('accepts all three lesson types', async () => {
    for (const lessonType of ['video', 'document', 'quiz'] as const) {
      mockQueryOne.mockResolvedValueOnce({ ...fakeLesson, lesson_type: lessonType });
      const res = await handler(baseReq({ ...validBody, lessonType }), {} as any);
      expect(res.status).toBe(200);
    }
  });

  it('returns 500 on db error propagating err.message', async () => {
    mockQueryOne.mockRejectedValueOnce(new Error('FK violation'));
    const res = await handler(baseReq(validBody), { error: vi.fn() } as any);
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Internal server error' });
  });
});
