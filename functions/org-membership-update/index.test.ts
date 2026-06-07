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

const existingMembership = { org_id: 'org-1' };

describe('org-membership-update', () => {
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
    const res = await handler(baseReq({ id: 'm1', role: 'learner' }), {} as any);
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Missing Bearer token' });
  });

  it('returns 401 when profile is not provisioned', async () => {
    mockGetProfile.mockResolvedValueOnce(null);
    const res = await handler(baseReq({ id: 'm1', role: 'learner' }), {} as any);
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Profile not found' });
  });

  it('returns 400 when id is missing', async () => {
    const res = await handler(baseReq({ role: 'learner' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'id is required' });
  });

  it('returns 400 when id is wrong type', async () => {
    const res = await handler(baseReq({ id: 42, role: 'learner' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'id is required' });
  });

  it('returns 400 when neither role nor status is supplied', async () => {
    const res = await handler(baseReq({ id: 'm1' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'No update fields provided' });
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  it('returns 400 when role is invalid', async () => {
    const res = await handler(baseReq({ id: 'm1', role: 'super_admin' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'role must be one of: org_admin, learner' });
  });

  it('returns 400 when status is invalid', async () => {
    const res = await handler(baseReq({ id: 'm1', status: 'pending' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'status must be one of: active, invited, disabled' });
  });

  it('returns 404 when membership does not exist (and does NOT issue the UPDATE)', async () => {
    mockQueryOne.mockResolvedValueOnce(null); // SELECT returns no row
    const res = await handler(baseReq({ id: 'm-missing', role: 'learner' }), {} as any);
    expect(res.status).toBe(404);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Membership not found' });
    expect(mockQueryOne).toHaveBeenCalledTimes(1);
    const [sql] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('SELECT org_id FROM org_memberships');
  });

  it('returns 403 when caller is neither platform admin nor org admin (and does NOT issue the UPDATE)', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: false });
    mockIsOrgAdmin.mockResolvedValueOnce(false);
    mockQueryOne.mockResolvedValueOnce(existingMembership); // SELECT returns row
    const res = await handler(baseReq({ id: 'm1', role: 'learner' }), {} as any);
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Forbidden' });
    expect(mockIsOrgAdmin).toHaveBeenCalledWith('p1', 'org-1');
    expect(mockQueryOne).toHaveBeenCalledTimes(1); // SELECT only, no UPDATE
  });

  it('happy path (platform admin): changes role and returns the membership', async () => {
    const updated = {
      id: 'm1',
      org_id: 'org-1',
      user_id: 'user-1',
      role: 'org_admin',
      status: 'active',
      created_at: '2026-06-07T12:00:00.000Z',
    };
    mockQueryOne.mockResolvedValueOnce(existingMembership); // SELECT
    mockQueryOne.mockResolvedValueOnce(updated); // UPDATE RETURNING

    const res = await handler(baseReq({ id: 'm1', role: 'org_admin' }), {} as any);

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ membership: updated });
    expect(mockIsOrgAdmin).not.toHaveBeenCalled(); // platform-admin bypass

    const [sql, params] = mockQueryOne.mock.calls[1] as [string, unknown[]];
    expect(sql).toContain('UPDATE org_memberships SET');
    expect(sql).toContain('role = $1');
    expect(sql).toContain('WHERE id = $2');
    expect(sql).toContain('RETURNING id, org_id, user_id, role, status, created_at');
    expect(params).toEqual(['org_admin', 'm1']);
  });

  it('happy path (org admin): authorizes via isOrgAdmin and changes status', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: false });
    mockIsOrgAdmin.mockResolvedValueOnce(true);
    const updated = {
      id: 'm2',
      org_id: 'org-1',
      user_id: 'user-1',
      role: 'learner',
      status: 'disabled',
      created_at: '2026-06-07T12:00:00.000Z',
    };
    mockQueryOne.mockResolvedValueOnce(existingMembership); // SELECT
    mockQueryOne.mockResolvedValueOnce(updated); // UPDATE RETURNING

    const res = await handler(baseReq({ id: 'm2', status: 'disabled' }), {} as any);

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ membership: updated });
    expect(mockIsOrgAdmin).toHaveBeenCalledWith('p1', 'org-1');

    const [sql, params] = mockQueryOne.mock.calls[1] as [string, unknown[]];
    expect(sql).toContain('status = $1');
    expect(sql).toContain('WHERE id = $2');
    expect(params).toEqual(['disabled', 'm2']);
  });

  it('happy path: role + status in one call builds SET clauses + params in submission order', async () => {
    const updated = {
      id: 'm1',
      org_id: 'org-1',
      user_id: 'user-1',
      role: 'org_admin',
      status: 'invited',
      created_at: '2026-06-07T12:00:00.000Z',
    };
    mockQueryOne.mockResolvedValueOnce(existingMembership); // SELECT
    mockQueryOne.mockResolvedValueOnce(updated); // UPDATE RETURNING

    const res = await handler(baseReq({ id: 'm1', role: 'org_admin', status: 'invited' }), {} as any);

    expect(res.status).toBe(200);

    const [sql, params] = mockQueryOne.mock.calls[1] as [string, unknown[]];
    expect(sql).toContain('role = $1');
    expect(sql).toContain('status = $2');
    expect(sql).toContain('WHERE id = $3');
    expect(params).toEqual(['org_admin', 'invited', 'm1']);
  });

  it('returns 500 on generic db error during UPDATE', async () => {
    mockQueryOne.mockResolvedValueOnce(existingMembership); // SELECT
    mockQueryOne.mockRejectedValueOnce(new Error('connection refused')); // UPDATE
    const res = await handler(baseReq({ id: 'm1', role: 'learner' }), {} as any);
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'connection refused' });
  });
});
