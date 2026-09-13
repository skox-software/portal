/** A small donut showing how much of the plan is done. Server-rendered SVG. */
export function ProgressRing({ percent, size = 112, label }: { percent: number; size?: number; label: string }) {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  const stroke = 10;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg
      className="ring"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={`${label}: ${clamped}%`}
    >
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--ring-track)" strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--ink)"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${(c * clamped) / 100} ${c}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central" className="ring-text">
        {clamped}%
      </text>
    </svg>
  );
}

/** A tiny trend line for monthly numbers. */
export function Sparkline({ values, width = 120, height = 36 }: { values: (number | null)[]; width?: number; height?: number }) {
  const points = values.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v != null);
  if (points.length < 2) return null;
  const max = Math.max(...points.map((p) => p.v));
  const min = Math.min(...points.map((p) => p.v));
  const span = max - min || 1;
  const step = width / Math.max(values.length - 1, 1);
  const xy = points.map((p) => [p.i * step, height - 4 - ((p.v - min) / span) * (height - 8)] as const);
  const line = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${xy[xy.length - 1][0].toFixed(1)},${height} L${xy[0][0].toFixed(1)},${height} Z`;
  const [lx, ly] = xy[xy.length - 1];
  return (
    <svg className="spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <path d={area} fill="var(--blush)" />
      <path d={line} fill="none" stroke="var(--amber-ink)" strokeWidth="2" />
      <circle cx={lx} cy={ly} r="3" fill="var(--amber-ink)" />
    </svg>
  );
}
