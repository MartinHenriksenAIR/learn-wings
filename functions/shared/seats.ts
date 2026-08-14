import { PoolClient } from 'pg';

export interface SeatUsage {
  exists: boolean; // false when the org row is absent
  seatLimit: number | null; // null = unlimited
  activeCount: number;
  pendingCount: number;
}

export async function lockSeatUsage(client: PoolClient, orgId: string): Promise<SeatUsage> {
  const res = await client.query<{ seat_limit: number | null; active_count: number; pending_count: number }>(
    `SELECT o.seat_limit,
            (SELECT COUNT(*)::int FROM org_memberships m WHERE m.org_id = o.id AND m.status = 'active')  AS active_count,
            (SELECT COUNT(*)::int FROM invitations       i WHERE i.org_id = o.id AND i.status = 'pending') AS pending_count
       FROM organizations o
      WHERE o.id = $1
      FOR UPDATE OF o`,
    [orgId],
  );
  const row = res.rows[0];
  if (!row) return { exists: false, seatLimit: null, activeCount: 0, pendingCount: 0 };
  return {
    exists: true,
    seatLimit: row.seat_limit === null ? null : Number(row.seat_limit),
    activeCount: Number(row.active_count),
    pendingCount: Number(row.pending_count),
  };
}

export function isAtSeatLimit(usage: SeatUsage): boolean {
  return usage.seatLimit !== null && usage.activeCount + usage.pendingCount >= usage.seatLimit;
}

export function seatsRemaining(usage: SeatUsage): number {
  return usage.seatLimit === null ? Infinity : Math.max(0, usage.seatLimit - usage.activeCount - usage.pendingCount);
}
