import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockAuthenticate, MockAuthError, mockQuery, mockQueryOne, mockClientQuery, mockWithTransaction,
  mockSeedTenantBinding, mockAutoJoinByTenant, mockIndividualTierEnabled, mockOrgDefaultLanguage,
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
      mockWithTransaction: vi.fn(async (cb: (client: { query: typeof mockClientQuery }) => unknown) =>
        cb({ query: mockClientQuery }),
      ),
      mockSeedTenantBinding: vi.fn(),
      mockAutoJoinByTenant: vi.fn(),
      mockIndividualTierEnabled: vi.fn(),
      mockOrgDefaultLanguage: vi.fn(),
    };
  });
vi.mock('../shared/auth', () => ({ authenticate: mockAuthenticate, AuthError: MockAuthError }));
vi.mock('../shared/db', () => ({
  query: mockQuery,
  queryOne: mockQueryOne,
  withTransaction: mockWithTransaction,
}));
vi.mock('../shared/tenant-binding', () => ({
  seedTenantBinding: mockSeedTenantBinding,
  autoJoinByTenant: mockAutoJoinByTenant,
  individualTierEnabled: mockIndividualTierEnabled,
}));
vi.mock('../shared/member-language', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../shared/member-language')>()),
  orgDefaultLanguageForNewProfile: mockOrgDefaultLanguage,
}));

import handler from './index';

const baseReq = {
  method: 'POST',
  headers: { get: (k: string) => (k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok') },
};

const reqWith = (body: unknown) => ({
  ...baseReq,
  json: async () => body,
});

const insertParams = () =>
  (mockQueryOne.mock.calls.find((c) => (c[0] as string).includes('INSERT'))?.[1] ?? []) as unknown[];

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
    mockQuery.mockResolvedValue([]);
    mockClientQuery.mockResolvedValue(rows());
    mockIndividualTierEnabled.mockResolvedValue(false);
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
    const insertCall = mockQueryOne.mock.calls.find((c) => (c[0] as string).includes('INSERT'));
    expect(insertCall).toBeDefined();
    expect(insertCall![1]).toContain('entra-oid-123');
    expect(insertCall![1]).toContain('entra-tid-456');
  });

  it('#487: refuses to provision a profile when the token carries no email, and writes nothing', async () => {
    mockAuthenticate.mockResolvedValueOnce({ id: 'entra-oid-123', tid: 'entra-tid-456', email: '' });
    mockQueryOne.mockResolvedValueOnce(null); // no existing profile

    const res = await handler(baseReq as any, {} as any);

    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string).error).toMatch(/email address/i);
    expect(mockQueryOne.mock.calls.find((c) => (c[0] as string).includes('INSERT'))).toBeUndefined();
  });

  it('#487: an existing profile still logs in even if the token carries no email', async () => {
    mockAuthenticate.mockResolvedValueOnce({ id: 'entra-oid-123', tid: 'entra-tid-456', email: '' });
    mockQueryOne.mockResolvedValueOnce(existingProfile);
    mockQuery.mockResolvedValueOnce([]);
    mockQuery.mockResolvedValueOnce([]);

    const res = await handler(baseReq as any, {} as any);

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string).profile.id).toBe('profile-uuid');
  });

  describe('#226 preferred_language provisioning', () => {
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
      await handler(baseReq as any, {} as any);
      expect(insertParams()).toContain('en');
    });

    it('#405: the joining org default beats the browser-derived language', async () => {
      arrangeNewProfile();
      mockOrgDefaultLanguage.mockResolvedValueOnce('da');
      await handler(reqWith({ language: 'en' }) as any, {} as any);
      const params = insertParams();
      expect(params).toContain('da');
      expect(params).not.toContain('en');
      expect(mockOrgDefaultLanguage).toHaveBeenCalledWith('user@contoso.com', 'entra-tid-456');
    });

    it('#405: keeps the browser-derived language when the joining org sets no default', async () => {
      arrangeNewProfile();
      mockOrgDefaultLanguage.mockResolvedValueOnce(null);
      await handler(reqWith({ language: 'da' }) as any, {} as any);
      expect(insertParams()).toContain('da');
    });

    it('#405: reports profileCreated so the client can apply the org default once', async () => {
      arrangeNewProfile();
      mockOrgDefaultLanguage.mockResolvedValueOnce('da');
      const res = await handler(reqWith({ language: 'en' }) as any, {} as any);
      expect(JSON.parse(res.body as string).profileCreated).toBe(true);
    });

    it('#405: does not report profileCreated for an existing profile', async () => {
      mockQueryOne.mockResolvedValueOnce(existingProfile);
      mockQuery.mockResolvedValueOnce([]);
      const res = await handler(reqWith({ language: 'da' }) as any, {} as any);
      expect(JSON.parse(res.body as string).profileCreated).toBe(false);
    });

    it('does NOT overwrite an existing profile — later logins never touch preferred_language', async () => {
      mockQueryOne.mockResolvedValueOnce(existingProfile); // profile already exists
      await handler(reqWith({ language: 'da' }) as any, {} as any);
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

    const [preSql, preParams] = invitationsQuery()!;
    expect(preSql).toContain("status = 'pending'");
    expect(preSql).toContain('org_id IS NOT NULL');
    expect(preSql).toContain('expires_at > now()');
    expect(preSql).toContain('LIMIT 1');
    expect(preParams).toEqual(['user@contoso.com']);

    const [selectSql] = mockClientQuery.mock.calls[0] as [string, unknown[]];
    expect(selectSql).toContain('FOR UPDATE');

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
      expect(mockAutoJoinByTenant).toHaveBeenCalledTimes(1);
    });

    it('strips the tenant binding from the memberships payload (platform-admin-only invariant)', async () => {
      mockQueryOne.mockResolvedValueOnce(existingProfile);
      mockQuery.mockResolvedValueOnce([]); // pre-check: no pending invite
      mockQuery.mockResolvedValueOnce([
        { org_id: 'org-1', organization: { id: 'org-1', name: 'Org One', entra_tid: 'tid-x', entra_tid_label: 'acme.com' } },
      ]); // memberships load — row_to_json(o.*) would include the binding

      const res = await handler(baseReq as any, {} as any);
      const body = JSON.parse(res.body);

      expect(body.memberships[0].organization).not.toHaveProperty('entra_tid');
      expect(body.memberships[0].organization).not.toHaveProperty('entra_tid_label');
      expect(body.memberships[0].organization.name).toBe('Org One'); // other fields intact
    });
  });

  describe('#354 individual-tier walk-in auto-join', () => {
    const insertMembershipCall = () =>
      mockQuery.mock.calls.find(
        (c) => (c[0] as string).includes('INSERT INTO org_memberships') && (c[0] as string).includes("'learner'"),
      );
    const placeholderLookupCall = () =>
      mockQueryOne.mock.calls.find((c) => (c[0] as string).includes('WHERE kind = $1'));

    it('auto-joins a walk-in with no active memberships to the Individuals placeholder', async () => {
      mockIndividualTierEnabled.mockResolvedValue(true);
      mockQueryOne
        .mockResolvedValueOnce(existingProfile)     // profile lookup
        .mockResolvedValueOnce({ id: 'ind-354' });  // placeholder lookup (kind='individual')

      const res = await handler(baseReq as any, { error: vi.fn(), warn: vi.fn() } as any);
      expect(res.status).toBe(200);

      const [placeholderSql, placeholderParams] = placeholderLookupCall()!;
      expect(placeholderSql).toContain('FROM organizations');
      expect(placeholderParams).toEqual(['individual']);
      const insert = insertMembershipCall();
      expect(insert).toBeDefined();
      expect(insert![0]).toContain("'active'");
      expect(insert![0]).toContain('ON CONFLICT');
      expect(insert![1]).toEqual(['ind-354', 'profile-uuid']);
    });

    it('no-ops (no placeholder lookup, no INSERT) when the tier switch is off', async () => {
      mockIndividualTierEnabled.mockResolvedValue(false);
      mockQueryOne.mockResolvedValueOnce(existingProfile); // profile lookup only

      const res = await handler(baseReq as any, { error: vi.fn() } as any);
      expect(res.status).toBe(200);
      expect(placeholderLookupCall()).toBeUndefined();
      expect(insertMembershipCall()).toBeUndefined();
    });

    it('leaves an existing active member untouched (no placeholder lookup, no INSERT)', async () => {
      mockIndividualTierEnabled.mockResolvedValue(true);
      mockQueryOne.mockResolvedValueOnce(existingProfile); // profile lookup
      mockQuery.mockResolvedValueOnce([]);                 // invite pre-check: none
      mockQuery.mockResolvedValueOnce([{ '?column?': 1 }]); // active-membership check: already a member

      const res = await handler(baseReq as any, { error: vi.fn() } as any);
      expect(res.status).toBe(200);
      expect(placeholderLookupCall()).toBeUndefined(); // short-circuits before the placeholder lookup
      expect(insertMembershipCall()).toBeUndefined();
    });

    it('degrades gracefully (no INSERT) when the Individuals placeholder is not seeded', async () => {
      mockIndividualTierEnabled.mockResolvedValue(true);
      mockQueryOne
        .mockResolvedValueOnce(existingProfile) // profile lookup
        .mockResolvedValueOnce(null);           // placeholder lookup: not seeded yet

      const res = await handler(baseReq as any, { error: vi.fn() } as any);
      expect(res.status).toBe(200);
      expect(placeholderLookupCall()).toBeDefined();
      expect(insertMembershipCall()).toBeUndefined();
    });

    it('best-effort: an auto-join failure is logged and never breaks login', async () => {
      mockIndividualTierEnabled.mockResolvedValue(true);
      mockQueryOne.mockResolvedValueOnce(existingProfile);  // profile lookup
      mockQuery.mockResolvedValueOnce([]);                  // invite pre-check: none
      mockQuery.mockRejectedValueOnce(new Error('db down')); // active-membership check throws
      const context = { error: vi.fn() };

      const res = await handler(baseReq as any, context as any);
      const body = JSON.parse(res.body);

      expect(res.status).toBe(200);          // login still succeeds
      expect(body.profile.id).toBe('profile-uuid');
      expect(context.error).toHaveBeenCalled();
      expect(insertMembershipCall()).toBeUndefined();
    });
  });
});
