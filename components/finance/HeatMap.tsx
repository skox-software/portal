import Link from "next/link";
import { ChartTip } from "@/components/charts/ChartTip";
import { calendarGrid, heatScale } from "@/lib/chart-math";
import type { HeatMetric } from "@/lib/finance-data";
import { formatMoney } from "@/lib/format";

const METRICS: { key: HeatMetric; label: string; unit: (n: number) => string; empty: string }[] = [
  { key: "cash", label: "Cash", unit: (n) => formatMoney(n), empty: "No payments" },
  { key: "won", label: "Deals won", unit: (n) => `${n} deal${n === 1 ? "" : "s"} won`, empty: "No deals won" },
  { key: "calls", label: "Calls logged", unit: (n) => `${n} call${n === 1 ? "" : "s"}`, empty: "No calls" },
];

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const long = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric", year: "numeric" });

/**
 * A year of days, one square each, shaded by how much happened. Server
 * rendered; the metric is a link (`?heat=`), so it works without JavaScript.
 * On a phone the grid scrolls sideways inside its panel, starting at today.
 */
export function HeatMap({
  metric,
  values,
  startIso,
  endIso,
  hrefFor,
}: {
  metric: HeatMetric;
  values: Map<string, number>;
  startIso: string;
  endIso: string;
  hrefFor: (metric: HeatMetric) => string;
}) {
  const m = METRICS.find((x) => x.key === metric)!;
  const { weeks, cells, months } = calendarGrid(startIso, endIso);
  const { level } = heatScale([...values.values()]);
  const total = [...values.values()].reduce((s, v) => s + v, 0);
  const active = [...values.values()].filter((v) => v > 0).length;
  const best = [...values.entries()].sort((a, b) => b[1] - a[1])[0];

  return (
    <div className="fheat">
      <div className="fheat-top">
        <nav className="period-chips" aria-label="Heat map shows">
          {METRICS.map((x) => (
            <Link key={x.key} href={hrefFor(x.key)} aria-current={x.key === metric ? "page" : undefined} scroll={false}>{x.label}</Link>
          ))}
        </nav>
        <p className="fheat-summary">
          {total > 0 ? (
            <>
              <b>{metric === "cash" ? formatMoney(total) : total.toLocaleString("en-US")}</b> {metric === "cash" ? "collected" : metric === "won" ? "won" : "calls"} on {active} day{active === 1 ? "" : "s"}
              {best && best[1] > 0 && <> · best {long(best[0]).replace(/, \d{4}$/, "")}, {m.unit(best[1])}</>}
            </>
          ) : (
            <>{m.empty} in the last year yet. Days fill in as they happen.</>
          )}
        </p>
      </div>
      <ChartTip>
        <div className="fheat-scroll">
          <div className="fheat-grid" style={{ ["--weeks" as string]: weeks }} role="img" aria-label={`${m.label} per day from ${long(startIso)} to ${long(endIso)}: ${total > 0 ? `${m.unit(total)} in total` : "nothing yet"}`}>
            <div className="fheat-months" aria-hidden="true">
              {months.map((mo) => <span key={mo.key} style={{ gridColumn: mo.week + 1 }}>{mo.label}</span>)}
            </div>
            <div className="fheat-days" aria-hidden="true">
              {DOW.map((d, i) => <span key={d}>{i % 2 ? d : ""}</span>)}
            </div>
            <div className="fheat-cells">
              {cells.map((c) => {
                if (!c.date) return <i key={`${c.week}-${c.dow}`} className="fheat-blank" />;
                const v = values.get(c.date) ?? 0;
                return <i key={c.date} data-level={level(v)} data-tip={`${long(c.date)}: ${v > 0 ? m.unit(v) : m.empty.toLowerCase()}`} />;
              })}
            </div>
          </div>
        </div>
      </ChartTip>
      <div className="fheat-legend" aria-hidden="true">
        <span>Less</span>
        {[0, 1, 2, 3, 4].map((l) => <i key={l} data-level={l} />)}
        <span>More</span>
      </div>
    </div>
  );
}
