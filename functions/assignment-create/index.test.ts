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
vi.mock('../shared/db', async (importOriginal) => ({ ...(await importOriginal<typeof import('../shared/db')>()), query: vi.fn(), queryOne: mockQueryOne }));
vi.mock('../shared/profile', () => ({ getProfile: mockGetProfile, isActiveMember: vi.fn(), isOrgAdmin: mockIsOrgAdmin, isOrgAdminOfAny: vi.fn() }));

import handler from './index';

const baseReq = (body: unknown) => ({
  method: 'POST',
  headers: { get: (k: string) => (k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok') },
  json: async () => body,
}) as any;

// whole-org by default (no userId)
const orgBody = { orgId: 'org-1', courseId: 'course-1' };
const individualBody = { orgId: 'org-1', courseId: 'course-1', userId: 'user-1' };

describe('assignment-create', () => {
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
    const res = await handler(baseReq(orgBody), {} as any);
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Missing Bearer token' });
  });

  it('returns 401 when profile is not provisioned', async () => {
    mockGetProfile.mockResolvedValueOnce(null);
    const res = await handler(baseReq(orgBody), {} as any);
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Profile not found' });
  });

  it('returns 400 when orgId is missing', async () => {
    const res = await handler(baseReq({ courseId: 'course-1' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'orgId is required' });
  });

  it('returns 400 when courseId is missing', async () => {
    const res = await handler(baseReq({ orgId: 'org-1' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'courseId is required' });
  });

  it('returns 400 when userId is wrong type', async () => {
    const res = await handler(baseReq({ ...orgBody, userId: 42 }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'userId must be a string' });
  });

  it('returns 400 when mandatory is wrong type', async () => {
    const res = await handler(baseReq({ ...orgBody, mandatory: 'yes' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'mandatory must be a boolean' });
  });

  it('returns 400 when dueDate is not an ISO date', async () => {
    const res = await handler(baseReq({ ...orgBody, dueDate: 'next tuesday' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'dueDate must be an ISO date (YYYY-MM-DD)' });
  });

  it('returns 400 for a regex-valid but impossible date (no 500 from the INSERT)', async () => {
    const res = await handler(baseReq({ ...orgBody, dueDate: '2026-13-45' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'dueDate must be an ISO date (YYYY-MM-DD)' });
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  it('returns 403 when caller is neither platform admin nor org admin', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: false });
    mockIsOrgAdmin.mockResolvedValueOnce(false);
    const res = await handler(baseReq(orgBody), {} as any);
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Forbidden' });
    expect(mockIsOrgAdmin).toHaveBeenCalledWith('p1', 'org-1');
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  it('returns 404 when course does not exist', async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    const res = await handler(baseReq(orgBody), {} as any);
    expect(res.status).toBe(404);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Course not found' });
    const [sql] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('SELECT is_published FROM courses');
  });

  it('returns 400 when course is not published', async () => {
    mockQueryOne.mockResolvedValueOnce({ is_published: false });
    const res = await handler(baseReq(orgBody), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Course is not published' });
    expect(mockQueryOne).toHaveBeenCalledTimes(1);
  });

  it('returns 403 (org admin path) when org has no access to the course', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: false });
    mockIsOrgAdmin.mockResolvedValueOnce(true);
    mockQueryOne
      .mockResolvedValueOnce({ is_published: true }) // course lookup
      .mockResolvedValueOnce({ ok: false });         // org_course_access lookup
    const res = await handler(baseReq(orgBody), {} as any);
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Organization does not have access to this course' });
    const [sql2] = mockQueryOne.mock.calls[1] as [string, unknown[]];
    expect(sql2).toContain('org_course_access');
  });

  it('returns 400 when the individual target is not an active member of the org', async () => {
    // platform admin (skips access check); member check returns ok:false
    mockQueryOne
      .mockResolvedValueOnce({ is_published: true }) // course lookup
      .mockResolvedValueOnce({ ok: false });         // membership check
    const res = await handler(baseReq(individualBody), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'User is not an active member of this organization' });
    const [sqlMember] = mockQueryOne.mock.calls[1] as [string, unknown[]];
    expect(sqlMember).toContain('org_memberships');
    expect(mockQueryOne).toHaveBeenCalledTimes(2); // no INSERT
  });

  it('happy path whole-org (platform admin): defaults mandatory=true, user_id null, no membership check', async () => {
    const inserted = {
      id: 'a1', org_id: 'org-1', user_id: null, course_id: 'course-1',
      mandatory: true, due_date: null, assigned_by_user_id: 'p1', created_at: '2026-08-05T12:00:00.000Z',
    };
    mockQueryOne
      .mockResolvedValueOnce({ is_published: true }) // course lookup
      .mockResolvedValueOnce(inserted);              // INSERT
    const res = await handler(baseReq(orgBody), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ assignment: inserted });
    expect(mockQueryOne).toHaveBeenCalledTimes(2); // course + INSERT (no access, no membership)
    const [sql, params] = mockQueryOne.mock.calls[1] as [string, unknown[]];
    expect(sql).toContain('INSERT INTO course_assignments');
    expect(params).toEqual(['org-1', null, 'course-1', true, null, 'p1']);
  });

  it('happy path individual (org admin): runs course + access + membership + INSERT', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: false });
    mockIsOrgAdmin.mockResolvedValueOnce(true);
    const inserted = {
      id: 'a2', org_id: 'org-1', user_id: 'user-1', course_id: 'course-1',
      mandatory: false, due_date: '2026-09-01', assigned_by_user_id: 'p1', created_at: '2026-08-05T12:00:00.000Z',
    };
    mockQueryOne
      .mockResolvedValueOnce({ is_published: true }) // course lookup
      .mockResolvedValueOnce({ ok: true })           // org access
      .mockResolvedValueOnce({ ok: true })           // membership check
      .mockResolvedValueOnce(inserted);              // INSERT
    const res = await handler(baseReq({ ...individualBody, mandatory: false, dueDate: '2026-09-01' }), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ assignment: inserted });
    expect(mockQueryOne).toHaveBeenCalledTimes(4);
    const [, params] = mockQueryOne.mock.calls[3] as [string, unknown[]];
    expect(params).toEqual(['org-1', 'user-1', 'course-1', false, '2026-09-01', 'p1']);
  });

  it('returns 409 on unique violation (23505)', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ is_published: true })
      .mockRejectedValueOnce(Object.assign(new Error('duplicate key value'), { code: '23505' }));
    const res = await handler(baseReq(orgBody), {} as any);
    expect(res.status).toBe(409);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'This course is already assigned' });
  });

  it('returns 404 on foreign-key violation (23503)', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ is_published: true })
      .mockRejectedValueOnce(Object.assign(new Error('insert violates fk'), { code: '23503' }));
    const res = await handler(baseReq(orgBody), {} as any);
    expect(res.status).toBe(404);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'User or course not found' });
  });

  it('returns 500 on generic db error', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ is_published: true })
      .mockRejectedValueOnce(new Error('connection refused'));
    const res = await handler(baseReq(orgBody), { error: vi.fn() } as any);
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Internal server error' });
  });
});
