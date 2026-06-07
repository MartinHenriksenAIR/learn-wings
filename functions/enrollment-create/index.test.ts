import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuthenticate, MockAuthError, mockQueryOne, mockGetProfile, mockIsOrgAdmin } = vi.hoisted(() => {
  class MockAuthError extends Error {}
  return {
    mockAuthenticate: vi.fn(), MockAuthError,
    mockQueryOne: vi.fn(),
    mockGetProfile: vi.fn(), mockIsOrgAdmin: vi.fn(),
  };
});
vi.mock('../shared/auth', () => ({ authenticate: mockAuthenticate, AuthError: MockAuthError }));
vi.mock('../shared/db', () => ({ query: vi.fn(), queryOne: mockQueryOne }));
vi.mock('../shared/profile', () => ({ getProfile: mockGetProfile, isActiveMember: vi.fn(), isOrgAdmin: mockIsOrgAdmin, isOrgAdminOfAny: vi.fn() }));

import handler from './index';

const baseReq = (body: unknown) => ({
  method: 'POST',
  headers: { get: (k: string) => (k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok') },
  json: async () => body,
}) as any;

const validBody = { orgId: 'org-1', userId: 'user-1', courseId: 'course-1' };

describe('enrollment-create', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ id: 'oid-1', tid: 'tid-1', email: 'u@x.com' });
    mockGetProfile.mockResolvedValue({ id: 'p1', is_platform_admin: true });
    mockIsOrgAdmin.mockResolvedValue(false);
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

  it('returns 400 when orgId is missing', async () => {
    const res = await handler(baseReq({ userId: 'user-1', courseId: 'course-1' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'orgId is required' });
  });

  it('returns 400 when orgId is wrong type', async () => {
    const res = await handler(baseReq({ orgId: 42, userId: 'user-1', courseId: 'course-1' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'orgId is required' });
  });

  it('returns 400 when userId is missing', async () => {
    const res = await handler(baseReq({ orgId: 'org-1', courseId: 'course-1' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'userId is required' });
  });

  it('returns 400 when userId is wrong type', async () => {
    const res = await handler(baseReq({ orgId: 'org-1', userId: 99, courseId: 'course-1' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'userId is required' });
  });

  it('returns 400 when courseId is missing', async () => {
    const res = await handler(baseReq({ orgId: 'org-1', userId: 'user-1' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'courseId is required' });
  });

  it('returns 400 when courseId is wrong type', async () => {
    const res = await handler(baseReq({ orgId: 'org-1', userId: 'user-1', courseId: 7 }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'courseId is required' });
  });

  it('returns 400 when status (when provided) is invalid', async () => {
    const res = await handler(baseReq({ ...validBody, status: 'pending' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'status must be one of: enrolled, completed' });
  });

  it('returns 403 when caller is neither platform admin nor org admin', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: false });
    mockIsOrgAdmin.mockResolvedValueOnce(false);
    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Forbidden' });
    expect(mockIsOrgAdmin).toHaveBeenCalledWith('p1', 'org-1');
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  it('returns 404 when course does not exist (no access or insert query runs)', async () => {
    // platform admin path — skips org_course_access entirely. Course lookup returns null.
    mockQueryOne.mockResolvedValueOnce(null);
    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(404);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Course not found' });
    expect(mockQueryOne).toHaveBeenCalledTimes(1);
    const [sql] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('SELECT is_published FROM courses');
  });

  it('returns 400 when course is not published (subsequent queries do not run)', async () => {
    mockQueryOne.mockResolvedValueOnce({ is_published: false });
    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Course is not published' });
    expect(mockQueryOne).toHaveBeenCalledTimes(1);
  });

  it('returns 403 (org admin path) when org has no access to course; INSERT does not run', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: false });
    mockIsOrgAdmin.mockResolvedValueOnce(true);
    mockQueryOne
      .mockResolvedValueOnce({ is_published: true }) // course lookup
      .mockResolvedValueOnce(null);                  // org_course_access lookup
    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Organization does not have access to this course' });
    expect(mockQueryOne).toHaveBeenCalledTimes(2);
    const [sql2] = mockQueryOne.mock.calls[1] as [string, unknown[]];
    expect(sql2).toContain('org_course_access');
  });

  it('happy path (platform admin): skips org_course_access; defaults status to enrolled', async () => {
    const inserted = {
      id: 'e1',
      org_id: 'org-1',
      user_id: 'user-1',
      course_id: 'course-1',
      status: 'enrolled',
      enrolled_at: '2026-06-07T12:00:00.000Z',
      completed_at: null,
    };
    mockQueryOne
      .mockResolvedValueOnce({ is_published: true }) // course lookup
      .mockResolvedValueOnce(inserted);              // INSERT

    const res = await handler(baseReq(validBody), {} as any);

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ enrollment: inserted });
    expect(mockIsOrgAdmin).not.toHaveBeenCalled();   // platform-admin bypass
    expect(mockQueryOne).toHaveBeenCalledTimes(2);   // course lookup + INSERT (no access check)

    const [sql, params] = mockQueryOne.mock.calls[1] as [string, unknown[]];
    expect(sql).toContain('INSERT INTO enrollments');
    expect(sql).toContain('RETURNING id, org_id, user_id, course_id, status, enrolled_at, completed_at');
    expect(params).toEqual(['org-1', 'user-1', 'course-1', 'enrolled']);
  });

  it('happy path (org admin): runs all three lookups and returns enrollment', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: false });
    mockIsOrgAdmin.mockResolvedValueOnce(true);
    const inserted = {
      id: 'e2',
      org_id: 'org-1',
      user_id: 'user-1',
      course_id: 'course-1',
      status: 'enrolled',
      enrolled_at: '2026-06-07T12:00:00.000Z',
      completed_at: null,
    };
    mockQueryOne
      .mockResolvedValueOnce({ is_published: true }) // course lookup
      .mockResolvedValueOnce({ exists: 1 })          // org_course_access lookup
      .mockResolvedValueOnce(inserted);              // INSERT

    const res = await handler(baseReq(validBody), {} as any);

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ enrollment: inserted });
    expect(mockIsOrgAdmin).toHaveBeenCalledWith('p1', 'org-1');
    expect(mockQueryOne).toHaveBeenCalledTimes(3);

    const [, insertParams] = mockQueryOne.mock.calls[2] as [string, unknown[]];
    expect(insertParams).toEqual(['org-1', 'user-1', 'course-1', 'enrolled']);
  });

  it('honors explicit status=completed', async () => {
    const inserted = {
      id: 'e3',
      org_id: 'org-1',
      user_id: 'user-1',
      course_id: 'course-1',
      status: 'completed',
      enrolled_at: '2026-06-07T12:00:00.000Z',
      completed_at: '2026-06-07T12:00:00.000Z',
    };
    mockQueryOne
      .mockResolvedValueOnce({ is_published: true })
      .mockResolvedValueOnce(inserted);

    const res = await handler(baseReq({ ...validBody, status: 'completed' }), {} as any);

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ enrollment: inserted });
    const [, params] = mockQueryOne.mock.calls[1] as [string, unknown[]];
    expect(params).toEqual(['org-1', 'user-1', 'course-1', 'completed']);
  });

  it('returns 409 on duplicate (org_id, user_id, course_id) unique violation (23505)', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ is_published: true })
      .mockRejectedValueOnce(Object.assign(new Error('duplicate key value'), { code: '23505' }));
    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(409);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'User is already enrolled in this course' });
  });

  it('returns 404 on foreign-key violation (23503)', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ is_published: true })
      .mockRejectedValueOnce(Object.assign(new Error('insert violates fk'), { code: '23503' }));
    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(404);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'User or course not found' });
  });

  it('returns 500 on generic db error', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ is_published: true })
      .mockRejectedValueOnce(new Error('connection refused'));
    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'connection refused' });
  });
});
