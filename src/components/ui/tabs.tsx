import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";

import { cn } from "@/lib/utils";

const Tabs = TabsPrimitive.Root;

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, children, ...props }, ref) => {
  const listRef = React.useRef<HTMLDivElement | null>(null);
  const [thumb, setThumb] = React.useState<{ left: number; width: number } | null>(null);

  const measure = React.useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    const active = list.querySelector<HTMLElement>('[role="tab"][data-state="active"]');
    if (!active) {
      setThumb(null);
      return;
    }
    const next = { left: active.offsetLeft, width: active.offsetWidth };
    setThumb((prev) => (prev && prev.left === next.left && prev.width === next.width ? prev : next));
  }, []);

  React.useLayoutEffect(() => {
    measure();
    const list = listRef.current;
    if (!list) return;
    const mutation = new MutationObserver(measure);
    mutation.observe(list, { attributes: true, attributeFilter: ["data-state"], childList: true, subtree: true });
    let resize: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      resize = new ResizeObserver(measure);
      resize.observe(list);
    }
    return () => {
      mutation.disconnect();
      resize?.disconnect();
    };
  }, [measure]);

  const setRefs = (node: HTMLDivElement | null) => {
    listRef.current = node;
    if (typeof ref === "function") ref(node);
    else if (ref) ref.current = node;
  };

  return (
    <TabsPrimitive.List
      ref={setRefs}
      className={cn(
        "relative inline-flex h-10 items-center justify-center rounded-full border border-neutral-150 bg-surface-sunken p-[3px] text-neutral-700",
        className,
      )}
      {...props}
    >
      {thumb && (
        <span
          aria-hidden="true"
          data-testid="tabs-thumb"
          className="absolute inset-y-[3px] rounded-full border border-neutral-150 bg-white transition-[left,width] duration-base ease-standard motion-reduce:transition-none"
          style={{ left: thumb.left, width: thumb.width, boxShadow: "0 1px 3px rgba(9, 12, 32, 0.1)" }}
        />
      )}
      {children}
    </TabsPrimitive.List>
  );
});
TabsList.displayName = TabsPrimitive.List.displayName;

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "relative inline-flex items-center justify-center whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-semibold transition-colors duration-base ease-standard data-[state=active]:text-interactive disabled:pointer-events-none disabled:opacity-45",
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content ref={ref} className={cn("mt-2", className)} {...props} />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsList, TabsTrigger, TabsContent };
