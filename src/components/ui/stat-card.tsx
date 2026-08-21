import * as React from "react";

import { cn } from "@/lib/utils";

export interface StatCardProps {
  icon: React.ReactNode;
  value: React.ReactNode;
  label: React.ReactNode;
  onClick?: () => void;
  className?: string;
}

export function StatCard({ icon, value, label, onClick, className }: StatCardProps) {
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
        "rounded-legacy-2xl border border-legacy-border bg-legacy-card px-5 py-[18px]",
        onClick &&
          "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-legacy-ring focus-visible:ring-offset-2",
        className,
      )}
    >
      <div className="flex items-center gap-3.5">
        <span className="grid h-[42px] w-[42px] shrink-0 place-items-center rounded-legacy-xl bg-legacy-accent text-legacy-primary">
          {icon}
        </span>
        <span className="flex min-w-0 flex-col gap-px">
          <span className="text-[22px] font-extrabold tracking-[-0.02em]">{value}</span>
          <span className="whitespace-nowrap text-[12.5px] font-medium text-legacy-muted-foreground">{label}</span>
        </span>
      </div>
    </div>
  );
}
