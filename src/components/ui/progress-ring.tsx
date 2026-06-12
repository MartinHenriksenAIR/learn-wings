import { cn } from "@/lib/utils";

export interface ProgressRingProps {
  pct: number;
  size: number;
  stroke: number;
  fg: string;
  bg: string;
  labelColor?: string;
  className?: string;
}

/**
 * SVG progress ring (port of the design prototype's `ring()`): rotated -90deg
 * so progress starts at 12 o'clock, round line caps, animated dashoffset.
 * Renders a centered, counter-rotated percentage label only when `labelColor`
 * is given.
 */
export function ProgressRing({ pct, size, stroke, fg, bg, labelColor, className }: ProgressRingProps) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;

  return (
    <svg width={size} height={size} className={cn("-rotate-90", className)}>
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={bg} strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={fg}
        strokeWidth={stroke}
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - pct / 100)}
        strokeLinecap="round"
        style={{ transition: "stroke-dashoffset .4s" }}
      />
      {labelColor && (
        <text
          x={size / 2}
          y={size / 2}
          fill={labelColor}
          fontSize={size / 4.6}
          fontWeight={800}
          textAnchor="middle"
          dominantBaseline="central"
          transform={`rotate(90 ${size / 2} ${size / 2})`}
        >
          {Math.round(pct)}%
        </text>
      )}
    </svg>
  );
}
