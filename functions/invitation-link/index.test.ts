import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuthenticate, MockAuthError, mockQueryOne, mockGetProfile, mockIsOrgAdmin } = vi.hoisted(() => {
  class MockAuthError extends Error {}
  return {
    mockAuthenticate: vi.fn(),
    MockAuthError,
    mockQueryOne: vi.fn(),
    mockGetProfile: vi.fn(),
    mockIsOrgAdmin: vi.fn(),
  };
});
vi.mock('../shared/auth', () => ({ authenticate: mockAuthenticate, AuthError: MockAuthError }));
vi.mock('../shared/db', () => ({ queryOne: mockQueryOne }));
vi.mock('../shared/profile', () => ({ getProfile: mockGetProfile, isOrgAdmin: mockIsOrgAdmin }));

import handler from './index';

const baseReq = (body: unknown) => ({
  method: 'POST',
  headers: { get: (k: string) => (k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok') },
  json: async () => body,
}) as any;

describe('invitation-link', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ id: 'entra-oid-123', tid: 'tid-1', email: 'admin@test.com' });
    mockGetProfile.mockResolvedValue({ id: 'p1', is_platform_admin: false });
    mockIsOrgAdmin.mockResolvedValue(false);
  });

  // 1. 401 invalid token
  it('returns 401 when bearer token is invalid', async () => {
    mockAuthenticate.mockRejectedValueOnce(new MockAuthError('Missing Bearer token'));

    const res = await handler(baseReq({ orgId: 'org-1' }), {} as any);

    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Missing Bearer token' });
  });

  // 2. 401 profile null
  it('returns 401 when profile is not found', async () => {
    mockGetProfile.mockResolvedValueOnce(null);

    const res = await handler(baseReq({ orgId: 'org-1' }), {} as any);

    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Profile not found' });
  });

  // 3. 400 orgId missing
  it('returns 400 when orgId is missing', async () => {
    const res = await handler(baseReq({}), {} as any);

    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'orgId is required' });
  });

  // 3b. 400 orgId empty string
  it('returns 400 when orgId is empty string', async () => {
    const res = await handler(baseReq({ orgId: '' }), {} as any);

    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'orgId is required' });
  });

  // 4. 403 non-admin learner — isOrgAdmin called with ('p1','org-1')
  it('returns 403 for non-admin learner and calls isOrgAdmin with profile.id and orgId', async () => {
    mockIsOrgAdmin.mockResolvedValueOnce(false);

    const res = await handler(baseReq({ orgId: 'org-1' }), {} as any);

    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Forbidden' });
    expect(mockIsOrgAdmin).toHaveBeenCalledWith('p1', 'org-1');
  });

  // 5. Happy path as org admin: SQL uses invitations table, correct clauses, returns { linkId }
  it('returns 200 with linkId for org admin (isOrgAdmin=true)', async () => {
    mockIsOrgAdmin.mockResolvedValueOnce(true);
    mockQueryOne.mockResolvedValueOnce({ link_id: 'abc123hex' });

    const res = await handler(baseReq({ orgId: 'org-1' }), {} as any);

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ linkId: 'abc123hex' });

    // SQL assertions
    const [[sql, params]] = mockQueryOne.mock.calls as [[string, unknown[]]];
    expect(sql).toContain('FROM invitations');
    expect(sql).toContain("status = 'pending'");
    expect(sql).toContain('expires_at > NOW()');
    expect(sql).toContain('link_id IS NOT NULL');
    expect(sql).toContain('ORDER BY created_at DESC');
    expect(params).toEqual(['org-1']);

    // Regression pin: must NOT reference the non-existent table
    expect(sql).not.toContain('invitation_links');
  });

  // 6. Platform-admin bypass — isOrgAdmin NOT called
  it('platform admin bypasses isOrgAdmin check and returns linkId', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });
    mockQueryOne.mockResolvedValueOnce({ link_id: 'plat-link-id' });

    const res = await handler(baseReq({ orgId: 'org-1' }), {} as any);

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ linkId: 'plat-link-id' });
    expect(mockIsOrgAdmin).not.toHaveBeenCalled();
  });

  // 7. No active link → { linkId: null }
  it('returns { linkId: null } when no active invitation link exists', async () => {
    mockIsOrgAdmin.mockResolvedValueOnce(true);
    mockQueryOne.mockResolvedValueOnce(null);

    const res = await handler(baseReq({ orgId: 'org-1' }), {} as any);

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ linkId: null });
  });

  // 8. 500 db error
  it('returns 500 on db error', async () => {
    mockIsOrgAdmin.mockResolvedValueOnce(true);
    mockQueryOne.mockRejectedValueOnce(new Error('connection refused'));

    const res = await handler(baseReq({ orgId: 'org-1' }), {} as any);

    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Unknown error' });
  });
});
