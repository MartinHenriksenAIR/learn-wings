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

const existingInvitation = { org_id: 'org-1' };

const updatedInvitationRow = {
  id: 'inv-1',
  org_id: 'org-1',
  email: 'invitee@example.com',
  role: 'learner',
  status: 'expired',
  expires_at: '2026-06-14T12:00:00.000Z',
  created_at: '2026-06-07T12:00:00.000Z',
  link_id: 'link-abc',
  is_platform_admin_invite: false,
  invited_by_user_id: 'p1',
  first_name: 'Ada',
  last_name: 'Lovelace',
  department: 'Engineering',
};

describe('invitation-update', () => {
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
    const res = await handler(baseReq({ id: 'inv-1', status: 'expired' }), {} as any);
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Missing Bearer token' });
  });

  it('returns 401 when profile is not provisioned', async () => {
    mockGetProfile.mockResolvedValueOnce(null);
    const res = await handler(baseReq({ id: 'inv-1', status: 'expired' }), {} as any);
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Profile not found' });
  });

  it('returns 400 when id is missing', async () => {
    const res = await handler(baseReq({ status: 'expired' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'id is required' });
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  it('returns 400 when id is wrong type', async () => {
    const res = await handler(baseReq({ id: 42, status: 'expired' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'id is required' });
  });

  it('returns 400 when id is empty string', async () => {
    const res = await handler(baseReq({ id: '', status: 'expired' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'id is required' });
  });

  it('returns 400 when status is missing', async () => {
    const res = await handler(baseReq({ id: 'inv-1' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: "status must be 'expired'" });
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  it("returns 400 when status is 'accepted'", async () => {
    const res = await handler(baseReq({ id: 'inv-1', status: 'accepted' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: "status must be 'expired'" });
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  it("returns 400 when status is 'pending'", async () => {
    const res = await handler(baseReq({ id: 'inv-1', status: 'pending' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: "status must be 'expired'" });
  });

  it("returns 400 when status is empty string", async () => {
    const res = await handler(baseReq({ id: 'inv-1', status: '' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: "status must be 'expired'" });
  });

  it('returns 404 when invitation does not exist (and does NOT issue the UPDATE)', async () => {
    mockQueryOne.mockResolvedValueOnce(null); // SELECT returns no row
    const res = await handler(baseReq({ id: 'inv-missing', status: 'expired' }), {} as any);
    expect(res.status).toBe(404);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Invitation not found' });
    expect(mockQueryOne).toHaveBeenCalledTimes(1);
    const [sql] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('SELECT org_id FROM invitations');
  });

  it('returns 403 when caller is neither platform admin nor org admin (and does NOT issue the UPDATE)', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: false });
    mockIsOrgAdmin.mockResolvedValueOnce(false);
    mockQueryOne.mockResolvedValueOnce(existingInvitation); // SELECT returns row
    const res = await handler(baseReq({ id: 'inv-1', status: 'expired' }), {} as any);
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Forbidden' });
    expect(mockIsOrgAdmin).toHaveBeenCalledWith('p1', 'org-1');
    expect(mockQueryOne).toHaveBeenCalledTimes(1); // SELECT only, no UPDATE
  });

  it('returns 404 (TOCTOU) when SELECT finds the row but UPDATE RETURNING returns null', async () => {
    mockQueryOne.mockResolvedValueOnce(existingInvitation); // SELECT
    mockQueryOne.mockResolvedValueOnce(null); // UPDATE RETURNING null
    const res = await handler(baseReq({ id: 'inv-1', status: 'expired' }), {} as any);
    expect(res.status).toBe(404);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Invitation not found' });
    expect(mockQueryOne).toHaveBeenCalledTimes(2);
  });

  it('happy path (platform admin): expires the invitation and returns the row', async () => {
    mockQueryOne.mockResolvedValueOnce(existingInvitation); // SELECT
    mockQueryOne.mockResolvedValueOnce(updatedInvitationRow); // UPDATE RETURNING

    const res = await handler(baseReq({ id: 'inv-1', status: 'expired' }), {} as any);

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ invitation: updatedInvitationRow });
    expect(mockIsOrgAdmin).not.toHaveBeenCalled(); // platform-admin bypass

    const [sql, params] = mockQueryOne.mock.calls[1] as [string, unknown[]];
    expect(sql).toContain("UPDATE invitations SET status = 'expired'");
    expect(sql).toContain('WHERE id = $1');
    expect(sql).toContain('RETURNING id, org_id, email, role, status, expires_at, created_at, link_id');
    expect(sql).toContain('is_platform_admin_invite, invited_by_user_id, first_name, last_name, department');
    expect(params).toEqual(['inv-1']);
  });

  it('happy path (org admin): authorizes via isOrgAdmin and returns the row', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: false });
    mockIsOrgAdmin.mockResolvedValueOnce(true);
    mockQueryOne.mockResolvedValueOnce(existingInvitation); // SELECT
    mockQueryOne.mockResolvedValueOnce(updatedInvitationRow); // UPDATE RETURNING

    const res = await handler(baseReq({ id: 'inv-1', status: 'expired' }), {} as any);

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ invitation: updatedInvitationRow });
    expect(mockIsOrgAdmin).toHaveBeenCalledWith('p1', 'org-1');

    const [sql, params] = mockQueryOne.mock.calls[1] as [string, unknown[]];
    expect(sql).toContain('UPDATE invitations');
    expect(params).toEqual(['inv-1']);
  });

  it('SELECT and UPDATE SQL never project token or token_hash', async () => {
    mockQueryOne.mockResolvedValueOnce(existingInvitation); // SELECT
    mockQueryOne.mockResolvedValueOnce(updatedInvitationRow); // UPDATE RETURNING

    await handler(baseReq({ id: 'inv-1', status: 'expired' }), {} as any);

    const [selectSql] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    const [updateSql] = mockQueryOne.mock.calls[1] as [string, unknown[]];
    // Match `token` / `token_hash` as full words (regex word boundaries).
    expect(selectSql).not.toMatch(/\btoken\b/);
    expect(selectSql).not.toMatch(/\btoken_hash\b/);
    expect(updateSql).not.toMatch(/\btoken\b/);
    expect(updateSql).not.toMatch(/\btoken_hash\b/);
  });

  it('returns 500 on generic db error during UPDATE', async () => {
    mockQueryOne.mockResolvedValueOnce(existingInvitation); // SELECT
    mockQueryOne.mockRejectedValueOnce(new Error('connection refused')); // UPDATE
    const res = await handler(baseReq({ id: 'inv-1', status: 'expired' }), { error: vi.fn() } as any);
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Internal server error' });
  });
});
