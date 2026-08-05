import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockAuthenticate, MockAuthError, mockQuery, mockQueryOne, mockClientQuery, mockWithTransaction,
  mockSeedTenantBinding, mockAutoJoinByTenant,
} =
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
      mockSeedTenantBinding: vi.fn(),
      mockAutoJoinByTenant: vi.fn(),
    };
  });
vi.mock('../shared/auth', () => ({ authenticate: mockAuthenticate, AuthError: MockAuthError }));
vi.mock('../shared/db', () => ({
  query: mockQuery,
  queryOne: mockQueryOne,
  withTransaction: mockWithTransaction,
}));
// Tenant binding (#353) is unit-tested in shared/tenant-binding.test.ts; here we
// mock it and assert the wiring (right args, right conditions).
vi.mock('../shared/tenant-binding', () => ({
  seedTenantBinding: mockSeedTenantBinding,
  autoJoinByTenant: mockAutoJoinByTenant,
}));

import handler from './index';

const baseReq = {
  method: 'POST',
  headers: { get: (k: string) => (k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok') },
};

// A request carrying a JSON body (the client sends { language } on the
// user-context call, #226). Mirrors the Azure HttpRequest.json() contract.
const reqWith = (body: unknown) => ({
  ...baseReq,
  json: async () => body,
});

const insertParams = () =>
  (mockQueryOne.mock.calls.find((c) => (c[0] as string).includes('INSERT'))?.[1] ?? []) as unknown[];

// pg QueryResult shape: the shared helper (client.query) reads `.rows`.
const rows = (...r: unknown[]) => ({ rows: r });

const existingProfile = {
  id: 'profile-uuid',
  full_name: 'Test User',
  email: 'user@contoso.com',
  is_platform_admin: false,
  avatar_url: null,
  assessment_level: 'intermediate',
  assessment_skipped_at: null,
  assessment_taken_at: '2026-07-01T10:00:00.000Z',
};

const findClientCall = (substr: string) =>
  mockClientQuery.mock.calls.find((c) => (c[0] as string).includes(substr));
const invitationsQuery = () =>
  mockQuery.mock.calls.find((c) => (c[0] as string).includes('FROM invitations'));

describe('user-context', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ id: 'entra-oid-123', tid: 'entra-tid-456', email: 'user@contoso.com' });
    // Defaults: pre-check finds no pending invite (query), transaction writes return no rows.
    mockQuery.mockResolvedValue([]);
    mockClientQuery.mockResolvedValue(rows());
  });

  it('returns existing profile and memberships', async () => {
    const memberships = [{ org_id: 'org-1', role: 'member', organization: { name: 'Org One' } }];
    mockQueryOne.mockResolvedValueOnce(existingProfile);
    mockQuery.mockResolvedValueOnce([]);
    mockQuery.mockResolvedValueOnce(memberships);

    const res = await handler(baseReq as any, {} as any);
    const body = JSON.parse(res.body);

    expect(body.profile.id).toBe('profile-uuid');
    expect(body.memberships).toHaveLength(1);
    expect(body.profile.assessment_level).toBe('intermediate');
    expect(body.profile.assessment_skipped_at).toBeNull();
    expect(body.profile.assessment_taken_at).toBe('2026-07-01T10:00:00.000Z');
    // Should NOT have called INSERT (profile already existed)
    const insertCall = mockQueryOne.mock.calls.find((c) => (c[0] as string).includes('INSERT'));
    expect(insertCall).toBeUndefined();
  });

  it('provisions a new profile on first login', async () => {
    const insertedId = { id: 'new-uuid' };
    const newProfile = {
      id: 'new-uuid', full_name: 'user', email: 'user@contoso.com',
      is_platform_admin: false, avatar_url: null,
      assessment_level: null, assessment_skipped_at: null, assessment_taken_at: null,
    };
    mockQueryOne.mockResolvedValueOnce(null);        // no existing profile
    mockQueryOne.mockResolvedValueOnce(insertedId);  // INSERT RETURNING id
    mockQueryOne.mockResolvedValueOnce(newProfile);  // re-select with full shape
    mockQuery.mockResolvedValueOnce([]);
    mockQuery.mockResolvedValueOnce([]);

    const res = await handler(baseReq as any, {} as any);
    const body = JSON.parse(res.body);

    expect(body.profile.id).toBe('new-uuid');
    expect(body.memberships).toHaveLength(0);
    expect(body.profile.assessment_level).toBeNull();
    expect(body.profile.assessment_skipped_at).toBeNull();
    expect(body.profile.assessment_taken_at).toBeNull();
    // Verify INSERT was called with Entra oid and tid
    const insertCall = mockQueryOne.mock.calls.find((c) => (c[0] as string).includes('INSERT'));
    expect(insertCall).toBeDefined();
    expect(insertCall![1]).toContain('entra-oid-123');
    expect(insertCall![1]).toContain('entra-tid-456');
  });

  describe('#226 preferred_language provisioning', () => {
    // Arrange a first-login provisioning flow: no existing profile, INSERT
    // returns an id, re-select returns the full shape, no invites, no memberships.
    const arrangeNewProfile = () => {
      mockQueryOne.mockResolvedValueOnce(null); // no existing profile
      mockQueryOne.mockResolvedValueOnce({ id: 'new-uuid' }); // INSERT RETURNING id
      mockQueryOne.mockResolvedValueOnce({
        id: 'new-uuid', full_name: 'user', email: 'user@contoso.com',
        is_platform_admin: false, avatar_url: null, preferred_language: 'da',
        assessment_level: null, assessment_skipped_at: null, assessment_taken_at: null,
      }); // re-select
      mockQuery.mockResolvedValueOnce([]);
      mockQuery.mockResolvedValueOnce([]);
    };

    it('stamps the sent language (da) into the provisioning INSERT', async () => {
      arrangeNewProfile();
      await handler(reqWith({ language: 'da' }) as any, {} as any);
      expect(insertParams()).toContain('da');
    });

    it('stamps the sent language (en) into the provisioning INSERT', async () => {
      arrangeNewProfile();
      await handler(reqWith({ language: 'en' }) as any, {} as any);
      expect(insertParams()).toContain('en');
    });

    it('defaults to English when the request body omits a language', async () => {
      arrangeNewProfile();
      await handler(reqWith({}) as any, {} as any);
      expect(insertParams()).toContain('en');
    });

    it('defaults to English (never persists) an unsupported language', async () => {
      arrangeNewProfile();
      await handler(reqWith({ language: 'fr' }) as any, {} as any);
      const params = insertParams();
      expect(params).toContain('en');
      expect(params).not.toContain('fr');
    });

    it('defaults to English when there is no JSON body at all (e.g. a GET probe)', async () => {
      arrangeNewProfile();
      // baseReq has no json() method — the handler must tolerate that and default.
      await handler(baseReq as any, {} as any);
      expect(insertParams()).toContain('en');
    });

    it('does NOT overwrite an existing profile — later logins never touch preferred_language', async () => {
      mockQueryOne.mockResolvedValueOnce(existingProfile); // profile already exists
      await handler(reqWith({ language: 'da' }) as any, {} as any);
      // No INSERT (already provisioned) and no UPDATE of the profile: existing
      // users keep whatever language they have (Q1 — no backfill).
      const insertCall = mockQueryOne.mock.calls.find((c) => (c[0] as string).includes('INSERT'));
      const updateCall = mockQueryOne.mock.calls.find((c) => (c[0] as string).includes('UPDATE profiles'));
      expect(insertCall).toBeUndefined();
      expect(updateCall).toBeUndefined();
    });
  });

  it('returns 500 on unexpected database error', async () => {
    mockQueryOne.mockReset();
    mockQueryOne.mockRejectedValueOnce(new Error('connection refused'));

    const res = await handler(baseReq as any, { error: vi.fn() } as any);
    const body = JSON.parse(res.body);

    expect(res.status).toBe(500);
    expect(body.error).toBe('Internal server error');
  });

  it('adopts a matching pending org invite: creates an active membership at the invited role and marks the invite accepted', async () => {
    mockQueryOne.mockResolvedValueOnce(existingProfile);
    mockQuery.mockResolvedValueOnce([{ id: 'inv-1' }]); // pre-check: a pending invite exists
    mockClientQuery.mockResolvedValueOnce(rows({ id: 'inv-1', org_id: 'org-9', role: 'org_admin' })); // FOR UPDATE re-select

    const res = await handler(baseReq as any, {} as any);
    expect(res.status).toBe(200);

    // The cheap pre-check is scoped (pending, org-only, unexpired), email-matched, and bounded.
    const [preSql, preParams] = invitationsQuery()!;
    expect(preSql).toContain("status = 'pending'");
    expect(preSql).toContain('org_id IS NOT NULL');
    expect(preSql).toContain('expires_at > now()');
    expect(preSql).toContain('LIMIT 1');
    expect(preParams).toEqual(['user@contoso.com']);

    // The in-transaction re-select locks the rows.
    const [selectSql] = mockClientQuery.mock.calls[0] as [string, unknown[]];
    expect(selectSql).toContain('FOR UPDATE');

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
    mockQuery.mockResolvedValueOnce([{ id: 'inv-1' }, { id: 'inv-2' }]); // pre-check: invites exist
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

  it('no matching invite: bare account provisioned, and NO transaction is opened (cheap pre-check only)', async () => {
    mockQueryOne.mockResolvedValueOnce(null); // no existing profile
    mockQueryOne.mockResolvedValueOnce({ id: 'bare-uuid' }); // INSERT RETURNING id
    mockQueryOne.mockResolvedValueOnce({
      id: 'bare-uuid', full_name: 'user', email: 'user@contoso.com',
      is_platform_admin: false, avatar_url: null,
      assessment_level: null, assessment_skipped_at: null, assessment_taken_at: null,
    }); // re-select with full shape

    const res = await handler(baseReq as any, {} as any);
    const body = JSON.parse(res.body);

    expect(res.status).toBe(200);
    expect(body.profile.id).toBe('bare-uuid');
    expect(body.memberships).toHaveLength(0);
    // The whole point of the pre-check optimization: no connection checkout / BEGIN when there's nothing to adopt.
    expect(mockWithTransaction).not.toHaveBeenCalled();
    expect(findClientCall('INSERT INTO org_memberships')).toBeUndefined();
  });

  it('already an active member: idempotent — no duplicate membership, invite still marked accepted', async () => {
    mockQueryOne.mockResolvedValueOnce(existingProfile);
    mockQuery.mockResolvedValueOnce([{ id: 'inv-1' }]); // pre-check
    mockClientQuery.mockResolvedValueOnce(rows({ id: 'inv-1', org_id: 'org-1', role: 'learner' })); // re-select
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

    const [, preParams] = invitationsQuery()!;
    expect(preParams).toEqual(['user@contoso.com']);
  });

  it('skips adoption entirely when the login email is blank (no invite query, no transaction)', async () => {
    mockAuthenticate.mockResolvedValueOnce({ id: 'oid', tid: 'tid', email: '' });
    mockQueryOne.mockResolvedValueOnce(existingProfile);

    const res = await handler(baseReq as any, {} as any);

    expect(res.status).toBe(200);
    expect(invitationsQuery()).toBeUndefined(); // never even runs the pre-check
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it('a failed adoption never breaks login (still returns profile + memberships; error is logged)', async () => {
    const memberships = [{ org_id: 'org-1', role: 'member', organization: { name: 'Org One' } }];
    mockQueryOne.mockResolvedValueOnce(existingProfile);
    mockQuery.mockResolvedValueOnce([{ id: 'inv-1' }]); // pre-check finds an invite
    mockWithTransaction.mockRejectedValueOnce(new Error('deadlock detected'));
    mockQuery.mockResolvedValueOnce(memberships); // memberships load still happens
    const context = { error: vi.fn() };

    const res = await handler(baseReq as any, context as any);
    const body = JSON.parse(res.body);

    expect(res.status).toBe(200);
    expect(body.profile.id).toBe('profile-uuid');
    expect(body.memberships).toHaveLength(1);
    expect(context.error).toHaveBeenCalled();
  });

  describe('#353 tenant auto-join / binding wiring', () => {
    it('attempts tenant auto-join on every login with the caller profile id and verified tid', async () => {
      mockQueryOne.mockResolvedValueOnce(existingProfile);
      const context = {};
      await handler(baseReq as any, context as any);

      expect(mockAutoJoinByTenant).toHaveBeenCalledTimes(1);
      expect(mockAutoJoinByTenant).toHaveBeenCalledWith('profile-uuid', 'entra-tid-456', context);
    });

    it('seeds the org↔tenant binding after adopting an org_admin invite', async () => {
      mockQueryOne.mockResolvedValueOnce(existingProfile);
      mockQuery.mockResolvedValueOnce([{ id: 'inv-1' }]); // pre-check
      mockClientQuery.mockResolvedValueOnce(rows({ id: 'inv-1', org_id: 'org-9', role: 'org_admin' })); // re-select
      const context = {};

      await handler(baseReq as any, context as any);

      expect(mockSeedTenantBinding).toHaveBeenCalledTimes(1);
      expect(mockSeedTenantBinding).toHaveBeenCalledWith('org-9', 'entra-tid-456', 'user@contoso.com', context);
    });

    it('does NOT seed a binding for a learner-only invite', async () => {
      mockQueryOne.mockResolvedValueOnce(existingProfile);
      mockQuery.mockResolvedValueOnce([{ id: 'inv-1' }]); // pre-check
      mockClientQuery.mockResolvedValueOnce(rows({ id: 'inv-1', org_id: 'org-1', role: 'learner' })); // re-select

      await handler(baseReq as any, {} as any);

      expect(mockSeedTenantBinding).not.toHaveBeenCalled();
      // Auto-join still runs — a learner from a bound tenant can still self-onboard.
      expect(mockAutoJoinByTenant).toHaveBeenCalledTimes(1);
    });
  });
});
