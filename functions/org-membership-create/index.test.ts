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

const validBody = { orgId: 'org-1', userId: 'user-1', role: 'learner' };

describe('org-membership-create', () => {
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
    const res = await handler(baseReq({ userId: 'user-1', role: 'learner' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'orgId is required' });
  });

  it('returns 400 when orgId is wrong type', async () => {
    const res = await handler(baseReq({ orgId: 42, userId: 'user-1', role: 'learner' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'orgId is required' });
  });

  it('returns 400 when userId is missing', async () => {
    const res = await handler(baseReq({ orgId: 'org-1', role: 'learner' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'userId is required' });
  });

  it('returns 400 when userId is wrong type', async () => {
    const res = await handler(baseReq({ orgId: 'org-1', userId: 99, role: 'learner' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'userId is required' });
  });

  it('returns 400 when role is invalid', async () => {
    const res = await handler(baseReq({ orgId: 'org-1', userId: 'user-1', role: 'super_admin' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'role must be one of: org_admin, learner' });
  });

  it('returns 400 when role is missing', async () => {
    const res = await handler(baseReq({ orgId: 'org-1', userId: 'user-1' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'role must be one of: org_admin, learner' });
  });

  it('returns 400 when status (when provided) is invalid', async () => {
    const res = await handler(baseReq({ ...validBody, status: 'pending' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'status must be one of: active, invited, disabled' });
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

  it('happy path (platform admin): defaults status to active and returns membership', async () => {
    const inserted = {
      id: 'm1',
      org_id: 'org-1',
      user_id: 'user-1',
      role: 'learner',
      status: 'active',
      created_at: '2026-06-07T12:00:00.000Z',
    };
    mockQueryOne.mockResolvedValueOnce(inserted);

    const res = await handler(baseReq(validBody), {} as any);

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ membership: inserted });
    expect(mockIsOrgAdmin).not.toHaveBeenCalled(); // platform-admin bypass

    const [sql, params] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('INSERT INTO org_memberships');
    expect(sql).toContain('RETURNING id, org_id, user_id, role, status, created_at');
    expect(params).toEqual(['org-1', 'user-1', 'learner', 'active']);
  });

  it('happy path (org admin): authorizes via isOrgAdmin and inserts with provided status', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: false });
    mockIsOrgAdmin.mockResolvedValueOnce(true);
    const inserted = {
      id: 'm2',
      org_id: 'org-1',
      user_id: 'user-1',
      role: 'org_admin',
      status: 'invited',
      created_at: '2026-06-07T12:00:00.000Z',
    };
    mockQueryOne.mockResolvedValueOnce(inserted);

    const res = await handler(
      baseReq({ orgId: 'org-1', userId: 'user-1', role: 'org_admin', status: 'invited' }),
      {} as any,
    );

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ membership: inserted });
    expect(mockIsOrgAdmin).toHaveBeenCalledWith('p1', 'org-1');

    const [, params] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual(['org-1', 'user-1', 'org_admin', 'invited']);
  });

  it('returns 409 on duplicate (org_id, user_id) unique violation (23505)', async () => {
    mockQueryOne.mockRejectedValueOnce(Object.assign(new Error('duplicate key value'), { code: '23505' }));
    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(409);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'User is already a member of this organization' });
  });

  it('returns 404 on foreign-key violation (23503)', async () => {
    mockQueryOne.mockRejectedValueOnce(Object.assign(new Error('insert violates fk'), { code: '23503' }));
    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(404);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Organization or user not found' });
  });

  it('returns 500 on generic db error', async () => {
    mockQueryOne.mockRejectedValueOnce(new Error('connection refused'));
    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'connection refused' });
  });
});
