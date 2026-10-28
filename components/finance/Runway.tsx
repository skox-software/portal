import { ChartTip } from "@/components/charts/ChartTip";
import { axisMoney } from "@/components/charts/Axis";
import { niceExtent } from "@/lib/chart-math";
import { monthEnd, type BalancePoint, type ProjectedPoint } from "@/lib/forecast-math";
import { formatMoney } from "@/lib/format";

const W = 1000;
const H = 240;

const day = (iso: string, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", ...opts });
const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Balance so far (solid) and the next 60 days (dotted), with the gap
 * between "everyone pays on time" and "nobody pays" hatched. Month ends in
 * the projection are labelled. Server SVG; every day has a tooltip.
 */
export function Runway({
  history,
  projection,
  sourceLabel,
}: {
  history: BalancePoint[];
  projection: ProjectedPoint[];
  sourceLabel: string;
}) {
  const n = history.length + projection.length;
  const values = [...history.map((p) => p.cents), ...projection.flatMap((p) => [p.expected, p.floor])];
  const { lo, hi } = niceExtent(values);
  const x = (i: number) => (n > 1 ? (i / (n - 1)) * W : 0);
  const y = (v: number) => ((hi - v) / (hi - lo || 1)) * H;
  const zero = y(0);
  const ticks = [0, 1, 2, 3, 4].map((k) => lo + ((hi - lo) * k) / 4);
  const todayIndex = history.length - 1;
  const today = history[todayIndex];

  const line = (pts: [number, number][]) => pts.map(([px, py], i) => `${i ? "L" : "M"}${r1(px)},${r1(py)}`).join(" ");
  const histPts = history.map((p, i) => [x(i), y(p.cents)] as [number, number]);
  const expPts = [[x(todayIndex), y(today.cents)] as [number, number], ...projection.map((p, i) => [x(todayIndex + 1 + i), y(p.expected)] as [number, number])];
  const floorPts = [[x(todayIndex), y(today.cents)] as [number, number], ...projection.map((p, i) => [x(todayIndex + 1 + i), y(p.floor)] as [number, number])];
  const area = (pts: [number, number][]) => (pts.length > 1 ? `${line(pts)} L${r1(pts.at(-1)![0])},${r1(zero)} L${r1(pts[0][0])},${r1(zero)} Z` : "");
  const gap = `${line(expPts)} ${floorPts.slice().reverse().map(([px, py]) => `L${r1(px)},${r1(py)}`).join(" ")} Z`;

  // Month-end labels inside the projection, at most three.
  const ends = projection.flatMap((p, i) => (p.date === monthEnd(p.date) ? [{ i: todayIndex + 1 + i, p }] : [])).slice(0, 3);
  // Month starts along the bottom.
  const all = [...history.map((p) => p.date), ...projection.map((p) => p.date)];
  const months = all.flatMap((d, i) => (d.endsWith("-01") ? [{ i, label: day(d, { month: "short" }) }] : []));

  const last = projection.at(-1);
  return (
    <div className="frunway">
      <dl className="frunway-figures">
        <div><dt>{sourceLabel} today</dt><dd>{formatMoney(today.cents)}</dd></div>
        {last && <div><dt>In {projection.length} days, if invoices are paid on time</dt><dd>{formatMoney(last.expected)}</dd></div>}
        {last && <div data-tone={last.floor < 0 ? "danger" : undefined}><dt>If nobody pays</dt><dd>{formatMoney(last.floor)}</dd></div>}
      </dl>
      <ChartTip>
        <figure className="fchart frunway-chart" aria-label={`${sourceLabel} history and 60-day projection`}>
          <div className="fchart-y" aria-hidden="true">
            {ticks.map((t) => <span key={t} style={{ top: `${(y(t) / H) * 100}%` }}>{axisMoney(t)}</span>)}
          </div>
          <div className="fchart-plot">
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`${sourceLabel}: ${formatMoney(today.cents)} today${last ? `, ${formatMoney(last.expected)} expected by ${day(last.date)}, ${formatMoney(last.floor)} if nobody pays` : ""}`}>
              <defs>
                <pattern id="frunway-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <line x1="0" y1="0" x2="0" y2="6" className="frunway-hatch-line" />
                </pattern>
              </defs>
              {ticks.map((t) => <line key={t} x1={0} x2={W} y1={y(t)} y2={y(t)} className={t === 0 ? "fchart-grid frunway-zero" : "fchart-grid"} vectorEffect="non-scaling-stroke" />)}
              <path d={area(histPts)} className="frunway-area" />
              {projection.length > 0 && <path d={gap} fill="url(#frunway-hatch)" className="frunway-gap" />}
              <path d={line(histPts)} className="frunway-line" vectorEffect="non-scaling-stroke" />
              {projection.length > 0 && <path d={line(floorPts)} className="frunway-floor" vectorEffect="non-scaling-stroke" />}
              {projection.length > 0 && <path d={line(expPts)} className="frunway-expected" vectorEffect="non-scaling-stroke" />}
              <line x1={x(todayIndex)} x2={x(todayIndex)} y1={0} y2={H} className="frunway-today" vectorEffect="non-scaling-stroke" />
              {all.map((d, i) => {
                const p = i <= todayIndex ? null : projection[i - todayIndex - 1];
                const tip = p
                  ? `${day(d)}: ${formatMoney(p.expected)} expected · ${formatMoney(p.floor)} if nobody pays${p.inflow ? ` · ${formatMoney(p.inflow)} due in` : ""}${p.outflow ? ` · ${formatMoney(p.outflow)} commission out` : ""}`
                  : `${day(d)}: ${formatMoney(history[i].cents)}${i === todayIndex ? " today" : ""}`;
                return <rect key={d} x={x(i) - W / n / 2} y={0} width={W / n} height={H} fill="transparent" data-tip={tip} />;
              })}
            </svg>
            <span className="frunway-mark" style={{ left: `${(x(todayIndex) / W) * 100}%` }} aria-hidden="true">Today</span>
            {ends.map(({ i, p }) => (
              <span key={p.date} className="frunway-end" style={{ left: `${(x(i) / W) * 100}%`, top: `${(y(p.expected) / H) * 100}%` }} aria-hidden="true">
                <i />
                <span>{day(p.date)} · {axisMoney(p.expected)}</span>
              </span>
            ))}
          </div>
          <div className="frunway-x" aria-hidden="true">
            {months.map((m, k) => <span key={m.i} data-minor={k % 2 ? "" : undefined} style={{ left: `${(x(m.i) / W) * 100}%` }}>{m.label}</span>)}
          </div>
        </figure>
      </ChartTip>
      <ul className="fchart-legend">
        <li><i style={{ background: "var(--accent)" }} />Balance</li>
        <li><i className="fchart-legend-line frunway-legend-dash" />Expected</li>
        <li><i className="frunway-legend-hatch" />Depends on clients paying</li>
      </ul>
    </div>
  );
}
