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

const validBody = { orgId: 'org-1', email: 'NewUser@Example.com', role: 'learner' };

const insertedRow = {
  id: 'inv-1',
  org_id: 'org-1',
  email: 'newuser@example.com',
  role: 'learner',
  status: 'pending',
  expires_at: '2026-06-14T12:00:00.000Z',
  created_at: '2026-06-07T12:00:00.000Z',
  link_id: 'abc123def456',
  is_platform_admin_invite: false,
  invited_by_user_id: 'p1',
  first_name: null,
  last_name: null,
  department: null,
};

describe('invitation-create', () => {
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
    const res = await handler(baseReq({ email: 'a@b.com', role: 'learner' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'orgId is required' });
  });

  it('returns 400 when email is missing', async () => {
    const res = await handler(baseReq({ orgId: 'org-1', role: 'learner' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'email is required and must be a valid email address' });
  });

  it('returns 400 when email is invalid format', async () => {
    const res = await handler(baseReq({ orgId: 'org-1', email: 'no-at-sign', role: 'learner' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'email is required and must be a valid email address' });
  });

  it('returns 400 when role is invalid', async () => {
    const res = await handler(baseReq({ orgId: 'org-1', email: 'a@b.com', role: 'super_admin' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'role must be one of: org_admin, learner' });
  });

  it('returns 400 when firstName exceeds 100 characters', async () => {
    const res = await handler(
      baseReq({ ...validBody, firstName: 'a'.repeat(101) }),
      {} as any,
    );
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'firstName must be a string of 100 characters or fewer' });
  });

  it('returns 400 when firstName is wrong type', async () => {
    const res = await handler(baseReq({ ...validBody, firstName: 42 }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'firstName must be a string of 100 characters or fewer' });
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

  it('happy path (platform admin): inserts with lowercased email + invited_by_user_id + returns row including link_id', async () => {
    mockQueryOne.mockResolvedValueOnce(insertedRow);
    const res = await handler(baseReq(validBody), {} as any);

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ invitation: insertedRow });
    expect(mockIsOrgAdmin).not.toHaveBeenCalled(); // platform-admin bypass

    const [sql, params] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('INSERT INTO invitations');
    expect(sql).toContain('link_id');
    expect(sql).not.toMatch(/\btoken\b/);
    expect(sql).not.toContain('token_hash');
    expect(params).toEqual(['org-1', 'newuser@example.com', 'learner', 'p1', null, null, null]);
  });

  it('happy path (org admin): authorizes via isOrgAdmin and returns invitation', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: false });
    mockIsOrgAdmin.mockResolvedValueOnce(true);
    mockQueryOne.mockResolvedValueOnce(insertedRow);

    const res = await handler(baseReq(validBody), {} as any);

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ invitation: insertedRow });
    expect(mockIsOrgAdmin).toHaveBeenCalledWith('p1', 'org-1');
  });

  it('happy path: omitted firstName/lastName/department slots become null', async () => {
    mockQueryOne.mockResolvedValueOnce(insertedRow);
    await handler(baseReq(validBody), {} as any);
    const [, params] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(params[4]).toBeNull();
    expect(params[5]).toBeNull();
    expect(params[6]).toBeNull();
  });

  it('happy path: empty-string firstName coerced to null on insert', async () => {
    mockQueryOne.mockResolvedValueOnce(insertedRow);
    await handler(
      baseReq({ ...validBody, firstName: '', lastName: 'Doe', department: 'Eng' }),
      {} as any,
    );
    const [, params] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(params[4]).toBeNull();
    expect(params[5]).toBe('Doe');
    expect(params[6]).toBe('Eng');
  });

  it('returns 409 on unique violation (23505)', async () => {
    mockQueryOne.mockRejectedValueOnce(Object.assign(new Error('duplicate key value'), { code: '23505' }));
    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(409);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'An invitation for this email is already pending' });
  });

  it('returns 404 on foreign-key violation (23503)', async () => {
    mockQueryOne.mockRejectedValueOnce(Object.assign(new Error('insert violates fk'), { code: '23503' }));
    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(404);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Organization not found' });
  });

  it('returns 500 on generic db error', async () => {
    mockQueryOne.mockRejectedValueOnce(new Error('connection refused'));
    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'connection refused' });
  });
});
