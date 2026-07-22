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
  courseId: 'c1',
  updates: { title: 'Updated Title' },
};

const fakeCourse = {
  id: 'c1',
  title: 'Updated Title',
  level: 'basic',
  is_published: false,
};

describe('course-update', () => {
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
    mockQueryOne.mockResolvedValueOnce(fakeCourse);
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
});
