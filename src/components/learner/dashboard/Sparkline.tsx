import { DASH_ACCENT_1 } from './palette';

const W = 200;
const H = 60;
const PAD = 8;

function smoothPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M0,${points[0].y} L${W},${points[0].y}`;

  let d = `M${points[0].x},${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
  }
  return d;
}

export function Sparkline({ values }: { values: number[] }) {
  const max = Math.max(...values, 0);
  const flat = max <= 0;

  const points = values.map((v, i) => ({
    x: values.length > 1 ? (i / (values.length - 1)) * W : 0,
    y: flat ? H - PAD / 2 : H - PAD - (v / max) * (H - PAD * 2),
  }));

  const line = smoothPath(points);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true" className="h-[84px] w-full">
      <defs>
        <linearGradient id="dashboard-spark-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={DASH_ACCENT_1} stopOpacity="0.55" />
          <stop offset="100%" stopColor={DASH_ACCENT_1} stopOpacity="0" />
        </linearGradient>
      </defs>
      {flat ? (
        <path d={line} fill="none" stroke="hsl(var(--legacy-border))" strokeWidth="2.5" />
      ) : (
        <>
          <path d={`${line} L${W},${H} L0,${H} Z`} fill="url(#dashboard-spark-fill)" />
          <path d={line} fill="none" stroke={DASH_ACCENT_1} strokeWidth="2.6" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}
