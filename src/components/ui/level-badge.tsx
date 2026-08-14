import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";

export type CourseLevel = "basic" | "intermediate" | "advanced";

export interface LevelBadgeProps {
  level: CourseLevel;
  className?: string;
}

export const LEVEL_STYLES: Record<CourseLevel, { fg: string; bg: string }> = {
  basic: { fg: "#1e9e6a", bg: "#e7f6ef" },
  intermediate: { fg: "#b07514", bg: "#fbf2dd" },
  advanced: { fg: "#c43d3d", bg: "#fdecec" },
};

const LEVEL_FILLED: Record<CourseLevel, number> = { basic: 1, intermediate: 2, advanced: 3 };

const BAR_HEIGHTS = [5, 8, 11];

export function LevelBadge({ level, className }: LevelBadgeProps) {
  const { t } = useTranslation();
  const { fg, bg } = LEVEL_STYLES[level];
  const filled = LEVEL_FILLED[level];

  return (
    <span
      style={{ color: fg, backgroundColor: bg }}
      className={cn("inline-flex items-center rounded-[6px] px-2.5 py-1 text-[11px] font-bold capitalize", className)}
    >
      <span aria-hidden="true" className="mr-[5px] inline-flex items-end gap-[2px]">
        {BAR_HEIGHTS.map((height, i) => (
          <span
            key={height}
            data-testid="level-bar"
            data-filled={i < filled ? "true" : "false"}
            style={{
              width: 3,
              height,
              borderRadius: 1.5,
              background: "currentColor",
              opacity: i < filled ? 1 : 0.28,
            }}
          />
        ))}
      </span>
      {t(`courses.levels.${level}`)}
    </span>
  );
}
