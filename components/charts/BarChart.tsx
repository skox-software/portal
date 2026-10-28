import { barLayout } from "@/lib/chart-math";
import { Axis, axisMoney, FRAME, VIEW } from "./Axis";
import { ChartTip } from "./ChartTip";

export type BarSeries = { key: string; label: string; value: number; tip: string };

/** One bar per item, a single color token. */
export function BarChart({
  series,
  color = "var(--accent)",
  label,
  format = axisMoney,
}: {
  series: BarSeries[];
  color?: string;
  label: string;
  format?: (n: number) => string;
}) {
  const { bars, ticks } = barLayout(series, FRAME);
  return (
    <ChartTip>
      <Axis ticks={ticks} labels={series.map((s) => s.label)} format={format} label={label}>
        {bars.map((b, i) => (
          <g key={b.key} data-tip={series[i].tip} className="fchart-bar">
            <title>{series[i].tip}</title>
            <rect x={b.x - b.width * 0.2} y={0} width={b.width * 1.4} height={VIEW.h} fill="transparent" />
            {b.height > 0 && <rect x={b.x} y={b.y} width={b.width} height={b.height} fill={color} />}
          </g>
        ))}
      </Axis>
    </ChartTip>
  );
}
