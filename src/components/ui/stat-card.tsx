import * as React from "react";

import { cn } from "@/lib/utils";

export interface StatCardProps {
  icon: React.ReactNode;
  value: React.ReactNode;
  label: React.ReactNode;
  extra?: React.ReactNode;
  onClick?: () => void;
  className?: string;
}

/**
 * Dashboard stat card: 42px tinted icon chip, big value, small label.
 * When `extra` is given the card lifts on hover and expands a hidden panel
 * with one extra info line. When `onClick` is given the whole card is
 * clickable and keyboard accessible.
 */
export function StatCard({ icon, value, label, extra, onClick, className }: StatCardProps) {
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!onClick) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onClick();
    }
  };

  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onClick ? handleKeyDown : undefined}
      className={cn(
        "group rounded-2xl border border-border bg-card px-5 py-[18px]",
        extra != null &&
          "transition-[transform,box-shadow] duration-200 hover:-translate-y-[3px] hover:shadow-[0_12px_30px_rgba(20,24,46,0.10)]",
        onClick &&
          "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        className,
      )}
    >
      <div className="flex items-center gap-3.5">
        <span className="grid h-[42px] w-[42px] shrink-0 place-items-center rounded-xl bg-accent text-primary">
          {icon}
        </span>
        <span className="flex min-w-0 flex-col gap-px">
          <span className="text-[22px] font-extrabold tracking-[-0.02em]">{value}</span>
          <span className="whitespace-nowrap text-[12.5px] font-medium text-muted-foreground">{label}</span>
        </span>
      </div>
      {extra != null && (
        <div
          data-testid="stat-card-extra"
          className="max-h-0 overflow-hidden text-xs leading-normal text-muted-foreground opacity-0 transition-[max-height,opacity,margin-top] duration-[280ms] ease-out group-hover:mt-[11px] group-hover:max-h-[84px] group-hover:opacity-100"
        >
          {extra}
        </div>
      )}
    </div>
  );
}
