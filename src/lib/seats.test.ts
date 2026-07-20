import { describe, it, expect } from 'vitest';
import { getSeatUsage } from './seats';

describe('getSeatUsage', () => {
  it('counts active members AND pending invites as used seats', () => {
    const usage = getSeatUsage({ activeMembers: 3, pendingInvites: 2, seatLimit: 10 });
    expect(usage.usedSeats).toBe(5);
    expect(usage.remaining).toBe(5);
    expect(usage.atLimit).toBe(false);
    expect(usage.isUnlimited).toBe(false);
  });

  it('is at limit (and clamps remaining to 0) once used seats reach the limit', () => {
    const usage = getSeatUsage({ activeMembers: 8, pendingInvites: 2, seatLimit: 10 });
    expect(usage.usedSeats).toBe(10);
    expect(usage.remaining).toBe(0);
    expect(usage.atLimit).toBe(true);
  });

  it('reports at limit and never a negative remaining when over the limit', () => {
    const usage = getSeatUsage({ activeMembers: 9, pendingInvites: 4, seatLimit: 10 });
    expect(usage.usedSeats).toBe(13);
    expect(usage.remaining).toBe(0);
    expect(usage.atLimit).toBe(true);
  });

  it('treats a null seat limit as unlimited (never at limit, no remaining number)', () => {
    const usage = getSeatUsage({ activeMembers: 50, pendingInvites: 10, seatLimit: null });
    expect(usage.usedSeats).toBe(60);
    expect(usage.isUnlimited).toBe(true);
    expect(usage.remaining).toBeNull();
    expect(usage.atLimit).toBe(false);
  });

  it('treats an undefined seat limit as unlimited', () => {
    const usage = getSeatUsage({ activeMembers: 1, pendingInvites: 0, seatLimit: undefined });
    expect(usage.isUnlimited).toBe(true);
    expect(usage.remaining).toBeNull();
  });
});
