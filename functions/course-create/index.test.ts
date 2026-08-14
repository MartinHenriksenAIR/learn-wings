import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockAuthenticate, MockAuthError, mockQueryOne, mockGetProfile,
  mockEnforceUploadLimits, mockAssertBindablePaths,
} = vi.hoisted(() => {
  class MockAuthError extends Error {}
  return {
    mockAuthenticate: vi.fn(), MockAuthError,
    mockQueryOne: vi.fn(),
    mockGetProfile: vi.fn(),
    mockEnforceUploadLimits: vi.fn(),
    mockAssertBindablePaths: vi.fn(),
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
vi.mock('../shared/upload-limits', () => ({ enforceUploadLimits: mockEnforceUploadLimits }));
vi.mock('../shared/blob-ownership', () => ({ assertBindablePaths: mockAssertBindablePaths }));

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
  title: 'My Course',
  level: 'basic',
  language: 'da',
};

const fakeCourse = {
  id: 'c1',
  title: 'My Course',
  description: null,
  level: 'basic',
  language: 'da',
  is_published: false,
  thumbnail_url: null,
  created_by_user_id: 'admin-1',
};

describe('course-create', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ id: 'oid-1', tid: 'tid-1', email: 'u@x.com' });
    mockGetProfile.mockResolvedValue(adminProfile);
    mockEnforceUploadLimits.mockResolvedValue(null); // no upload-limit objection
    mockAssertBindablePaths.mockResolvedValue(null); // the path is the caller's to bind
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

  it('returns 400 when title is missing', async () => {
    const res = await handler(baseReq({ level: 'basic' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'title is required' });
  });

  it('returns 400 when title is empty string', async () => {
    const res = await handler(baseReq({ title: '   ', level: 'basic' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'title is required' });
  });

  it('returns 400 when title is not a string', async () => {
    const res = await handler(baseReq({ title: 123, level: 'basic' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'title is required' });
  });

  it('returns 400 when level is missing', async () => {
    const res = await handler(baseReq({ title: 'My Course' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'level must be basic, intermediate, or advanced' });
  });

  it('returns 400 when level is invalid', async () => {
    const res = await handler(baseReq({ title: 'My Course', level: 'expert' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'level must be basic, intermediate, or advanced' });
  });

  it('returns 400 when language is missing', async () => {
    const res = await handler(baseReq({ title: 'My Course', level: 'basic' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: "language must be 'en' or 'da'" });
  });

  it('returns 400 when language is invalid', async () => {
    const res = await handler(baseReq({ title: 'My Course', level: 'basic', language: 'fr' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: "language must be 'en' or 'da'" });
  });

  it('returns 400 when description is not a string or null', async () => {
    const res = await handler(baseReq({ ...validBody, description: 123 }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'description must be a string or null' });
  });

  it('allows description as explicit null (consistency with course-update)', async () => {
    mockQueryOne.mockResolvedValueOnce(fakeCourse);
    const res = await handler(baseReq({ ...validBody, description: null }), {} as any);
    expect(res.status).toBe(200);
    const [, params] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(params[1]).toBeNull(); // description stored as null
  });

  it('allows description as empty string', async () => {
    mockQueryOne.mockResolvedValueOnce({ ...fakeCourse, description: '' });
    const res = await handler(baseReq({ ...validBody, description: '' }), {} as any);
    expect(res.status).toBe(200);
  });

  it('returns 400 when thumbnailUrl is not a string or null', async () => {
    const res = await handler(baseReq({ ...validBody, thumbnailUrl: 123 }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'thumbnailUrl must be a string or null' });
  });

  it('allows thumbnailUrl as null', async () => {
    mockQueryOne.mockResolvedValueOnce(fakeCourse);
    const res = await handler(baseReq({ ...validBody, thumbnailUrl: null }), {} as any);
    expect(res.status).toBe(200);
  });

  it('returns 400 when categoryId is not a string or null', async () => {
    const res = await handler(baseReq({ ...validBody, categoryId: 123 }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'categoryId must be a string or null' });
  });

  it('returns 400 when categoryId does not exist', async () => {
    mockQueryOne.mockResolvedValueOnce(null); // existence lookup misses
    const res = await handler(baseReq({ ...validBody, categoryId: 'ghost' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'category not found' });
    expect(mockQueryOne).toHaveBeenCalledTimes(1);
    expect(mockQueryOne.mock.calls[0][0]).not.toContain('INSERT INTO courses');
  });

  it('allows a valid categoryId and stores it (existence checked first)', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ '?column?': 1 })                       // category exists
      .mockResolvedValueOnce({ ...fakeCourse, category_id: 'cat-1' }); // INSERT
    const res = await handler(baseReq({ ...validBody, categoryId: 'cat-1' }), {} as any);
    expect(res.status).toBe(200);

    const [existsSql, existsParams] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(existsSql).toMatch(/FROM course_categories WHERE id = \$1/i);
    expect(existsParams).toEqual(['cat-1']);

    const [insertSql, insertParams] = mockQueryOne.mock.calls[1] as [string, unknown[]];
    expect(insertSql).toContain('INSERT INTO courses');
    expect(insertSql).toContain('category_id');
    expect(insertParams[6]).toBe('cat-1'); // category_id value
  });

  it('allows categoryId as null (uncategorized) without an existence check', async () => {
    mockQueryOne.mockResolvedValueOnce({ ...fakeCourse, category_id: null }); // INSERT only
    const res = await handler(baseReq({ ...validBody, categoryId: null }), {} as any);
    expect(res.status).toBe(200);
    expect(mockQueryOne).toHaveBeenCalledTimes(1);
    const [, params] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(params[6]).toBeNull(); // category_id stored as null
  });

  it('happy path: creates course with required fields only', async () => {
    mockQueryOne.mockResolvedValueOnce(fakeCourse);
    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(body).toEqual({ course: fakeCourse });

    const [sql, params] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('INSERT INTO courses');
    expect(sql).toContain('language');
    expect(sql).toContain('RETURNING *');
    expect(params).toContain('admin-1');
    expect(sql).toContain('false');
    expect(params[1]).toBeNull();
    expect(params[3]).toBe('da');
    expect(params[4]).toBeNull();
  });

  it('happy path: creates course with all optional fields', async () => {
    const fullBody = { title: 'Full Course', level: 'advanced', language: 'en', description: 'Desc', thumbnailUrl: 'https://example.com/thumb.jpg' };
    const fullCourse = { id: 'c2', ...fullBody, is_published: false, created_by_user_id: 'admin-1' };
    mockQueryOne.mockResolvedValueOnce(fullCourse);
    const res = await handler(baseReq(fullBody), {} as any);
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(body).toEqual({ course: fullCourse });

    const [, params] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(params[0]).toBe('Full Course');
    expect(params[1]).toBe('Desc');
    expect(params[2]).toBe('advanced');
    expect(params[3]).toBe('en');
    expect(params[4]).toBe('https://example.com/thumb.jpg');
    expect(params[5]).toBe('admin-1');        // created_by_user_id (server-set from profile)
  });

  it('413 when the thumbnail is over cap: nothing is inserted', async () => {
    mockEnforceUploadLimits.mockResolvedValueOnce('Image exceeds the maximum upload size of 10 MB');

    const res = await handler(baseReq({ ...validBody, thumbnailUrl: 'thumbs/huge.png' }), {} as any);

    expect(res.status).toBe(413);
    expect(JSON.parse(res.body as string)).toEqual({
      error: 'Image exceeds the maximum upload size of 10 MB',
    });
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  it('hands the thumbnail to the gate under the image cap, before the INSERT', async () => {
    const order: string[] = [];
    mockEnforceUploadLimits.mockImplementationOnce(async () => { order.push('gate'); return null; });
    mockQueryOne.mockImplementationOnce(async () => { order.push('insert'); return fakeCourse; });

    const res = await handler(baseReq({ ...validBody, thumbnailUrl: 'thumbs/new.png' }), {} as any);

    expect(res.status).toBe(200);
    expect(mockEnforceUploadLimits).toHaveBeenCalledWith(thumbCandidate('thumbs/new.png'));
    expect(order).toEqual(['gate', 'insert']);
  });

  it('400 when the ownership gate refuses the path: nothing is probed or inserted', async () => {
    mockAssertBindablePaths.mockResolvedValueOnce('Invalid upload path');

    const res = await handler(
      baseReq({ ...validBody, thumbnailUrl: 'someone-elses-lesson.mp4' }),
      {} as any,
    );

    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Invalid upload path' });
    expect(mockEnforceUploadLimits).not.toHaveBeenCalled();
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  it('runs the ownership gate BEFORE the size gate, on the same candidate list', async () => {
    const order: string[] = [];
    mockAssertBindablePaths.mockImplementationOnce(async () => { order.push('ownership'); return null; });
    mockEnforceUploadLimits.mockImplementationOnce(async () => { order.push('limits'); return null; });
    mockQueryOne.mockResolvedValueOnce(fakeCourse);

    await handler(baseReq({ ...validBody, thumbnailUrl: 'thumbs/new.png' }), {} as any);

    expect(order).toEqual(['ownership', 'limits']);
    expect(mockAssertBindablePaths).toHaveBeenCalledWith(thumbCandidate('thumbs/new.png'));
    expect(mockAssertBindablePaths.mock.calls[0][0]).toEqual(mockEnforceUploadLimits.mock.calls[0][0]);
  });

  it('returns 500 on db error propagating err.message', async () => {
    mockQueryOne.mockRejectedValueOnce(new Error('db connection failed'));
    const res = await handler(baseReq(validBody), { error: vi.fn() } as any);
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Internal server error' });
  });
});
