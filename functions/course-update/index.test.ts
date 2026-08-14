import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockAuthenticate, MockAuthError, mockQueryOne, mockGetProfile, mockDeleteBlob,
  mockEnforceUploadLimits, mockAssertBindablePaths, mockIsBlobReleasable,
} = vi.hoisted(() => {
  class MockAuthError extends Error {}
  return {
    mockAuthenticate: vi.fn(), MockAuthError,
    mockQueryOne: vi.fn(),
    mockGetProfile: vi.fn(),
    mockDeleteBlob: vi.fn(),
    mockEnforceUploadLimits: vi.fn(),
    mockAssertBindablePaths: vi.fn(),
    mockIsBlobReleasable: vi.fn(),
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
vi.mock('../shared/blob-ownership', () => ({
  assertBindablePaths: mockAssertBindablePaths,
  isBlobReleasable: mockIsBlobReleasable,
}));

import handler from './index';

const thumbCandidate = (path: string | null | undefined) => [{ path, kind: 'image', family: 'lms' }];

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
    mockAssertBindablePaths.mockResolvedValue(null); // the path is the caller's to bind
    mockIsBlobReleasable.mockResolvedValue(true);    // nothing else references the old blob
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

  it('returns 400 when categoryId is not a string or null', async () => {
    const res = await handler(baseReq({ courseId: 'c1', updates: { categoryId: 123 } }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'categoryId must be a string or null' });
  });

  it('returns 400 when categoryId does not exist (no UPDATE issued)', async () => {
    mockQueryOne.mockResolvedValueOnce(null); // existence lookup misses
    const res = await handler(baseReq({ courseId: 'c1', updates: { categoryId: 'ghost' } }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'category not found' });
    expect(mockQueryOne).toHaveBeenCalledTimes(1);
    expect(mockQueryOne.mock.calls[0][0]).not.toContain('UPDATE courses');
  });

  it('allows a valid categoryId and sets category_id (existence checked first)', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ '?column?': 1 })                        // category exists
      .mockResolvedValueOnce({ ...fakeCourse, category_id: 'cat-1' }); // UPDATE
    const res = await handler(baseReq({ courseId: 'c1', updates: { categoryId: 'cat-1' } }), {} as any);
    expect(res.status).toBe(200);

    const [existsSql, existsParams] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(existsSql).toMatch(/FROM course_categories WHERE id = \$1/i);
    expect(existsParams).toEqual(['cat-1']);

    const [updateSql, updateParams] = mockQueryOne.mock.calls[1] as [string, unknown[]];
    expect(updateSql).toContain('UPDATE courses');
    expect(updateSql).toContain('category_id');
    expect(updateParams[0]).toBe('cat-1');                     // first (only) SET param
    expect(updateParams[updateParams.length - 1]).toBe('c1');  // WHERE id = $n
  });

  it('allows categoryId as null (clears the category) without an existence check', async () => {
    mockQueryOne.mockResolvedValueOnce({ ...fakeCourse, category_id: null }); // UPDATE only
    const res = await handler(baseReq({ courseId: 'c1', updates: { categoryId: null } }), {} as any);
    expect(res.status).toBe(200);
    expect(mockQueryOne).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('UPDATE courses');
    expect(sql).toContain('category_id');
    expect(params[0]).toBeNull();                 // category_id set to null
    expect(params[params.length - 1]).toBe('c1'); // WHERE id = $n
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
    mockQueryOne.mockResolvedValueOnce(fakeCourse);
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

  it('413 when the new thumbnail is over cap: no UPDATE is issued', async () => {
    mockQueryOne.mockResolvedValueOnce({ thumbnail_url: null });
    mockEnforceUploadLimits.mockResolvedValueOnce('Image exceeds the maximum upload size of 10 MB');

    const res = await handler(baseReq(thumbUpdate('thumbs/huge.png')), {} as any);

    expect(res.status).toBe(413);
    expect(JSON.parse(res.body as string)).toEqual({
      error: 'Image exceeds the maximum upload size of 10 MB',
    });
    expect(mockQueryOne).toHaveBeenCalledTimes(1);
    expect(mockQueryOne.mock.calls[0][0]).not.toContain('UPDATE courses');
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
      thumbCandidate('thumbs/new.png'),
      ['thumbs/old.png'], // unchanged path ⇒ not new ⇒ never probed
    );
    expect(order).toEqual(['select', 'gate', 'update']);
  });

  it('thumbnailUrl absent from updates: the gate sees an undefined path, so nothing is probed', async () => {
    mockQueryOne.mockResolvedValueOnce(fakeCourse);
    const res = await handler(baseReq({ courseId: 'c1', updates: { title: 'Renamed' } }), {} as any);
    expect(res.status).toBe(200);
    expect(mockEnforceUploadLimits).toHaveBeenCalledWith(
      thumbCandidate(undefined),
      [null],
    );
  });


  it('400 when the ownership gate refuses the path: no probe, no UPDATE, no delete', async () => {
    mockQueryOne.mockResolvedValueOnce({ thumbnail_url: null });
    mockAssertBindablePaths.mockResolvedValueOnce('Invalid upload path');

    const res = await handler(baseReq(thumbUpdate('someone-elses-lesson.mp4')), {} as any);

    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Invalid upload path' });
    expect(mockEnforceUploadLimits).not.toHaveBeenCalled();
    expect(mockDeleteBlob).not.toHaveBeenCalled();
    expect(mockQueryOne).toHaveBeenCalledTimes(1);
    expect(mockQueryOne.mock.calls[0][0]).not.toContain('UPDATE courses');
  });

  it('runs the ownership gate BEFORE the size gate, on the same candidate list', async () => {
    const order: string[] = [];
    mockAssertBindablePaths.mockImplementationOnce(async () => { order.push('ownership'); return null; });
    mockEnforceUploadLimits.mockImplementationOnce(async () => { order.push('limits'); return null; });
    mockThumbnailDb('thumbs/old.png');

    await handler(baseReq(thumbUpdate('thumbs/new.png')), {} as any);

    expect(order).toEqual(['ownership', 'limits']);
    expect(mockAssertBindablePaths).toHaveBeenCalledWith(
      thumbCandidate('thumbs/new.png'),
      ['thumbs/old.png'],
    );
    expect(mockAssertBindablePaths.mock.calls[0][0]).toEqual(mockEnforceUploadLimits.mock.calls[0][0]);
  });

  it('a superseded thumbnail another row still references is NOT deleted', async () => {
    mockIsBlobReleasable.mockResolvedValueOnce(false);
    mockThumbnailDb('shared.png');

    const res = await handler(baseReq(thumbUpdate('thumbs/new.png')), {} as any);

    expect(res.status).toBe(200);
    expect(mockIsBlobReleasable).toHaveBeenCalledWith('shared.png', 'lms');
    expect(mockDeleteBlob).not.toHaveBeenCalled();
  });

  it('asks whether the old blob is releasable only AFTER the row write', async () => {
    const order: string[] = [];
    mockQueryOne
      .mockImplementationOnce(async () => ({ thumbnail_url: 'thumbs/old.png' }))
      .mockImplementationOnce(async () => { order.push('update'); return fakeCourse; });
    mockIsBlobReleasable.mockImplementationOnce(async () => { order.push('releasable'); return true; });
    mockDeleteBlob.mockImplementationOnce(async () => { order.push('delete'); return true; });

    await handler(baseReq(thumbUpdate('thumbs/new.png')), {} as any);

    expect(order).toEqual(['update', 'releasable', 'delete']);
  });

  it('deleteBlob returns false: request still succeeds with its normal body', async () => {
    mockThumbnailDb('thumbs/old.png');
    mockDeleteBlob.mockResolvedValue(false);
    const res = await handler(baseReq(thumbUpdate('thumbs/new.png')), {} as any);
    expect(res.status).toBe(200);
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
