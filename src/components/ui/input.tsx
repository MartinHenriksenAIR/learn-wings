import * as React from "react";

import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-10 w-full rounded-sm border border-neutral-300 bg-surface px-3 py-2 text-base transition-colors duration-fast ease-standard file:border-0 file:bg-transparent file:text-sm file:font-semibold file:text-neutral-900 placeholder:text-neutral-500 hover:border-neutral-500 disabled:cursor-not-allowed disabled:border-neutral-150 disabled:bg-surface-sunken disabled:text-neutral-600 md:text-sm",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
