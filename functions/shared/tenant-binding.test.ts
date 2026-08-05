import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockQuery, mockQueryOne, mockClientQuery, mockWithTransaction, mockLockSeatUsage, mockIsAtSeatLimit } =
  vi.hoisted(() => {
    const mockClientQuery = vi.fn();
    return {
      mockQuery: vi.fn(),
      mockQueryOne: vi.fn(),
      mockClientQuery,
      mockWithTransaction: vi.fn(async (cb: (client: { query: typeof mockClientQuery }) => unknown) =>
        cb({ query: mockClientQuery }),
      ),
      mockLockSeatUsage: vi.fn(),
      mockIsAtSeatLimit: vi.fn(),
    };
  });

vi.mock('./db', () => ({
  query: mockQuery,
  queryOne: mockQueryOne,
  withTransaction: mockWithTransaction,
}));
vi.mock('./seats', () => ({
  lockSeatUsage: mockLockSeatUsage,
  isAtSeatLimit: mockIsAtSeatLimit,
}));

import {
  CONSUMER_TENANT_ID,
  isBindableTenant,
  seedTenantBinding,
  selfRegistrationEnabled,
  autoJoinByTenant,
} from './tenant-binding';

const TID = '72f988bf-86f1-41af-91ab-2d7cd011db47';
const ctx = () => ({ warn: vi.fn(), error: vi.fn(), log: vi.fn(), info: vi.fn() });

const findClientCall = (substr: string) =>
  mockClientQuery.mock.calls.find((c) => (c[0] as string).includes(substr));

beforeEach(() => {
  vi.clearAllMocks();
  mockClientQuery.mockResolvedValue({ rows: [] });
});

describe('isBindableTenant', () => {
  it('rejects the shared consumer/MSA tenant', () => {
    expect(isBindableTenant(CONSUMER_TENANT_ID)).toBe(false);
  });
  it('rejects absent / blank tenant ids', () => {
    expect(isBindableTenant(null)).toBe(false);
    expect(isBindableTenant(undefined)).toBe(false);
    expect(isBindableTenant('')).toBe(false);
    expect(isBindableTenant('   ')).toBe(false);
  });
  it('accepts a real tenant GUID', () => {
    expect(isBindableTenant(TID)).toBe(true);
  });
  it('pins the well-known consumer tenant GUID', () => {
    expect(CONSUMER_TENANT_ID).toBe('9188040d-6c67-4c5b-b112-36a304b66dad');
  });
});

describe('seedTenantBinding', () => {
  it('refuses to seed the consumer tenant (no DB write)', async () => {
    await seedTenantBinding('org-1', CONSUMER_TENANT_ID, 'x@outlook.com', ctx() as never);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('seeds tid + email-domain label when the org is unbound and the tid is free', async () => {
    mockQuery.mockResolvedValueOnce([{ id: 'org-1' }]); // UPDATE ... RETURNING id
    const c = ctx();
    await seedTenantBinding('org-1', TID, 'Jane@Acme.COM', c as never);

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('UPDATE organizations');
    expect(sql).toContain('entra_tid IS NULL');
    expect(sql).toContain('NOT EXISTS');
    expect(params).toEqual([TID, 'acme.com', 'org-1']); // label lowercased
    expect(mockQueryOne).not.toHaveBeenCalled(); // seeded → no collision probe
    expect(c.warn).not.toHaveBeenCalled();
  });

  it('derives a null label from an email without a domain', async () => {
    mockQuery.mockResolvedValueOnce([{ id: 'org-1' }]);
    await seedTenantBinding('org-1', TID, 'no-at-sign', ctx() as never);
    expect(mockQuery.mock.calls[0][1]).toEqual([TID, null, 'org-1']);
  });

  it('logs a collision (first-bound-wins) when the tid is already held by another org', async () => {
    mockQuery.mockResolvedValueOnce([]); // 0 rows updated
    mockQueryOne.mockResolvedValueOnce({ id: 'other-org' }); // conflict probe
    const c = ctx();
    await seedTenantBinding('org-1', TID, 'jane@acme.com', c as never);
    expect(c.warn).toHaveBeenCalledTimes(1);
    expect((c.warn as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain('first-bound-wins');
  });

  it('is a silent no-op when already bound to this same org (0 rows, no conflict)', async () => {
    mockQuery.mockResolvedValueOnce([]);
    mockQueryOne.mockResolvedValueOnce(null); // no other org holds it
    const c = ctx();
    await seedTenantBinding('org-1', TID, 'jane@acme.com', c as never);
    expect(c.warn).not.toHaveBeenCalled();
  });

  it('swallows DB errors (seeding must never break login)', async () => {
    mockQuery.mockRejectedValueOnce(new Error('boom'));
    const c = ctx();
    await expect(seedTenantBinding('org-1', TID, 'jane@acme.com', c as never)).resolves.toBeUndefined();
    expect(c.error).toHaveBeenCalled();
  });
});

describe('selfRegistrationEnabled', () => {
  it('is true when the toggle is on', async () => {
    mockQueryOne.mockResolvedValueOnce({ allow_self_registration: true });
    expect(await selfRegistrationEnabled()).toBe(true);
  });
  it('is false when the toggle is off', async () => {
    mockQueryOne.mockResolvedValueOnce({ allow_self_registration: false });
    expect(await selfRegistrationEnabled()).toBe(false);
  });
  it('defaults to ON when the settings row is absent', async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    expect(await selfRegistrationEnabled()).toBe(true);
  });
  it('defaults to ON when the key is absent (null value)', async () => {
    mockQueryOne.mockResolvedValueOnce({ allow_self_registration: null });
    expect(await selfRegistrationEnabled()).toBe(true);
  });
});

describe('autoJoinByTenant', () => {
  it('refuses the consumer tenant (no lookups)', async () => {
    await autoJoinByTenant('profile-1', CONSUMER_TENANT_ID, ctx() as never);
    expect(mockQueryOne).not.toHaveBeenCalled();
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it('no-ops when no org is bound to the tenant', async () => {
    mockQueryOne.mockResolvedValueOnce(null); // org lookup
    await autoJoinByTenant('profile-1', TID, ctx() as never);
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it('no-ops (non-destructive) when the caller already has a membership row', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'org-1' }); // org lookup
    mockQueryOne.mockResolvedValueOnce({ id: 'm1' }); // existing membership (any status)
    await autoJoinByTenant('profile-1', TID, ctx() as never);
    expect(mockWithTransaction).not.toHaveBeenCalled();
    // Master switch never even consulted once a membership exists.
    expect(mockQueryOne).toHaveBeenCalledTimes(2);
  });

  it('no-ops when the master switch is off', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'org-1' }); // org lookup
    mockQueryOne.mockResolvedValueOnce(null); // no membership
    mockQueryOne.mockResolvedValueOnce({ allow_self_registration: false }); // switch off
    await autoJoinByTenant('profile-1', TID, ctx() as never);
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it('joins as a learner when bound, self-reg on, and a seat is free', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'org-1' }); // org lookup
    mockQueryOne.mockResolvedValueOnce(null); // no membership
    mockQueryOne.mockResolvedValueOnce({ allow_self_registration: true }); // switch on
    mockLockSeatUsage.mockResolvedValueOnce({ exists: true, seatLimit: null, activeCount: 0, pendingCount: 0 });
    mockIsAtSeatLimit.mockReturnValueOnce(false);

    await autoJoinByTenant('profile-1', TID, ctx() as never);

    const insert = findClientCall('INSERT INTO org_memberships');
    expect(insert).toBeDefined();
    expect(insert![0]).toContain("'learner'");
    expect(insert![0]).toContain("'active'");
    expect(insert![0]).toContain('ON CONFLICT (org_id, user_id) DO NOTHING');
    expect(insert![1]).toEqual(['org-1', 'profile-1']);
  });

  it('does NOT join when the org is at its seat limit (fallback to org-less)', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'org-1' });
    mockQueryOne.mockResolvedValueOnce(null);
    mockQueryOne.mockResolvedValueOnce({ allow_self_registration: true });
    mockLockSeatUsage.mockResolvedValueOnce({ exists: true, seatLimit: 5, activeCount: 5, pendingCount: 0 });
    mockIsAtSeatLimit.mockReturnValueOnce(true);

    await autoJoinByTenant('profile-1', TID, ctx() as never);
    expect(findClientCall('INSERT INTO org_memberships')).toBeUndefined();
  });

  it('swallows errors (auto-join must never break login)', async () => {
    mockQueryOne.mockRejectedValueOnce(new Error('db down'));
    const c = ctx();
    await expect(autoJoinByTenant('profile-1', TID, c as never)).resolves.toBeUndefined();
    expect(c.error).toHaveBeenCalled();
  });
});
