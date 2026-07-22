import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuthenticate, MockAuthError, mockQuery, mockQueryOne, mockClientQuery, mockWithTransaction } =
  vi.hoisted(() => {
    class MockAuthError extends Error {}
    const mockClientQuery = vi.fn();
    return {
      mockAuthenticate: vi.fn(),
      MockAuthError,
      mockQuery: vi.fn(),
      mockQueryOne: vi.fn(),
      mockClientQuery,
      // Runs the callback with a fake client, mirroring the real withTransaction.
      mockWithTransaction: vi.fn(async (cb: (client: { query: typeof mockClientQuery }) => unknown) =>
        cb({ query: mockClientQuery }),
      ),
    };
  });
vi.mock('../shared/auth', () => ({ authenticate: mockAuthenticate, AuthError: MockAuthError }));
vi.mock('../shared/db', () => ({
  query: mockQuery,
  queryOne: mockQueryOne,
  withTransaction: mockWithTransaction,
}));

import handler from './index';

const baseReq = {
  method: 'POST',
  headers: { get: (k: string) => (k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok') },
};

// pg QueryResult shape: the shared helper (client.query) reads `.rows`.
const rows = (...r: unknown[]) => ({ rows: r });

const existingProfile = {
  id: 'profile-uuid',
  full_name: 'Test User',
  email: 'user@contoso.com',
  is_platform_admin: false,
  avatar_url: null,
};

const sqlCalls = () => mockClientQuery.mock.calls.map((c) => c[0] as string);
const findClientCall = (substr: string) =>
  mockClientQuery.mock.calls.find((c) => (c[0] as string).includes(substr));

describe('user-context', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ id: 'entra-oid-123', tid: 'entra-tid-456', email: 'user@contoso.com' });
    // Default: adoption finds no pending invites; all client writes return no rows.
    mockClientQuery.mockResolvedValue(rows());
    // Default: no memberships.
    mockQuery.mockResolvedValue([]);
  });

  it('returns existing profile and memberships', async () => {
    const memberships = [{ org_id: 'org-1', role: 'member', organization: { name: 'Org One' } }];
    mockQueryOne.mockResolvedValueOnce(existingProfile);
    mockQuery.mockResolvedValueOnce(memberships);

    const res = await handler(baseReq as any, {} as any);
    const body = JSON.parse(res.body);

    expect(body.profile.id).toBe('profile-uuid');
    expect(body.memberships).toHaveLength(1);
    // Should NOT have called INSERT (profile already existed)
    const insertCall = mockQueryOne.mock.calls.find((c) => (c[0] as string).includes('INSERT'));
    expect(insertCall).toBeUndefined();
  });

  it('provisions a new profile on first login', async () => {
    const newProfile = { id: 'new-uuid', full_name: 'user', email: 'user@contoso.com', is_platform_admin: false, avatar_url: null };
    mockQueryOne.mockResolvedValueOnce(null); // no existing profile
    mockQueryOne.mockResolvedValueOnce(newProfile); // INSERT returning
    mockQuery.mockResolvedValueOnce([]); // memberships (empty for new user)

    const res = await handler(baseReq as any, {} as any);
    const body = JSON.parse(res.body);

    expect(body.profile.id).toBe('new-uuid');
    expect(body.memberships).toHaveLength(0);
    // Verify INSERT was called with Entra oid and tid
    const insertCall = mockQueryOne.mock.calls.find((c) => (c[0] as string).includes('INSERT'));
    expect(insertCall).toBeDefined();
    expect(insertCall![1]).toContain('entra-oid-123');
    expect(insertCall![1]).toContain('entra-tid-456');
  });

  it('returns 500 on unexpected database error', async () => {
    mockQueryOne.mockReset();
    mockQueryOne.mockRejectedValueOnce(new Error('connection refused'));

    const res = await handler(baseReq as any, { error: vi.fn() } as any);
    const body = JSON.parse(res.body);

    expect(res.status).toBe(500);
    expect(body.error).toBe('Internal server error');
  });

  // ---- #176: auto-adopt pending org invites at login ----

  it('adopts a matching pending org invite: creates an active membership at the invited role and marks the invite accepted', async () => {
    mockQueryOne.mockResolvedValueOnce(existingProfile);
    // adoption SELECT returns one matching pending org invite
    mockClientQuery.mockResolvedValueOnce(rows({ id: 'inv-1', org_id: 'org-9', role: 'org_admin' }));
    // convertInvitation: no existing membership -> INSERT

    const res = await handler(baseReq as any, {} as any);
    expect(res.status).toBe(200);

    // The adoption lookup is scoped: pending, org-only, not expired, email-matched, locked.
    const [selectSql, selectParams] = mockClientQuery.mock.calls[0] as [string, unknown[]];
    expect(selectSql).toContain('FROM invitations');
    expect(selectSql).toContain("status = 'pending'");
    expect(selectSql).toContain('org_id IS NOT NULL');
    expect(selectSql).toContain('expires_at > now()');
    expect(selectSql).toContain('FOR UPDATE');
    expect(selectParams).toEqual(['user@contoso.com']);

    // convertInvitation ran: active membership at the invited role + invite marked accepted.
    const insertCall = findClientCall('INSERT INTO org_memberships');
    expect(insertCall).toBeDefined();
    expect(insertCall![0]).toContain(`'active'`);
    expect(insertCall![1]).toEqual(['org-9', 'profile-uuid', 'org_admin']);
    const acceptCall = findClientCall(`UPDATE invitations SET status = 'accepted'`);
    expect(acceptCall).toBeDefined();
    expect(acceptCall![1]).toEqual(['inv-1']);
  });

  it('adopts invites across multiple orgs (one membership per invite)', async () => {
    mockQueryOne.mockResolvedValueOnce(existingProfile);
    mockClientQuery.mockResolvedValueOnce(
      rows({ id: 'inv-1', org_id: 'org-1', role: 'learner' }, { id: 'inv-2', org_id: 'org-2', role: 'learner' }),
    );

    const res = await handler(baseReq as any, {} as any);
    expect(res.status).toBe(200);

    const inserts = mockClientQuery.mock.calls.filter((c) => (c[0] as string).includes('INSERT INTO org_memberships'));
    expect(inserts).toHaveLength(2);
    expect(inserts.map((c) => (c[1] as unknown[])[0])).toEqual(['org-1', 'org-2']);
    const accepts = mockClientQuery.mock.calls.filter((c) =>
      (c[0] as string).includes(`UPDATE invitations SET status = 'accepted'`),
    );
    expect(accepts.map((c) => (c[1] as unknown[])[0])).toEqual(['inv-1', 'inv-2']);
  });

  it('no matching invite: a bare account is provisioned with no membership/invite writes', async () => {
    mockQueryOne.mockResolvedValueOnce(null); // no existing profile
    mockQueryOne.mockResolvedValueOnce({ id: 'bare-uuid', full_name: 'user', email: 'user@contoso.com', is_platform_admin: false, avatar_url: null });
    // adoption SELECT returns nothing (default rows())

    const res = await handler(baseReq as any, {} as any);
    const body = JSON.parse(res.body);

    expect(res.status).toBe(200);
    expect(body.profile.id).toBe('bare-uuid');
    expect(body.memberships).toHaveLength(0);
    expect(findClientCall('INSERT INTO org_memberships')).toBeUndefined();
    expect(findClientCall(`UPDATE invitations SET status = 'accepted'`)).toBeUndefined();
  });

  it('already an active member: idempotent — no duplicate membership, invite still marked accepted', async () => {
    mockQueryOne.mockResolvedValueOnce(existingProfile);
    mockClientQuery.mockResolvedValueOnce(rows({ id: 'inv-1', org_id: 'org-1', role: 'learner' })); // adoption SELECT
    mockClientQuery.mockResolvedValueOnce(rows({ id: 'm1', status: 'active' })); // existing membership lock

    const res = await handler(baseReq as any, {} as any);
    expect(res.status).toBe(200);

    expect(findClientCall('INSERT INTO org_memberships')).toBeUndefined();
    expect(findClientCall('UPDATE org_memberships')).toBeUndefined();
    expect(findClientCall(`UPDATE invitations SET status = 'accepted'`)).toBeDefined();
  });

  it('matches the invited email case-insensitively and trimmed', async () => {
    mockAuthenticate.mockResolvedValueOnce({ id: 'oid', tid: 'tid', email: '  User@Contoso.COM ' });
    mockQueryOne.mockResolvedValueOnce(existingProfile);

    await handler(baseReq as any, {} as any);

    const [, selectParams] = mockClientQuery.mock.calls[0] as [string, unknown[]];
    expect(selectParams).toEqual(['user@contoso.com']);
  });

  it('skips adoption entirely when the login email is blank', async () => {
    mockAuthenticate.mockResolvedValueOnce({ id: 'oid', tid: 'tid', email: '' });
    mockQueryOne.mockResolvedValueOnce(existingProfile);

    const res = await handler(baseReq as any, {} as any);

    expect(res.status).toBe(200);
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it('a failed adoption never breaks login (still returns profile + memberships; error is logged)', async () => {
    const memberships = [{ org_id: 'org-1', role: 'member', organization: { name: 'Org One' } }];
    mockQueryOne.mockResolvedValueOnce(existingProfile);
    mockWithTransaction.mockRejectedValueOnce(new Error('deadlock detected'));
    mockQuery.mockResolvedValueOnce(memberships);
    const context = { error: vi.fn() };

    const res = await handler(baseReq as any, context as any);
    const body = JSON.parse(res.body);

    expect(res.status).toBe(200);
    expect(body.profile.id).toBe('profile-uuid');
    expect(body.memberships).toHaveLength(1);
    expect(context.error).toHaveBeenCalled();
    // sanity: the failure was in adoption, not the whole request
    expect(sqlCalls()).toEqual([]); // client.query never ran (withTransaction rejected before invoking cb)
  });
});
