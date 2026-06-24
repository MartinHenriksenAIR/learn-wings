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

const validBody = { courseId: 'course-1', title: 'Module 1' };
const fakeModule = { id: 'mod-1', course_id: 'course-1', title: 'Module 1', sort_order: 0 };

describe('module-create', () => {
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
    const res = await handler(baseReq({ title: 'M' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'courseId is required' });
  });

  it('returns 400 when courseId is empty string', async () => {
    const res = await handler(baseReq({ ...validBody, courseId: '' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'courseId is required' });
  });

  it('returns 400 when courseId is not a string', async () => {
    const res = await handler(baseReq({ ...validBody, courseId: 42 }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'courseId is required' });
  });

  it('returns 400 when title is missing', async () => {
    const res = await handler(baseReq({ courseId: 'course-1' }), {} as any);
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

  it('happy path: inserts module with server-computed sort_order and returns it', async () => {
    mockQueryOne.mockResolvedValueOnce(fakeModule);
    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ module: fakeModule });

    const [sql, params] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('INSERT INTO course_modules');
    expect(sql).toContain('RETURNING *');
    // sort_order is server-owned: MAX+1 within the course, computed in the INSERT
    expect(sql).toContain('COALESCE(MAX(sort_order) + 1, 0)');
    expect(sql).toContain('WHERE course_id = $1');
    expect(params).toEqual(['course-1', 'Module 1']); // no client sort_order param
  });

  it('ignores client-supplied sortOrder entirely', async () => {
    mockQueryOne.mockResolvedValueOnce(fakeModule);
    const res = await handler(baseReq({ ...validBody, sortOrder: 999 }), {} as any);
    expect(res.status).toBe(200);

    const [sql, params] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual(['course-1', 'Module 1']);
    expect(params).not.toContain(999);
    expect(sql).toContain('COALESCE(MAX(sort_order) + 1, 0)');
  });

  it('no longer rejects a non-integer sortOrder — the field is ignored, not validated', async () => {
    mockQueryOne.mockResolvedValueOnce(fakeModule);
    const res = await handler(baseReq({ ...validBody, sortOrder: 'not-a-number' }), {} as any);
    expect(res.status).toBe(200);
    const [, params] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual(['course-1', 'Module 1']);
  });

  it('no longer requires sortOrder in the body', async () => {
    mockQueryOne.mockResolvedValueOnce(fakeModule);
    const res = await handler(baseReq({ courseId: 'course-1', title: 'Module 1' }), {} as any);
    expect(res.status).toBe(200);
  });

  it('returns 500 on db error propagating err.message', async () => {
    mockQueryOne.mockRejectedValueOnce(new Error('FK violation'));
    const res = await handler(baseReq(validBody), { error: vi.fn() } as any);
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Internal server error' });
  });
});
