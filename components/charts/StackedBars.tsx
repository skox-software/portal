import { polyline, stackedLayout, yFor } from "@/lib/chart-math";
import { Axis, axisMoney, FRAME, VIEW } from "./Axis";
import { ChartTip } from "./ChartTip";

export type StackedSeries = { key: string; label: string; parts: number[]; tip: string };
export type ChartLine = { values: (number | null)[]; label: string; color: string };

/**
 * Stacked bars, one per bucket, bottom part first; optionally a line over
 * them (Stripe net). Colors are CSS tokens, passed per part.
 */
export function StackedBars({
  series,
  colors,
  legend,
  line,
  label,
  format = axisMoney,
}: {
  series: StackedSeries[];
  colors: string[];
  legend: string[];
  line?: ChartLine;
  label: string;
  format?: (n: number) => string;
}) {
  const lineMax = Math.max(0, ...(line?.values ?? []).map((v) => v ?? 0));
  const { max, bars, ticks } = stackedLayout(series, FRAME, lineMax);
  const points = line
    ? bars.flatMap((b, i) => (line.values[i] == null ? [] : [[b.center, yFor(line.values[i]!, max, FRAME)] as [number, number]]))
    : [];
  return (
    <div className="fchart-wrap">
      <ul className="fchart-legend">
        {legend.map((name, i) => <li key={name}><i style={{ background: colors[i] }} />{name}</li>)}
        {line && <li><i className="fchart-legend-line" style={{ background: line.color }} />{line.label}</li>}
      </ul>
      <ChartTip>
        <Axis ticks={ticks} labels={series.map((s) => s.label)} format={format} label={label}>
          {bars.map((b, i) => (
            <g key={b.key} data-tip={series[i].tip} className="fchart-bar">
              <title>{series[i].tip}</title>
              <rect x={b.x - b.width * 0.2} y={0} width={b.width * 1.4} height={VIEW.h} fill="transparent" />
              {b.segments.map((s) => s.height > 0 && <rect key={s.index} x={s.x} y={s.y} width={s.width} height={s.height} fill={colors[s.index]} />)}
            </g>
          ))}
          {points.length > 1 && <polyline points={polyline(points)} fill="none" stroke={line!.color} strokeWidth={2} vectorEffect="non-scaling-stroke" className="fchart-line" />}
        </Axis>
      </ChartTip>
    </div>
  );
}
