import { cn } from '@/lib/utils';

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
