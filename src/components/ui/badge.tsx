import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-xs border border-transparent px-2.5 py-0.5 text-xs font-semibold transition-colors duration-fast ease-standard",
  {
    variants: {
      variant: {
        default: "bg-interactive text-white",
        secondary: "bg-interactive-tint text-interactive",
        success: "bg-green-tint text-green-deep",
        progress: "bg-interactive-tint text-interactive",
        warning: "bg-amber-tint text-amber-deep",
        destructive: "bg-red-tint text-red-deep",
        neutral: "bg-surface-sunken text-neutral-700",
        outline: "border-neutral-300 text-neutral-900",
        filter:
          "rounded-full bg-surface-sunken text-neutral-700 aria-pressed:border-interactive aria-pressed:bg-interactive-tint aria-pressed:text-interactive data-[state=active]:border-interactive data-[state=active]:bg-interactive-tint data-[state=active]:text-interactive data-[state=on]:border-interactive data-[state=on]:bg-interactive-tint data-[state=on]:text-interactive",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
