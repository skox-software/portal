import type { ReactNode } from "react";

/**
 * The frame every bar chart sits in. The SVG stretches to the plot box
 * (preserveAspectRatio="none"), so the axis labels are HTML: they stay
 * readable at phone width instead of shrinking with the drawing.
 */
export const VIEW = { w: 1000, h: 300 };
export const FRAME = { w: VIEW.w, h: VIEW.h, pad: { top: 8, right: 0, bottom: 0, left: 0 } };

export function Axis({
  ticks,
  labels,
  format,
  label,
  children,
}: {
  ticks: { value: number; y: number }[];
  labels: string[];
  format: (n: number) => string;
  label: string;
  children: ReactNode;
}) {
  // Roughly eight x labels at most, always including the first.
  const every = Math.max(1, Math.ceil(labels.length / 8));
  return (
    <figure className="fchart" aria-label={label}>
      <div className="fchart-y" aria-hidden="true">
        {ticks.map((t) => (
          <span key={t.value} style={{ top: `${(t.y / VIEW.h) * 100}%` }}>{format(t.value)}</span>
        ))}
      </div>
      <div className="fchart-plot">
        <svg viewBox={`0 0 ${VIEW.w} ${VIEW.h}`} preserveAspectRatio="none" role="img" aria-label={label}>
          {ticks.map((t) => (
            <line key={t.value} x1={0} x2={VIEW.w} y1={t.y} y2={t.y} className="fchart-grid" vectorEffect="non-scaling-stroke" />
          ))}
          {children}
        </svg>
      </div>
      <div className="fchart-x" aria-hidden="true" style={{ gridTemplateColumns: `repeat(${labels.length || 1}, minmax(0, 1fr))` }}>
        {labels.map((l, i) => <span key={i}>{i % every === 0 ? l : ""}</span>)}
      </div>
    </figure>
  );
}

/** Compact money for axis ticks: $0, $900, $2.5k, $1.2M. */
export function axisMoney(cents: number) {
  const d = cents / 100;
  if (d >= 1_000_000) return `$${trim(d / 1_000_000)}M`;
  if (d >= 1_000) return `$${trim(d / 1_000)}k`;
  return `$${Math.round(d)}`;
}

export function axisCount(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function trim(n: number) {
  return n >= 10 ? Math.round(n).toString() : n.toFixed(1).replace(/\.0$/, "");
}
