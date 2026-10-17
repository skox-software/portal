"use client";

import { useRef, useState, type PointerEvent, type ReactNode } from "react";

/**
 * Hover tooltips for the server-drawn charts. Any element inside with a
 * `data-tip` attribute shows its text above itself. Bars also carry an SVG
 * `<title>`, so the numbers are there without JavaScript too.
 */
export function ChartTip({ children }: { children: ReactNode }) {
  const zone = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);

  function show(event: PointerEvent<HTMLDivElement>) {
    const target = (event.target as Element).closest("[data-tip]");
    const box = zone.current?.getBoundingClientRect();
    if (!target || !box) return setTip(null);
    const r = target.getBoundingClientRect();
    // Keep the bubble inside the chart on narrow screens.
    const x = Math.min(Math.max(r.left + r.width / 2 - box.left, 70), box.width - 70);
    setTip({ text: target.getAttribute("data-tip") ?? "", x, y: Math.max(r.top - box.top, 0) });
  }

  return (
    <div ref={zone} className="fchart-zone" onPointerOver={show} onPointerLeave={() => setTip(null)}>
      {children}
      {tip && <div className="fchart-tip" style={{ left: tip.x, top: tip.y }} aria-hidden="true">{tip.text}</div>}
    </div>
  );
}
