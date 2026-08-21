import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "animate-shimmer rounded-xs bg-neutral-150 bg-[linear-gradient(90deg,var(--neutral-150),var(--neutral-50),var(--neutral-150))] bg-[length:220%_100%] motion-reduce:animate-none motion-reduce:bg-none",
        className,
      )}
      {...props}
    />
  );
}

export { Skeleton };
