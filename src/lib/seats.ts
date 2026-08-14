export interface SeatUsage {
  usedSeats: number;
  seatLimit: number | null;
  isUnlimited: boolean;
  remaining: number | null;
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
