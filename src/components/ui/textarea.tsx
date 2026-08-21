import * as React from "react";

import { cn } from "@/lib/utils";

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        "flex min-h-[80px] w-full rounded-sm border border-neutral-300 bg-surface px-3 py-2 text-sm transition-colors duration-fast ease-standard placeholder:text-neutral-500 hover:border-neutral-500 disabled:cursor-not-allowed disabled:border-neutral-150 disabled:bg-surface-sunken disabled:text-neutral-600",
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});
Textarea.displayName = "Textarea";

export { Textarea };
