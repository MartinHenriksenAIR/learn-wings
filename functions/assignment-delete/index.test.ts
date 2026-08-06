import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuthenticate, MockAuthError, mockQueryOne, mockQuery, mockGetProfile, mockIsOrgAdmin } = vi.hoisted(() => {
  class MockAuthError extends Error {}
  return {
    mockAuthenticate: vi.fn(), MockAuthError,
    mockQueryOne: vi.fn(), mockQuery: vi.fn(),
    mockGetProfile: vi.fn(), mockIsOrgAdmin: vi.fn(),
  };
});
vi.mock('../shared/auth', () => ({ authenticate: mockAuthenticate, AuthError: MockAuthError }));
vi.mock('../shared/db', async (importOriginal) => ({ ...(await importOriginal<typeof import('../shared/db')>()), query: mockQuery, queryOne: mockQueryOne }));
vi.mock('../shared/profile', () => ({ getProfile: mockGetProfile, isActiveMember: vi.fn(), isOrgAdmin: mockIsOrgAdmin, isOrgAdminOfAny: vi.fn() }));

import handler from './index';

const baseReq = (body: unknown) => ({
  method: 'POST',
  headers: { get: (k: string) => (k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok') },
  json: async () => body,
}) as any;

const validBody = { assignmentId: 'a-1' };

describe('assignment-delete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ id: 'oid-1', tid: 'tid-1', email: 'u@x.com' });
    mockGetProfile.mockResolvedValue({ id: 'p1', is_platform_admin: true });
    mockIsOrgAdmin.mockResolvedValue(false);
  });

  it('handles OPTIONS preflight', async () => {
    const req = { method: 'OPTIONS', headers: { get: () => 'https://ai-uddannelse.dk' } } as any;
    expect((await handler(req, {} as any)).status).toBe(204);
  });

  it('returns 401 when token invalid', async () => {
    mockAuthenticate.mockRejectedValueOnce(new MockAuthError('Missing Bearer token'));
    expect((await handler(baseReq(validBody), {} as any)).status).toBe(401);
  });

  it('returns 401 when profile not provisioned', async () => {
    mockGetProfile.mockResolvedValueOnce(null);
    expect((await handler(baseReq(validBody), {} as any)).status).toBe(401);
  });

  it('returns 400 when assignmentId is missing', async () => {
    const res = await handler(baseReq({}), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'assignmentId is required' });
  });

  it('returns 404 when the assignment does not exist (before authz)', async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(404);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Assignment not found' });
    expect(mockIsOrgAdmin).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('returns 403 when caller is not admin of the assignment\'s org', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: false });
    mockIsOrgAdmin.mockResolvedValueOnce(false);
    mockQueryOne.mockResolvedValueOnce({ org_id: 'org-9' });
    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Forbidden' });
    expect(mockIsOrgAdmin).toHaveBeenCalledWith('p1', 'org-9');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('happy path (platform admin): loads org, deletes, returns deleted:true', async () => {
    mockQueryOne.mockResolvedValueOnce({ org_id: 'org-1' });
    mockQuery.mockResolvedValueOnce([]);
    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ deleted: true });
    const [delSql, delParams] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(delSql).toContain('DELETE FROM course_assignments');
    expect(delParams).toEqual(['a-1']);
  });

  it('happy path (org admin of the row\'s org)', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: false });
    mockIsOrgAdmin.mockResolvedValueOnce(true);
    mockQueryOne.mockResolvedValueOnce({ org_id: 'org-1' });
    mockQuery.mockResolvedValueOnce([]);
    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ deleted: true });
  });

  it('returns 500 on generic db error', async () => {
    mockQueryOne.mockRejectedValueOnce(new Error('connection refused'));
    const res = await handler(baseReq(validBody), { error: vi.fn() } as any);
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Internal server error' });
  });
});
