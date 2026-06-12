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

const validBody = { orgId: 'org-1', userId: 'user-1', role: 'learner' };

// First queryOne call is the seat-limit lookup (org row + active-member count).
const seatRow = (seat_limit: number | null, active_count: number) => ({ seat_limit, active_count });

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
    expect(JSON.parse(res.body as string)).toEqual({ error: 'status must be one of: active, disabled' });
  });

  it('returns 400 when status is invited — invitation flow is the only entry to that state', async () => {
    const res = await handler(baseReq({ ...validBody, status: 'invited' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'status must be one of: active, disabled' });
    expect(mockQueryOne).not.toHaveBeenCalled();
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
    mockQueryOne.mockResolvedValueOnce(seatRow(null, 5)); // seat_limit null — never blocks
    mockQueryOne.mockResolvedValueOnce(inserted);

    const res = await handler(baseReq(validBody), {} as any);

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ membership: inserted });
    expect(mockIsOrgAdmin).not.toHaveBeenCalled(); // platform-admin bypass

    // First query: seat-limit lookup counts ACTIVE members only (disabled don't count)
    const [seatSql, seatParams] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(seatSql).toContain('seat_limit');
    expect(seatSql).toContain(`m.status = 'active'`);
    expect(seatParams).toEqual(['org-1']);

    const [sql, params] = mockQueryOne.mock.calls[1] as [string, unknown[]];
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
      status: 'disabled',
      created_at: '2026-06-07T12:00:00.000Z',
    };
    mockQueryOne.mockResolvedValueOnce(seatRow(null, 0));
    mockQueryOne.mockResolvedValueOnce(inserted);

    const res = await handler(
      baseReq({ orgId: 'org-1', userId: 'user-1', role: 'org_admin', status: 'disabled' }),
      {} as any,
    );

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ membership: inserted });
    expect(mockIsOrgAdmin).toHaveBeenCalledWith('p1', 'org-1');

    const [, params] = mockQueryOne.mock.calls[1] as [string, unknown[]];
    expect(params).toEqual(['org-1', 'user-1', 'org_admin', 'disabled']);
  });

  it('returns 409 SEAT_LIMIT_REACHED when active members are at the seat limit', async () => {
    mockQueryOne.mockResolvedValueOnce(seatRow(5, 5));

    const res = await handler(baseReq(validBody), {} as any);

    expect(res.status).toBe(409);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Organization is at seat limit', code: 'SEAT_LIMIT_REACHED' });
    expect(mockQueryOne).toHaveBeenCalledTimes(1); // no INSERT attempted
  });

  it('returns 409 SEAT_LIMIT_REACHED when active members exceed the seat limit', async () => {
    mockQueryOne.mockResolvedValueOnce(seatRow(5, 7));

    const res = await handler(baseReq(validBody), {} as any);

    expect(res.status).toBe(409);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Organization is at seat limit', code: 'SEAT_LIMIT_REACHED' });
    expect(mockQueryOne).toHaveBeenCalledTimes(1);
  });

  it('allows creation when active members are below the seat limit', async () => {
    const inserted = { id: 'm3', org_id: 'org-1', user_id: 'user-1', role: 'learner', status: 'active', created_at: '2026-06-07T12:00:00.000Z' };
    mockQueryOne.mockResolvedValueOnce(seatRow(5, 4));
    mockQueryOne.mockResolvedValueOnce(inserted);

    const res = await handler(baseReq(validBody), {} as any);

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ membership: inserted });
  });

  it('allows creation when seat_limit is null even with many active members', async () => {
    const inserted = { id: 'm4', org_id: 'org-1', user_id: 'user-1', role: 'learner', status: 'active', created_at: '2026-06-07T12:00:00.000Z' };
    mockQueryOne.mockResolvedValueOnce(seatRow(null, 1000));
    mockQueryOne.mockResolvedValueOnce(inserted);

    const res = await handler(baseReq(validBody), {} as any);

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ membership: inserted });
  });

  it('seat-limit count excludes disabled members (SQL counts active only)', async () => {
    const inserted = { id: 'm5', org_id: 'org-1', user_id: 'user-1', role: 'learner', status: 'active', created_at: '2026-06-07T12:00:00.000Z' };
    mockQueryOne.mockResolvedValueOnce(seatRow(5, 2)); // 2 active (disabled members not counted)
    mockQueryOne.mockResolvedValueOnce(inserted);

    const res = await handler(baseReq(validBody), {} as any);

    expect(res.status).toBe(200);
    const [seatSql] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(seatSql).toContain(`m.status = 'active'`);
    expect(seatSql).not.toContain('invited');
    expect(seatSql).not.toContain('disabled');
  });

  it('returns 404 when the organization does not exist (seat-limit lookup)', async () => {
    mockQueryOne.mockResolvedValueOnce(null);

    const res = await handler(baseReq(validBody), {} as any);

    expect(res.status).toBe(404);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Organization or user not found' });
    expect(mockQueryOne).toHaveBeenCalledTimes(1);
  });

  it('returns 409 on duplicate (org_id, user_id) unique violation (23505)', async () => {
    mockQueryOne.mockResolvedValueOnce(seatRow(null, 0));
    mockQueryOne.mockRejectedValueOnce(Object.assign(new Error('duplicate key value'), { code: '23505' }));
    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(409);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'User is already a member of this organization' });
  });

  it('returns 404 on foreign-key violation (23503)', async () => {
    mockQueryOne.mockResolvedValueOnce(seatRow(null, 0));
    mockQueryOne.mockRejectedValueOnce(Object.assign(new Error('insert violates fk'), { code: '23503' }));
    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(404);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Organization or user not found' });
  });

  it('returns 500 on generic db error', async () => {
    mockQueryOne.mockResolvedValueOnce(seatRow(null, 0));
    mockQueryOne.mockRejectedValueOnce(new Error('connection refused'));
    const res = await handler(baseReq(validBody), { error: vi.fn() } as any);
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Internal server error' });
  });
});
