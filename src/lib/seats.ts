/**
 * Seat-usage math — the single source of truth shared by every "seats used /
 * remaining" surface (org list, org detail, invite dialogs).
 *
 * A seat is consumed by an ACTIVE member OR a PENDING invitation, so both count
 * toward the org's `seat_limit`. This mirrors the backend cap
 * (`functions/shared/seats.ts`): `active_members + pending_invitations` may not
 * exceed `seat_limit`. A `seat_limit` of `null` means unlimited.
 */
export interface SeatUsage {
  /** active members + pending invitations */
  usedSeats: number;
  seatLimit: number | null;
  isUnlimited: boolean;
  /** seats still available, or `null` when unlimited */
  remaining: number | null;
  /** true only for a limited org whose used seats have reached the limit */
  atLimit: boolean;
}

export function getSeatUsage(params: {
  activeMembers: number;
  pendingInvites: number;
  seatLimit: number | null | undefined;
}): SeatUsage {
  const seatLimit = params.seatLimit ?? null;
  const usedSeats = params.activeMembers + params.pendingInvites;
  const isUnlimited = seatLimit === null;
  const remaining = isUnlimited ? null : Math.max(0, seatLimit - usedSeats);
  const atLimit = !isUnlimited && usedSeats >= seatLimit;
  return { usedSeats, seatLimit, isUnlimited, remaining, atLimit };
}
