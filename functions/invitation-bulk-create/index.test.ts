import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuthenticate, MockAuthError, mockWithTransaction, mockGetProfile, mockIsOrgAdmin } = vi.hoisted(() => {
  class MockAuthError extends Error {}
  return {
    mockAuthenticate: vi.fn(), MockAuthError,
    mockWithTransaction: vi.fn(),
    mockGetProfile: vi.fn(), mockIsOrgAdmin: vi.fn(),
  };
});
vi.mock('../shared/auth', () => ({ authenticate: mockAuthenticate, AuthError: MockAuthError }));
vi.mock('../shared/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../shared/db')>()),
  query: vi.fn(),
  queryOne: vi.fn(),
  withTransaction: mockWithTransaction,
}));
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

// Seat-usage lookup row shape (org row + active-member/pending-invite counts).
const seatRow = (seat_limit: number | null, active_count: number, pending_count: number) => ({ seat_limit, active_count, pending_count });

type InsertOutcome = { ok: true; row: unknown } | { ok: false; err: unknown };

// A fake PoolClient whose .query answers control statements (SAVEPOINT/RELEASE/
// ROLLBACK), the FOR UPDATE seat lookup, and the sequential INSERTs (from the
// outcome list, in order). `seat === null` models an absent org row.
function makeClient(seat: ReturnType<typeof seatRow> | null, insertOutcomes: InsertOutcome[] = []) {
  let i = 0;
  return {
    query: vi.fn(async (sql: string) => {
      const s = String(sql).trim();
      if (/^(SAVEPOINT|RELEASE|ROLLBACK)/.test(s)) return { rows: [] };
      if (s.includes('FOR UPDATE')) return { rows: seat ? [seat] : [] };
      if (s.includes('INSERT INTO invitations')) {
        const o = insertOutcomes[i++];
        if (o && o.ok === false) throw o.err;
        return { rows: [o ? o.row : {}] };
      }
      return { rows: [] };
    }),
  };
}

// Wire withTransaction to invoke the handler callback with a fresh fake client.
function wire(seat: ReturnType<typeof seatRow> | null, insertOutcomes: InsertOutcome[] = []) {
  const client = makeClient(seat, insertOutcomes);
  mockWithTransaction.mockImplementation(async (cb: (c: typeof client) => unknown) => cb(client));
  return client;
}

describe('invitation-bulk-create', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: unlimited seats, no queued INSERT outcomes. Tests override via wire().
    wire(seatRow(null, 0, 0));
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

  it('returns 400 when orgId is missing (no transaction opened)', async () => {
    const res = await handler(baseReq({ invites: [makeInvite('a@b.com')] }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'orgId is required' });
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it('returns 400 when invites is missing', async () => {
    const res = await handler(baseReq({ orgId: 'org-1' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'invites is required' });
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it('returns 400 when invites is not an array', async () => {
    const res = await handler(baseReq({ orgId: 'org-1', invites: 'not-an-array' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'invites must be an array' });
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it('returns 400 when invites is empty', async () => {
    const res = await handler(baseReq({ orgId: 'org-1', invites: [] }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'invites must not be empty' });
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it('returns 400 when invites exceeds 500 entries (no transaction opened)', async () => {
    const oversized = [];
    for (let i = 0; i < 501; i += 1) {
      oversized.push(makeInvite(`u${i}@x.com`));
    }
    const res = await handler(baseReq({ orgId: 'org-1', invites: oversized }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'invites must not exceed 500 entries' });
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it('returns 403 when caller is neither platform admin nor org admin (no transaction opened)', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: false });
    mockIsOrgAdmin.mockResolvedValueOnce(false);
    const res = await handler(baseReq({ orgId: 'org-1', invites: [makeInvite('a@b.com')] }), {} as any);
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Forbidden' });
    expect(mockIsOrgAdmin).toHaveBeenCalledWith('p1', 'org-1');
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it('happy path: 2 valid invites both succeed (ordered, lowercased, correct params)', async () => {
    const client = wire(seatRow(10, 0, 0), [
      { ok: true, row: insertedRow('alice@example.com', 'inv-1') },
      { ok: true, row: insertedRow('bob@example.com', 'inv-2') },
    ]);

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

    // First query is the seat-usage lookup (row lock).
    const [seatSql, seatParams] = client.query.mock.calls[0] as [string, unknown[]];
    expect(seatSql).toContain('FOR UPDATE');
    expect(seatParams).toEqual(['org-1']);

    // INSERT calls carry the normalized email + invited_by_user_id.
    const insertCalls = client.query.mock.calls.filter((c) => String(c[0]).includes('INSERT INTO invitations'));
    expect(insertCalls).toHaveLength(2);
    const [sql0, params0] = insertCalls[0] as [string, unknown[]];
    expect(sql0).toContain('link_id');
    expect(sql0).not.toMatch(/\btoken\b/);
    expect(sql0).not.toContain('token_hash');
    expect(params0).toEqual(['org-1', 'alice@example.com', 'learner', 'p1', null, null, null]);
    const [, params1] = insertCalls[1] as [string, unknown[]];
    expect(params1).toEqual(['org-1', 'bob@example.com', 'org_admin', 'p1', null, null, null]);
  });

  it('partial-fill: seats run out mid-batch — earlier rows succeed, later valid rows hit the seat limit (order preserved)', async () => {
    // seat_limit 5, active 3, pending 1 => remaining 1. Only the first valid row fits.
    const client = wire(seatRow(5, 3, 1), [
      { ok: true, row: insertedRow('first@example.com', 'inv-1') },
    ]);

    const body = {
      orgId: 'org-1',
      invites: [makeInvite('First@Example.com'), makeInvite('Second@Example.com'), makeInvite('Third@Example.com')],
    };
    const res = await handler(baseReq(body), {} as any);

    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body as string);
    expect(parsed.results).toEqual([
      { email: 'first@example.com', success: true, invitation: insertedRow('first@example.com', 'inv-1') },
      { email: 'second@example.com', success: false, error: 'Organization is at seat limit', code: 'SEAT_LIMIT_REACHED' },
      { email: 'third@example.com', success: false, error: 'Organization is at seat limit', code: 'SEAT_LIMIT_REACHED' },
    ]);
    // Exactly one INSERT was attempted (the two over-cap rows never touch the DB).
    const insertCalls = client.query.mock.calls.filter((c) => String(c[0]).includes('INSERT INTO invitations'));
    expect(insertCalls).toHaveLength(1);
  });

  it('null seat_limit: unlimited — all rows succeed regardless of count', async () => {
    const client = wire(seatRow(null, 1000, 1000), [
      { ok: true, row: insertedRow('a@example.com', 'inv-1') },
      { ok: true, row: insertedRow('b@example.com', 'inv-2') },
      { ok: true, row: insertedRow('c@example.com', 'inv-3') },
    ]);
    const body = {
      orgId: 'org-1',
      invites: [makeInvite('a@example.com'), makeInvite('b@example.com'), makeInvite('c@example.com')],
    };
    const res = await handler(baseReq(body), {} as any);
    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body as string);
    expect(parsed.results.every((r: { success: boolean }) => r.success)).toBe(true);
    const insertCalls = client.query.mock.calls.filter((c) => String(c[0]).includes('INSERT INTO invitations'));
    expect(insertCalls).toHaveLength(3);
  });

  it('invalid rows fail validation and do NOT consume a seat — a later valid row still succeeds within remaining', async () => {
    // remaining 1: only one valid row fits. The two invalid rows must not eat the seat.
    const client = wire(seatRow(5, 4, 0), [
      { ok: true, row: insertedRow('good@example.com', 'inv-1') },
    ]);
    const body = {
      orgId: 'org-1',
      invites: [
        makeInvite('no-at-sign'), // invalid email
        makeInvite('bad-role@example.com', { role: 'super_admin' }), // invalid role
        makeInvite('Good@Example.com'), // valid — should still succeed
      ],
    };
    const res = await handler(baseReq(body), {} as any);
    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body as string);
    expect(parsed.results[0]).toEqual({ email: 'no-at-sign', success: false, error: 'email is required and must be a valid email address' });
    expect(parsed.results[1]).toEqual({ email: 'bad-role@example.com', success: false, error: 'role must be one of: org_admin, learner' });
    expect(parsed.results[2]).toEqual({ email: 'good@example.com', success: true, invitation: insertedRow('good@example.com', 'inv-1') });
    // Only the valid row hit the DB.
    const insertCalls = client.query.mock.calls.filter((c) => String(c[0]).includes('INSERT INTO invitations'));
    expect(insertCalls).toHaveLength(1);
  });

  it('per-row firstName too long is a validation failure (no INSERT for that row, no seat consumed)', async () => {
    const client = wire(seatRow(5, 0, 0), [
      { ok: true, row: insertedRow('good@example.com', 'inv-1') },
    ]);
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
    expect(parsed.results[0]).toEqual({ email: 'bad@example.com', success: false, error: 'firstName must be a string of 100 characters or fewer' });
    expect(parsed.results[1].success).toBe(true);
    const insertCalls = client.query.mock.calls.filter((c) => String(c[0]).includes('INSERT INTO invitations'));
    expect(insertCalls).toHaveLength(1);
  });

  it('duplicate pending (23505) rolls back to its savepoint and the batch continues', async () => {
    const client = wire(seatRow(null, 0, 0), [
      { ok: false, err: Object.assign(new Error('duplicate key value violates unique constraint "invitations_pending_unique_per_org"'), { code: '23505' }) },
      { ok: true, row: insertedRow('valid@example.com', 'inv-2') },
    ]);
    const body = {
      orgId: 'org-1',
      invites: [makeInvite('Dup@Example.com'), makeInvite('Valid@Example.com')],
    };
    const res = await handler(baseReq(body), {} as any);
    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body as string);
    expect(parsed.results[0]).toEqual({ email: 'dup@example.com', success: false, error: 'An invitation for this email is already pending' });
    expect(parsed.results[1]).toEqual({ email: 'valid@example.com', success: true, invitation: insertedRow('valid@example.com', 'inv-2') });

    // A ROLLBACK TO SAVEPOINT was issued to recover the poisoned transaction state.
    const rolledBack = client.query.mock.calls.some((c) => /ROLLBACK TO SAVEPOINT/i.test(String(c[0])));
    expect(rolledBack).toBe(true);
  });

  it('per-row foreign-key violation (23503) surfaces as Organization not found and the batch continues', async () => {
    const client = wire(seatRow(null, 0, 0), [
      { ok: false, err: Object.assign(new Error('insert violates fk'), { code: '23503' }) },
    ]);
    const res = await handler(baseReq({ orgId: 'org-1', invites: [makeInvite('a@b.com')] }), {} as any);
    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body as string);
    expect(parsed.results).toEqual([{ email: 'a@b.com', success: false, error: 'Organization not found' }]);
    const rolledBack = client.query.mock.calls.some((c) => /ROLLBACK TO SAVEPOINT/i.test(String(c[0])));
    expect(rolledBack).toBe(true);
  });

  it('org absent (seat lookup returns no row): every valid row is Organization not found; invalid rows keep their validation error', async () => {
    const client = wire(null, []); // org row missing
    const body = {
      orgId: 'org-1',
      invites: [makeInvite('a@b.com'), makeInvite('no-at-sign'), makeInvite('c@b.com')],
    };
    const res = await handler(baseReq(body), {} as any);
    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body as string);
    expect(parsed.results).toEqual([
      { email: 'a@b.com', success: false, error: 'Organization not found' },
      { email: 'no-at-sign', success: false, error: 'email is required and must be a valid email address' },
      { email: 'c@b.com', success: false, error: 'Organization not found' },
    ]);
    // No INSERT is ever attempted when the org is absent.
    const insertCalls = client.query.mock.calls.filter((c) => String(c[0]).includes('INSERT INTO invitations'));
    expect(insertCalls).toHaveLength(0);
  });

  it('per-row generic db error logs server-side and returns a constant message (no CWE-209 leak)', async () => {
    const client = wire(seatRow(null, 0, 0), [
      { ok: false, err: new Error('connection refused') },
    ]);
    const ctx = { error: vi.fn() } as any;
    const res = await handler(baseReq({ orgId: 'org-1', invites: [makeInvite('a@b.com')] }), ctx);
    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body as string);
    expect(parsed.results).toEqual([{ email: 'a@b.com', success: false, error: 'Could not create invitation' }]);
    // Raw driver text never reaches the client...
    expect(res.body as string).not.toContain('connection refused');
    // ...but is logged server-side for App Insights.
    expect(ctx.error).toHaveBeenCalledOnce();
    expect(String(ctx.error.mock.calls[0][0])).toContain('connection refused');
    // Recovery via savepoint even for unexpected errors.
    const rolledBack = client.query.mock.calls.some((c) => /ROLLBACK TO SAVEPOINT/i.test(String(c[0])));
    expect(rolledBack).toBe(true);
  });

  it('happy path (org admin): authorizes via isOrgAdmin', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: false });
    mockIsOrgAdmin.mockResolvedValueOnce(true);
    wire(seatRow(null, 0, 0), [{ ok: true, row: insertedRow('a@b.com') }]);
    const res = await handler(baseReq({ orgId: 'org-1', invites: [makeInvite('a@b.com')] }), {} as any);
    expect(res.status).toBe(200);
    expect(mockIsOrgAdmin).toHaveBeenCalledWith('p1', 'org-1');
    const parsed = JSON.parse(res.body as string);
    expect(parsed.results[0].success).toBe(true);
  });
});
