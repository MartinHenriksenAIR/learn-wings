import { cn } from '@/lib/utils';

/**
 * Shared seat-usage bar for the platform-admin organization screens
 * (OrganizationsManager list rows + OrganizationDetail seat panel).
 *
 * Single danger rule: the fill turns destructive-red once usage reaches or
 * exceeds the enforced limit (`used >= limit`), matching the backend's
 * SEAT_LIMIT_REACHED semantics. Below that it stays navy (`--primary`). This
 * replaces the two divergent prior rules (a 90% trigger in the list, an
 * at/over-100% trigger in the detail panel) with one consistent threshold.
 *
 * Self-guarded math: a falsy / non-positive `limit` is treated as "no limit"
 * (render an empty rail, never NaN/Infinity). Both call sites already gate on a
 * truthy seat_limit before rendering, so this is purely defensive.
 *
 * Hidden from the a11y tree — the "n/m" label rendered beside the bar at each
 * call site carries the meaning.
 */
export function SeatUsageBar({
  used,
  limit,
  className,
}: {
  used: number;
  limit: number | null | undefined;
  className?: string;
}) {
  const hasLimit = typeof limit === 'number' && limit > 0;
  const pct = hasLimit ? Math.min(100, Math.max(0, (used / limit) * 100)) : 0;
  const danger = hasLimit && used >= limit;

  return (
    <span
      aria-hidden="true"
      data-testid="seat-usage-bar"
      // Rail ~#eceef3: a touch lighter than --border/--muted (~#e8e9ef); kept as
      // an explicit hex so the restyle's rail colour is preserved exactly.
      className={cn('block w-full overflow-hidden rounded bg-[#eceef3]', className)}
    >
      <span
        data-testid="seat-usage-bar-fill"
        data-danger={danger ? 'true' : 'false'}
        className="block h-full rounded transition-[width] duration-300"
        style={{
          width: `${pct}%`,
          background: danger ? 'hsl(var(--destructive))' : 'hsl(var(--primary))',
        }}
      />
    </span>
  );
}
