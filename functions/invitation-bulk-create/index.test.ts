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

const makeInvite = (email: string, overrides: Record<string, unknown> = {}) => ({
  email,
  role: 'learner',
  ...overrides,
});

const insertedRow = (email: string, id = 'inv-1') => ({
  id,
  org_id: 'org-1',
  email,
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
});

describe('invitation-bulk-create', () => {
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
    const res = await handler(baseReq({ orgId: 'org-1', invites: [makeInvite('a@b.com')] }), {} as any);
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Missing Bearer token' });
  });

  it('returns 401 when profile is not provisioned', async () => {
    mockGetProfile.mockResolvedValueOnce(null);
    const res = await handler(baseReq({ orgId: 'org-1', invites: [makeInvite('a@b.com')] }), {} as any);
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Profile not found' });
  });

  it('returns 400 when orgId is missing', async () => {
    const res = await handler(baseReq({ invites: [makeInvite('a@b.com')] }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'orgId is required' });
  });

  it('returns 400 when invites is missing', async () => {
    const res = await handler(baseReq({ orgId: 'org-1' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'invites is required' });
  });

  it('returns 400 when invites is not an array', async () => {
    const res = await handler(baseReq({ orgId: 'org-1', invites: 'not-an-array' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'invites must be an array' });
  });

  it('returns 400 when invites is empty', async () => {
    const res = await handler(baseReq({ orgId: 'org-1', invites: [] }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'invites must not be empty' });
  });

  it('returns 400 when invites exceeds 500 entries', async () => {
    const oversized = [];
    for (let i = 0; i < 501; i += 1) {
      oversized.push(makeInvite(`u${i}@x.com`));
    }
    const res = await handler(baseReq({ orgId: 'org-1', invites: oversized }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'invites must not exceed 500 entries' });
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  it('returns 403 when caller is neither platform admin nor org admin (queryOne never called)', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: false });
    mockIsOrgAdmin.mockResolvedValueOnce(false);
    const res = await handler(baseReq({ orgId: 'org-1', invites: [makeInvite('a@b.com')] }), {} as any);
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Forbidden' });
    expect(mockIsOrgAdmin).toHaveBeenCalledWith('p1', 'org-1');
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  it('happy path: 2 valid invites both succeed (ordered, lowercased, 2 queryOne calls)', async () => {
    mockQueryOne
      .mockResolvedValueOnce(insertedRow('alice@example.com', 'inv-1'))
      .mockResolvedValueOnce(insertedRow('bob@example.com', 'inv-2'));

    const body = {
      orgId: 'org-1',
      invites: [makeInvite('Alice@Example.com'), makeInvite('Bob@Example.com', { role: 'org_admin' })],
    };
    const res = await handler(baseReq(body), {} as any);

    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body as string);
    expect(parsed.results).toHaveLength(2);
    expect(parsed.results[0]).toEqual({
      email: 'alice@example.com',
      success: true,
      invitation: insertedRow('alice@example.com', 'inv-1'),
    });
    expect(parsed.results[1]).toEqual({
      email: 'bob@example.com',
      success: true,
      invitation: insertedRow('bob@example.com', 'inv-2'),
    });
    expect(mockQueryOne).toHaveBeenCalledTimes(2);

    const [sql0, params0] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(sql0).toContain('INSERT INTO invitations');
    expect(sql0).toContain('link_id');
    expect(sql0).not.toMatch(/\btoken\b/);
    expect(sql0).not.toContain('token_hash');
    expect(params0).toEqual(['org-1', 'alice@example.com', 'learner', 'p1', null, null, null]);

    const [, params1] = mockQueryOne.mock.calls[1] as [string, unknown[]];
    expect(params1).toEqual(['org-1', 'bob@example.com', 'org_admin', 'p1', null, null, null]);
  });

  it('mixed batch: valid + invalid-email + duplicate — per-row results in order, queryOne called twice', async () => {
    // First call (valid) succeeds; second call (the duplicate email) rejects with 23505.
    mockQueryOne
      .mockResolvedValueOnce(insertedRow('valid@example.com', 'inv-1'))
      .mockRejectedValueOnce(Object.assign(new Error('duplicate key value'), { code: '23505' }));

    const body = {
      orgId: 'org-1',
      invites: [
        makeInvite('Valid@Example.com'),
        makeInvite('no-at-sign'), // invalid — skipped pre-DB
        makeInvite('Duplicate@Example.com'),
      ],
    };
    const res = await handler(baseReq(body), {} as any);

    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body as string);
    expect(parsed.results).toHaveLength(3);
    expect(parsed.results[0]).toEqual({
      email: 'valid@example.com',
      success: true,
      invitation: insertedRow('valid@example.com', 'inv-1'),
    });
    expect(parsed.results[1]).toEqual({
      email: 'no-at-sign',
      success: false,
      error: 'email is required and must be a valid email address',
    });
    expect(parsed.results[2]).toEqual({
      email: 'duplicate@example.com',
      success: false,
      error: 'An invitation for this email is already pending',
    });
    // Only the valid + duplicate rows hit the DB; the invalid email is skipped.
    expect(mockQueryOne).toHaveBeenCalledTimes(2);
  });

  it('per-row foreign-key violation (23503) surfaces as Organization not found', async () => {
    mockQueryOne.mockRejectedValueOnce(Object.assign(new Error('insert violates fk'), { code: '23503' }));
    const res = await handler(baseReq({ orgId: 'org-1', invites: [makeInvite('a@b.com')] }), {} as any);
    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body as string);
    expect(parsed.results).toEqual([
      { email: 'a@b.com', success: false, error: 'Organization not found' },
    ]);
  });

  it('per-row generic db error surfaces the error message', async () => {
    mockQueryOne.mockRejectedValueOnce(new Error('connection refused'));
    const res = await handler(baseReq({ orgId: 'org-1', invites: [makeInvite('a@b.com')] }), {} as any);
    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body as string);
    expect(parsed.results).toEqual([
      { email: 'a@b.com', success: false, error: 'connection refused' },
    ]);
  });

  it('happy path (org admin): authorizes via isOrgAdmin', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: false });
    mockIsOrgAdmin.mockResolvedValueOnce(true);
    mockQueryOne.mockResolvedValueOnce(insertedRow('a@b.com'));
    const res = await handler(baseReq({ orgId: 'org-1', invites: [makeInvite('a@b.com')] }), {} as any);
    expect(res.status).toBe(200);
    expect(mockIsOrgAdmin).toHaveBeenCalledWith('p1', 'org-1');
    const parsed = JSON.parse(res.body as string);
    expect(parsed.results[0].success).toBe(true);
  });

  it('per-row firstName too long is rejected as per-row failure (no DB call for that row)', async () => {
    mockQueryOne.mockResolvedValueOnce(insertedRow('good@example.com'));
    const body = {
      orgId: 'org-1',
      invites: [
        makeInvite('bad@example.com', { firstName: 'a'.repeat(101) }),
        makeInvite('good@example.com'),
      ],
    };
    const res = await handler(baseReq(body), {} as any);
    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body as string);
    expect(parsed.results[0]).toEqual({
      email: 'bad@example.com',
      success: false,
      error: 'firstName must be a string of 100 characters or fewer',
    });
    expect(parsed.results[1].success).toBe(true);
    expect(mockQueryOne).toHaveBeenCalledTimes(1);
  });
});
