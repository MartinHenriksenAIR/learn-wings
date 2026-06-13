import * as React from "react";

import { cn } from "@/lib/utils";

export interface SlidingTabItem {
  key: string;
  label: React.ReactNode;
  icon?: React.ReactNode;
  disabled?: boolean;
}

export interface SlidingTabsProps {
  tabs: SlidingTabItem[];
  active: string;
  onChange: (key: string) => void;
  className?: string;
}

/**
 * Segmented tab bar with a white indicator that slides under the active tab.
 * Controlled: the indicator position derives from the `active` prop; callers
 * own the state (and any URL sync). Port of the design prototype's
 * SlidingTabs, minus the rAF watchdog (a capture-iframe workaround).
 *
 * Implements the ARIA tabs keyboard pattern with selection-follows-focus:
 * roving tabindex (only the active tab is in the tab order), ArrowLeft /
 * ArrowRight wrap through enabled tabs, Home / End jump to the first / last
 * enabled tab, and disabled tabs are skipped.
 */
export function SlidingTabs({ tabs, active, onChange, className }: SlidingTabsProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const btnRefs = React.useRef<Record<string, HTMLButtonElement | null>>({});
  const [indicator, setIndicator] = React.useState<{ left: number; width: number } | null>(null);

  const measure = React.useCallback(() => {
    const el = btnRefs.current[active];
    if (!el) {
      setIndicator(null);
      return;
    }
    const left = el.offsetLeft;
    const width = el.offsetWidth;
    setIndicator((prev) => (prev && prev.left === left && prev.width === width ? prev : { left, width }));
  }, [active]);

  // Re-measure whenever the active tab or the tab set changes.
  React.useLayoutEffect(() => {
    measure();
  }, [measure, tabs]);

  // Re-measure when the container resizes (labels wrap, fonts load, window resizes).
  React.useLayoutEffect(() => {
    const node = containerRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(node);
    return () => observer.disconnect();
  }, [measure]);

  // ARIA tabs keyboard pattern (selection follows focus): arrows wrap through
  // enabled tabs, Home/End jump to the first/last enabled tab.
  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const { key } = event;
    if (key !== "ArrowLeft" && key !== "ArrowRight" && key !== "Home" && key !== "End") return;
    event.preventDefault();

    const enabledKeys = tabs.filter((tab) => !tab.disabled).map((tab) => tab.key);
    if (enabledKeys.length === 0) return;

    let nextKey: string;
    if (key === "Home") {
      nextKey = enabledKeys[0];
    } else if (key === "End") {
      nextKey = enabledKeys[enabledKeys.length - 1];
    } else {
      const delta = key === "ArrowRight" ? 1 : -1;
      const currentIndex = enabledKeys.indexOf(active);
      nextKey =
        currentIndex === -1
          ? enabledKeys[delta === 1 ? 0 : enabledKeys.length - 1]
          : enabledKeys[(currentIndex + delta + enabledKeys.length) % enabledKeys.length];
    }

    if (nextKey !== active) onChange(nextKey);
    btnRefs.current[nextKey]?.focus();
  };

  return (
    <div
      ref={containerRef}
      role="tablist"
      className={cn("relative inline-flex gap-0.5 rounded-xl bg-muted p-1", className)}
    >
      {indicator && (
        <div
          aria-hidden="true"
          data-testid="sliding-tabs-indicator"
          className="absolute rounded-[8px] bg-white"
          style={{
            top: 4,
            bottom: 4,
            left: indicator.left,
            width: indicator.width,
            boxShadow: "0 2px 8px rgba(20,24,46,0.10)",
            transition: "left .28s cubic-bezier(.4,0,.2,1), width .28s cubic-bezier(.4,0,.2,1)",
          }}
        />
      )}
      {tabs.map((tab) => (
        <button
          key={tab.key}
          ref={(el) => {
            btnRefs.current[tab.key] = el;
          }}
          type="button"
          role="tab"
          aria-selected={tab.key === active}
          tabIndex={tab.key === active ? 0 : -1}
          disabled={tab.disabled}
          onClick={() => onChange(tab.key)}
          onKeyDown={handleKeyDown}
          className={cn(
            "relative z-[1] inline-flex cursor-pointer items-center gap-[7px] whitespace-nowrap rounded-[8px] border-0 bg-transparent px-4 py-2 text-[13px] font-bold transition-colors duration-[220ms]",
            tab.key === active ? "text-primary" : "text-[#686d7e]",
            "disabled:cursor-default disabled:text-[#b3b8c6]",
          )}
        >
          {tab.icon}
          {tab.label}
        </button>
      ))}
    </div>
  );
}
