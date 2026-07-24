import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockAuthenticate, MockAuthError, mockQueryOne, mockGetProfile, mockDeleteBlob, mockEnforceUploadLimits,
} = vi.hoisted(() => {
  class MockAuthError extends Error {}
  return {
    mockAuthenticate: vi.fn(), MockAuthError,
    mockQueryOne: vi.fn(),
    mockGetProfile: vi.fn(),
    mockDeleteBlob: vi.fn(),
    mockEnforceUploadLimits: vi.fn(),
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
vi.mock('../shared/upload-limits', () => ({ enforceUploadLimits: mockEnforceUploadLimits }));

import handler from './index';

const baseReq = (body: unknown) => ({
  method: 'POST',
  headers: { get: (k: string) => (k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok') },
  json: async () => body,
}) as any;

const adminProfile = { id: 'admin-1', is_platform_admin: true };
const nonAdminProfile = { id: 'user-1', is_platform_admin: false };

const validBody = {
  courseId: 'c1',
  updates: { title: 'Updated Title' },
};

const fakeCourse = {
  id: 'c1',
  title: 'Updated Title',
  level: 'basic',
  is_published: false,
};

/**
 * When (and only when) `thumbnailUrl` is in the update, the endpoint issues a
 * previous-thumbnail SELECT before the UPDATE — so queryOne is called twice.
 */
const mockThumbnailDb = (previousThumbnail: string | null, updated: unknown = fakeCourse) => {
  mockQueryOne.mockResolvedValueOnce({ thumbnail_url: previousThumbnail }).mockResolvedValueOnce(updated);
};

describe('course-update', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ id: 'oid-1', tid: 'tid-1', email: 'u@x.com' });
    mockGetProfile.mockResolvedValue(adminProfile);
    mockDeleteBlob.mockResolvedValue(true);
    mockEnforceUploadLimits.mockResolvedValue(null); // no upload-limit objection
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

  it('returns 400 when courseId is missing', async () => {
    const res = await handler(baseReq({ updates: { title: 'x' } }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'courseId is required' });
  });

  it('returns 400 when courseId is empty string', async () => {
    const res = await handler(baseReq({ courseId: '', updates: { title: 'x' } }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'courseId is required' });
  });

  it('returns 400 when updates is missing', async () => {
    const res = await handler(baseReq({ courseId: 'c1' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'No valid fields to update' });
  });

  it('returns 400 when updates is null', async () => {
    const res = await handler(baseReq({ courseId: 'c1', updates: null }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'No valid fields to update' });
  });

  it('returns 400 when updates has no whitelisted keys', async () => {
    const res = await handler(baseReq({ courseId: 'c1', updates: { unknownField: 'x' } }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'No valid fields to update' });
  });

  it('returns 400 when updates is empty object', async () => {
    const res = await handler(baseReq({ courseId: 'c1', updates: {} }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'No valid fields to update' });
  });

  it('returns 400 when title is empty string', async () => {
    const res = await handler(baseReq({ courseId: 'c1', updates: { title: '  ' } }), {} as any);
    expect(res.status).toBe(400);
  });

  it('returns 400 when title is not a string', async () => {
    const res = await handler(baseReq({ courseId: 'c1', updates: { title: 123 } }), {} as any);
    expect(res.status).toBe(400);
  });

  it('returns 400 when description is not string or null', async () => {
    const res = await handler(baseReq({ courseId: 'c1', updates: { description: 123 } }), {} as any);
    expect(res.status).toBe(400);
  });

  it('allows description as null', async () => {
    mockQueryOne.mockResolvedValueOnce(fakeCourse);
    const res = await handler(baseReq({ courseId: 'c1', updates: { description: null } }), {} as any);
    expect(res.status).toBe(200);
  });

  it('allows description as empty string', async () => {
    mockQueryOne.mockResolvedValueOnce(fakeCourse);
    const res = await handler(baseReq({ courseId: 'c1', updates: { description: '' } }), {} as any);
    expect(res.status).toBe(200);
  });

  it('returns 400 when level is invalid', async () => {
    const res = await handler(baseReq({ courseId: 'c1', updates: { level: 'expert' } }), {} as any);
    expect(res.status).toBe(400);
  });

  it('returns 400 when level is null (NOT NULL column, unlike description/thumbnailUrl)', async () => {
    const res = await handler(baseReq({ courseId: 'c1', updates: { level: null } }), {} as any);
    expect(res.status).toBe(400);
  });

  it('returns 400 when language is invalid', async () => {
    const res = await handler(baseReq({ courseId: 'c1', updates: { language: 'fr' } }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: "language must be 'en' or 'da'" });
  });

  it('returns 400 when language is null (not clearable)', async () => {
    const res = await handler(baseReq({ courseId: 'c1', updates: { language: null } }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: "language must be 'en' or 'da'" });
  });

  it('updates language to da', async () => {
    mockQueryOne.mockResolvedValueOnce({ ...fakeCourse, language: 'da' });
    const res = await handler(baseReq({ courseId: 'c1', updates: { language: 'da' } }), {} as any);
    expect(res.status).toBe(200);

    const [sql, params] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('language');
    expect(params[0]).toBe('da');
    expect(params[params.length - 1]).toBe('c1');
  });

  it('updates language to en', async () => {
    mockQueryOne.mockResolvedValueOnce({ ...fakeCourse, language: 'en' });
    const res = await handler(baseReq({ courseId: 'c1', updates: { language: 'en' } }), {} as any);
    expect(res.status).toBe(200);

    const [sql, params] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('language');
    expect(params[0]).toBe('en');
  });

  it('returns 400 when thumbnailUrl is not string or null', async () => {
    const res = await handler(baseReq({ courseId: 'c1', updates: { thumbnailUrl: 123 } }), {} as any);
    expect(res.status).toBe(400);
  });

  it('allows thumbnailUrl as null', async () => {
    mockThumbnailDb(null);
    const res = await handler(baseReq({ courseId: 'c1', updates: { thumbnailUrl: null } }), {} as any);
    expect(res.status).toBe(200);
  });

  it('returns 400 when isPublished is not boolean', async () => {
    const res = await handler(baseReq({ courseId: 'c1', updates: { isPublished: 'true' } }), {} as any);
    expect(res.status).toBe(400);
  });

  it('returns 404 when course not found', async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(404);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Course not found' });
  });

  it('happy path: updates only provided fields (dynamic SET)', async () => {
    mockQueryOne.mockResolvedValueOnce(fakeCourse);
    const res = await handler(baseReq({ courseId: 'c1', updates: { title: 'Updated Title' } }), {} as any);
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(body).toEqual({ course: fakeCourse });

    const [sql, params] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('UPDATE courses');
    expect(sql).toContain('title');
    expect(sql).not.toContain('description');
    expect(sql).not.toContain('level');
    expect(sql).not.toContain('is_published');
    expect(sql).toContain('RETURNING *');
    expect(params[0]).toBe('Updated Title'); // first SET param
    expect(params[params.length - 1]).toBe('c1'); // WHERE id = $n
  });

  it('happy path: updates multiple fields', async () => {
    const updatedCourse = { id: 'c1', title: 'New Title', level: 'advanced', is_published: true };
    mockQueryOne.mockResolvedValueOnce(updatedCourse);
    const updates = { title: 'New Title', level: 'advanced', isPublished: true };
    const res = await handler(baseReq({ courseId: 'c1', updates }), {} as any);
    expect(res.status).toBe(200);

    const [sql, params] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('title');
    expect(sql).toContain('level');
    expect(sql).toContain('is_published');
    expect(sql).not.toContain('description');
    expect(params).toContain('New Title');
    expect(params).toContain('advanced');
    expect(params).toContain(true);
    expect(params[params.length - 1]).toBe('c1');
  });

  it('silently ignores unknown keys and processes whitelisted ones', async () => {
    mockQueryOne.mockResolvedValueOnce(fakeCourse);
    const res = await handler(baseReq({ courseId: 'c1', updates: { title: 'New', unknownField: 'x' } }), {} as any);
    expect(res.status).toBe(200);

    const [sql] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('title');
    expect(sql).not.toContain('unknownField');
  });

  it('returns 500 on db error propagating err.message', async () => {
    mockQueryOne.mockRejectedValueOnce(new Error('db connection failed'));
    const res = await handler(baseReq(validBody), { error: vi.fn() } as any);
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Internal server error' });
  });

  // --- Superseded-thumbnail cleanup (#275) ---

  const thumbUpdate = (thumbnailUrl: string | null) => ({ courseId: 'c1', updates: { thumbnailUrl } });

  it('thumbnail replaced: deletes the OLD blob exactly once', async () => {
    mockThumbnailDb('thumbs/old.png');
    const res = await handler(baseReq(thumbUpdate('thumbs/new.png')), {} as any);
    expect(res.status).toBe(200);
    expect(mockDeleteBlob).toHaveBeenCalledTimes(1);
    expect(mockDeleteBlob).toHaveBeenCalledWith('thumbs/old.png');
  });

  it('thumbnail cleared to null: deletes the OLD blob', async () => {
    mockThumbnailDb('thumbs/old.png');
    const res = await handler(baseReq(thumbUpdate(null)), {} as any);
    expect(res.status).toBe(200);
    expect(mockDeleteBlob).toHaveBeenCalledTimes(1);
    expect(mockDeleteBlob).toHaveBeenCalledWith('thumbs/old.png');
  });

  it('thumbnail unchanged: deletes nothing', async () => {
    mockThumbnailDb('thumbs/keep.png');
    const res = await handler(baseReq(thumbUpdate('thumbs/keep.png')), {} as any);
    expect(res.status).toBe(200);
    expect(mockDeleteBlob).not.toHaveBeenCalled();
  });

  it('old thumbnail was null: deletes nothing', async () => {
    mockThumbnailDb(null);
    const res = await handler(baseReq(thumbUpdate('thumbs/new.png')), {} as any);
    expect(res.status).toBe(200);
    expect(mockDeleteBlob).not.toHaveBeenCalled();
  });

  it('thumbnailUrl absent from updates is NOT a clear: no SELECT, no delete', async () => {
    mockQueryOne.mockResolvedValueOnce(fakeCourse); // single call — the UPDATE
    const res = await handler(baseReq({ courseId: 'c1', updates: { title: 'Renamed' } }), {} as any);
    expect(res.status).toBe(200);
    expect(mockQueryOne).toHaveBeenCalledTimes(1);
    expect(mockDeleteBlob).not.toHaveBeenCalled();
  });

  it('reads the previous thumbnail with a SELECT before the UPDATE', async () => {
    mockThumbnailDb('thumbs/old.png');
    await handler(baseReq(thumbUpdate('thumbs/new.png')), {} as any);

    expect(mockQueryOne).toHaveBeenCalledTimes(2);
    const [selectSql, selectParams] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(selectSql).toMatch(/SELECT thumbnail_url FROM courses/i);
    expect(selectParams).toEqual(['c1']);
    const [updateSql] = mockQueryOne.mock.calls[1] as [string, unknown[]];
    expect(updateSql).toContain('UPDATE courses');
  });

  it('404 (course vanished): deletes nothing', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ thumbnail_url: 'thumbs/old.png' })
      .mockResolvedValueOnce(null);
    const res = await handler(baseReq(thumbUpdate('thumbs/new.png')), {} as any);
    expect(res.status).toBe(404);
    expect(mockDeleteBlob).not.toHaveBeenCalled();
  });

  // --- Upload size/type enforcement (#276) ---

  it('413 when the new thumbnail is over cap: no UPDATE is issued', async () => {
    mockQueryOne.mockResolvedValueOnce({ thumbnail_url: null }); // only the previous-thumbnail SELECT
    mockEnforceUploadLimits.mockResolvedValueOnce('Image exceeds the maximum upload size of 10 MB');

    const res = await handler(baseReq(thumbUpdate('thumbs/huge.png')), {} as any);

    expect(res.status).toBe(413);
    expect(JSON.parse(res.body as string)).toEqual({
      error: 'Image exceeds the maximum upload size of 10 MB',
    });
    expect(mockQueryOne).toHaveBeenCalledTimes(1);
    expect(mockQueryOne.mock.calls[0][0]).not.toContain('UPDATE courses');
    // The refused blob's cleanup is the helper's job, not the endpoint's.
    expect(mockDeleteBlob).not.toHaveBeenCalled();
  });

  it('hands the thumbnail to the gate with the previous path, after the SELECT and before the UPDATE', async () => {
    const order: string[] = [];
    mockEnforceUploadLimits.mockImplementationOnce(async () => { order.push('gate'); return null; });
    mockQueryOne
      .mockImplementationOnce(async () => { order.push('select'); return { thumbnail_url: 'thumbs/old.png' }; })
      .mockImplementationOnce(async () => { order.push('update'); return fakeCourse; });

    const res = await handler(baseReq(thumbUpdate('thumbs/new.png')), {} as any);

    expect(res.status).toBe(200);
    expect(mockEnforceUploadLimits).toHaveBeenCalledWith(
      [{ path: 'thumbs/new.png', kind: 'image' }],
      ['thumbs/old.png'], // unchanged path ⇒ not new ⇒ never probed
    );
    expect(order).toEqual(['select', 'gate', 'update']);
  });

  it('thumbnailUrl absent from updates: the gate sees an undefined path, so nothing is probed', async () => {
    mockQueryOne.mockResolvedValueOnce(fakeCourse);
    const res = await handler(baseReq({ courseId: 'c1', updates: { title: 'Renamed' } }), {} as any);
    expect(res.status).toBe(200);
    expect(mockEnforceUploadLimits).toHaveBeenCalledWith(
      [{ path: undefined, kind: 'image' }],
      [null],
    );
  });

  it('deleteBlob returns false: request still succeeds with its normal body', async () => {
    mockThumbnailDb('thumbs/old.png');
    mockDeleteBlob.mockResolvedValue(false);
    const res = await handler(baseReq(thumbUpdate('thumbs/new.png')), {} as any);
    expect(res.status).toBe(200);
    // Cleanup outcome is deliberately NOT surfaced in the response.
    expect(JSON.parse(res.body as string)).toEqual({ course: fakeCourse });
  });

  it('storage fetch rejects (helper swallows it → false): request still succeeds', async () => {
    mockThumbnailDb('thumbs/old.png');
    mockDeleteBlob.mockResolvedValue(false); // deleteBlob never throws — a rejected fetch surfaces as false
    const res = await handler(baseReq(thumbUpdate('thumbs/new.png')), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ course: fakeCourse });
  });
});
