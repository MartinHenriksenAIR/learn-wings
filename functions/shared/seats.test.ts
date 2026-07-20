import { describe, it, expect, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { lockSeatUsage, isAtSeatLimit, seatsRemaining, type SeatUsage } from './seats';

// lockSeatUsage only calls client.query — a minimal mock client is enough.
const mockClient = (queryImpl: ReturnType<typeof vi.fn>) =>
  ({ query: queryImpl }) as unknown as PoolClient;

describe('lockSeatUsage', () => {
  it('returns parsed usage from a row (pg serializes COUNT bigint as string)', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{ seat_limit: 5, active_count: '3', pending_count: '1' }],
    });

    const usage = await lockSeatUsage(mockClient(query), 'org-1');

    expect(usage).toEqual({ exists: true, seatLimit: 5, activeCount: 3, pendingCount: 1 });
  });

  it('returns seatLimit: null unchanged when the org has no cap', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{ seat_limit: null, active_count: '10', pending_count: '2' }],
    });

    const usage = await lockSeatUsage(mockClient(query), 'org-1');

    expect(usage).toEqual({ exists: true, seatLimit: null, activeCount: 10, pendingCount: 2 });
  });

  it('returns exists:false on empty rows (org not found)', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });

    const usage = await lockSeatUsage(mockClient(query), 'missing-org');

    expect(usage).toEqual({ exists: false, seatLimit: null, activeCount: 0, pendingCount: 0 });
  });

  it('locks the organization row FOR UPDATE, counts active memberships and pending invitations, params [orgId]', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{ seat_limit: null, active_count: '0', pending_count: '0' }],
    });

    await lockSeatUsage(mockClient(query), 'org-42');

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('FOR UPDATE');
    expect(sql).toContain(`m.status = 'active'`);
    expect(sql).toContain(`i.status = 'pending'`);
    expect(params).toEqual(['org-42']);
  });
});

describe('isAtSeatLimit', () => {
  const usage = (overrides: Partial<SeatUsage>): SeatUsage => ({
    exists: true,
    seatLimit: null,
    activeCount: 0,
    pendingCount: 0,
    ...overrides,
  });

  it('returns false when seatLimit is null (unlimited)', () => {
    expect(isAtSeatLimit(usage({ seatLimit: null, activeCount: 1000, pendingCount: 1000 }))).toBe(false);
  });

  it('returns false when active + pending is below the limit', () => {
    expect(isAtSeatLimit(usage({ seatLimit: 5, activeCount: 2, pendingCount: 1 }))).toBe(false);
  });

  it('returns true when active + pending equals the limit', () => {
    expect(isAtSeatLimit(usage({ seatLimit: 5, activeCount: 3, pendingCount: 2 }))).toBe(true);
  });

  it('returns true when active + pending exceeds the limit', () => {
    expect(isAtSeatLimit(usage({ seatLimit: 5, activeCount: 4, pendingCount: 3 }))).toBe(true);
  });
});

describe('seatsRemaining', () => {
  const usage = (overrides: Partial<SeatUsage>): SeatUsage => ({
    exists: true,
    seatLimit: null,
    activeCount: 0,
    pendingCount: 0,
    ...overrides,
  });

  it('returns Infinity when seatLimit is null (unlimited)', () => {
    expect(seatsRemaining(usage({ seatLimit: null, activeCount: 1000, pendingCount: 1000 }))).toBe(Infinity);
  });

  it('computes seatLimit - activeCount - pendingCount', () => {
    expect(seatsRemaining(usage({ seatLimit: 10, activeCount: 3, pendingCount: 2 }))).toBe(5);
  });

  it('clamps a negative result to 0', () => {
    expect(seatsRemaining(usage({ seatLimit: 5, activeCount: 4, pendingCount: 3 }))).toBe(0);
  });
});
