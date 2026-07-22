import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuthenticate, MockAuthError, mockQueryOne, mockClientQuery, mockWithTransaction } = vi.hoisted(() => {
  class MockAuthError extends Error {}
  const mockClientQuery = vi.fn();
  return {
    mockAuthenticate: vi.fn(), MockAuthError,
    mockQueryOne: vi.fn(),
    mockClientQuery,
    mockWithTransaction: vi.fn(async (cb: (client: { query: typeof mockClientQuery }) => unknown) => cb({ query: mockClientQuery })),
  };
});
vi.mock('../shared/auth', () => ({ authenticate: mockAuthenticate, AuthError: MockAuthError }));
vi.mock('../shared/db', () => ({
  query: vi.fn(),
  queryOne: mockQueryOne,
  withTransaction: mockWithTransaction,
}));

import handler from './index';

const baseReq = (body: unknown) => ({
  method: 'POST',
  headers: { get: (k: string) => (k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok') },
  json: async () => body,
}) as any;

const validBody = { linkId: 'link-1' };

// pg QueryResult shape: the handler reads `.rows`.
const rows = (...r: unknown[]) => ({ rows: r });

// The locked invitation row (SELECT ... FOR UPDATE OF i, LEFT JOIN organizations).
const pendingOrgInvite = {
  id: 'inv-1',
  org_id: 'org-1',
  email: 'user@x.com',
  role: 'learner',
  status: 'pending',
  is_platform_admin_invite: false,
  expires_at: '2099-01-01T00:00:00.000Z',
  org_name: 'Acme A/S',
};

const pendingPlatformInvite = {
  ...pendingOrgInvite,
  id: 'inv-2',
  org_id: null,
  is_platform_admin_invite: true,
  org_name: null,
};

const sqlCalls = () => mockClientQuery.mock.calls.map((c) => c[0] as string);
const findCall = (substr: string) =>
  mockClientQuery.mock.calls.find((c) => (c[0] as string).includes(substr));

describe('invitation-accept', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWithTransaction.mockImplementation(async (cb) => cb({ query: mockClientQuery }));
    mockAuthenticate.mockResolvedValue({ id: 'oid-1', tid: 'tid-1', email: 'user@x.com' });
    mockQueryOne.mockResolvedValue({ id: 'p1' }); // profile already provisioned
    mockClientQuery.mockResolvedValue(rows());    // default: writes return no rows
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

  it('returns 400 when linkId is missing', async () => {
    const res = await handler(baseReq({}), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'linkId is required' });
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it('returns 400 when linkId is not a string', async () => {
    const res = await handler(baseReq({ linkId: 42 }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'linkId is required' });
  });

  it('happy org path: locks the invite, creates an active membership with the invited role, marks accepted', async () => {
    mockClientQuery.mockResolvedValueOnce(rows(pendingOrgInvite)); // invitation lock
    mockClientQuery.mockResolvedValueOnce(rows());                 // no existing membership
    const res = await handler(baseReq(validBody), {} as any);

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({
      kind: 'org', orgId: 'org-1', orgName: 'Acme A/S', role: 'learner', alreadyMember: false,
    });

    // Invitation lookup locks the row and never touches token/token_hash.
    const [lockSql, lockParams] = mockClientQuery.mock.calls[0] as [string, unknown[]];
    expect(lockSql).toContain('FOR UPDATE OF i');
    expect(lockSql).not.toMatch(/\btoken\b/);
    expect(lockParams).toEqual(['link-1']);

    // Membership is created ACTIVE (never 'invited') with the invitation's role.
    const insertCall = findCall('INSERT INTO org_memberships');
    expect(insertCall).toBeDefined();
    expect(insertCall![0]).toContain(`'active'`);
    expect(insertCall![1]).toEqual(['org-1', 'p1', 'learner']);

    const acceptCall = findCall(`UPDATE invitations SET status = 'accepted'`);
    expect(acceptCall).toBeDefined();
    expect(acceptCall![1]).toEqual(['inv-1']);
  });

  it('provisions a profile on first authenticated call (does not assume user-context ran)', async () => {
    mockQueryOne.mockResolvedValueOnce(null);            // no existing profile
    mockQueryOne.mockResolvedValueOnce({ id: 'p-new' }); // INSERT ... RETURNING id
    mockClientQuery.mockResolvedValueOnce(rows(pendingOrgInvite));
    mockClientQuery.mockResolvedValueOnce(rows()); // no existing membership

    const res = await handler(baseReq(validBody), {} as any);

    expect(res.status).toBe(200);
    const insertProfile = mockQueryOne.mock.calls.find((c) => (c[0] as string).includes('INSERT INTO profiles'));
    expect(insertProfile).toBeDefined();
    expect(insertProfile![1]).toContain('oid-1');
    expect(insertProfile![1]).toContain('tid-1');
    // The freshly provisioned profile id is used for the membership.
    const insertMembership = findCall('INSERT INTO org_memberships');
    expect(insertMembership![1]).toEqual(['org-1', 'p-new', 'learner']);
  });

  it('platform-admin invite: sets is_platform_admin, no membership, marks accepted', async () => {
    mockClientQuery.mockResolvedValueOnce(rows(pendingPlatformInvite));
    const res = await handler(baseReq(validBody), {} as any);

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ kind: 'platform' });

    const adminCall = findCall('UPDATE profiles SET is_platform_admin = true');
    expect(adminCall).toBeDefined();
    expect(adminCall![1]).toEqual(['p1']);
    expect(sqlCalls().some((s) => s.includes('org_memberships'))).toBe(false);
    const acceptCall = findCall(`UPDATE invitations SET status = 'accepted'`);
    expect(acceptCall![1]).toEqual(['inv-2']);
  });

  it('already an active member: idempotent success, membership untouched, invite still marked accepted', async () => {
    mockClientQuery.mockResolvedValueOnce(rows(pendingOrgInvite));
    mockClientQuery.mockResolvedValueOnce(rows({ id: 'm1', status: 'active' }));
    const res = await handler(baseReq(validBody), {} as any);

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({
      kind: 'org', orgId: 'org-1', orgName: 'Acme A/S', role: 'learner', alreadyMember: true,
    });
    expect(findCall('INSERT INTO org_memberships')).toBeUndefined();
    expect(findCall('UPDATE org_memberships')).toBeUndefined();
    expect(findCall(`UPDATE invitations SET status = 'accepted'`)).toBeDefined();
  });

  it('disabled member: reactivates to active with the invitation role and marks accepted', async () => {
    mockClientQuery.mockResolvedValueOnce(rows(pendingOrgInvite));
    mockClientQuery.mockResolvedValueOnce(rows({ id: 'm1', status: 'disabled' }));
    const res = await handler(baseReq(validBody), {} as any);

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({
      kind: 'org', orgId: 'org-1', orgName: 'Acme A/S', role: 'learner', alreadyMember: false,
    });
    const reactivate = findCall('UPDATE org_memberships');
    expect(reactivate).toBeDefined();
    expect(reactivate![0]).toContain(`status = 'active'`);
    expect(reactivate![1]).toEqual(['m1', 'learner']);
    expect(findCall('INSERT INTO org_memberships')).toBeUndefined();
    expect(findCall(`UPDATE invitations SET status = 'accepted'`)).toBeDefined();
  });

  it('returns 404 INVITE_NOT_FOUND for an unknown link_id', async () => {
    mockClientQuery.mockResolvedValueOnce(rows()); // no invitation row
    const res = await handler(baseReq(validBody), {} as any);

    expect(res.status).toBe(404);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Invitation not found', code: 'INVITE_NOT_FOUND' });
    expect(mockClientQuery).toHaveBeenCalledTimes(1); // no writes
  });

  it('returns 409 INVITE_ALREADY_ACCEPTED for an accepted invitation', async () => {
    mockClientQuery.mockResolvedValueOnce(rows({ ...pendingOrgInvite, status: 'accepted' }));
    const res = await handler(baseReq(validBody), {} as any);

    expect(res.status).toBe(409);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Invitation has already been accepted', code: 'INVITE_ALREADY_ACCEPTED' });
    expect(mockClientQuery).toHaveBeenCalledTimes(1);
  });

  it('returns 410 INVITE_EXPIRED for status expired', async () => {
    mockClientQuery.mockResolvedValueOnce(rows({ ...pendingOrgInvite, status: 'expired' }));
    const res = await handler(baseReq(validBody), {} as any);

    expect(res.status).toBe(410);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Invitation has expired', code: 'INVITE_EXPIRED' });
  });

  it('returns 410 INVITE_EXPIRED for pending-but-past-expires_at WITHOUT mutating status', async () => {
    mockClientQuery.mockResolvedValueOnce(rows({ ...pendingOrgInvite, expires_at: '2020-01-01T00:00:00.000Z' }));
    const res = await handler(baseReq(validBody), {} as any);

    expect(res.status).toBe(410);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Invitation has expired', code: 'INVITE_EXPIRED' });
    // The expiry job owns flipping status to 'expired' — no UPDATE here.
    expect(mockClientQuery).toHaveBeenCalledTimes(1);
  });

  it('returns 403 INVITE_EMAIL_MISMATCH when the invite was issued to a different email', async () => {
    mockClientQuery.mockResolvedValueOnce(rows({ ...pendingOrgInvite, email: 'other@x.com' }));
    const res = await handler(baseReq(validBody), {} as any);

    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Invitation was issued to a different email address', code: 'INVITE_EMAIL_MISMATCH' });
    expect(mockClientQuery).toHaveBeenCalledTimes(1); // no membership/accept writes
  });

  it('email comparison is trimmed and case-insensitive on both sides', async () => {
    mockAuthenticate.mockResolvedValueOnce({ id: 'oid-1', tid: 'tid-1', email: ' User@X.com ' });
    mockClientQuery.mockResolvedValueOnce(rows({ ...pendingOrgInvite, email: 'uSER@x.COM' }));
    mockClientQuery.mockResolvedValueOnce(rows()); // no existing membership
    const res = await handler(baseReq(validBody), {} as any);

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string).kind).toBe('org');
  });

  it('returns 500 on generic db error', async () => {
    mockClientQuery.mockRejectedValueOnce(new Error('connection refused'));
    const res = await handler(baseReq(validBody), { error: vi.fn() } as any);
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Internal server error' });
  });
});
