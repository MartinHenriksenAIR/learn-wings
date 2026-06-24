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
  title: 'My Course',
  level: 'basic',
};

const fakeCourse = {
  id: 'c1',
  title: 'My Course',
  description: null,
  level: 'basic',
  is_published: false,
  thumbnail_url: null,
  created_by_user_id: 'admin-1',
};

describe('course-create', () => {
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

  it('happy path: creates course with required fields only', async () => {
    mockQueryOne.mockResolvedValueOnce(fakeCourse);
    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(body).toEqual({ course: fakeCourse });

    // Verify SQL and params
    const [sql, params] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('INSERT INTO courses');
    expect(sql).toContain('RETURNING *');
    // created_by_user_id must be server-set from profile, not client
    expect(params).toContain('admin-1'); // profile.id
    // is_published must be false (hardcoded)
    expect(sql).toContain('false');
    // description and thumbnailUrl default to null
    expect(params[1]).toBeNull(); // description
    expect(params[3]).toBeNull(); // thumbnailUrl
  });

  it('happy path: creates course with all optional fields', async () => {
    const fullBody = { title: 'Full Course', level: 'advanced', description: 'Desc', thumbnailUrl: 'https://example.com/thumb.jpg' };
    const fullCourse = { id: 'c2', ...fullBody, is_published: false, created_by_user_id: 'admin-1' };
    mockQueryOne.mockResolvedValueOnce(fullCourse);
    const res = await handler(baseReq(fullBody), {} as any);
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(body).toEqual({ course: fullCourse });

    const [, params] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(params[0]).toBe('Full Course');    // title
    expect(params[1]).toBe('Desc');           // description
    expect(params[2]).toBe('advanced');       // level
    expect(params[3]).toBe('https://example.com/thumb.jpg'); // thumbnail_url
    expect(params[4]).toBe('admin-1');        // created_by_user_id (server-set from profile)
  });

  it('returns 500 on db error propagating err.message', async () => {
    mockQueryOne.mockRejectedValueOnce(new Error('db connection failed'));
    const res = await handler(baseReq(validBody), { error: vi.fn() } as any);
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Internal server error' });
  });
});
