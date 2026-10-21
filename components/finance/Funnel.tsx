import Link from "next/link";
import { ChartTip } from "@/components/charts/ChartTip";
import type { FunnelRow } from "@/lib/funnel-math";
import { formatMoney } from "@/lib/format";
import { stageName } from "@/lib/live-feed";

const pct = (f: number) => `${Math.round(f * 100)}%`;

/**
 * Lead → Won as a funnel: each stage a band as wide as the deals that
 * entered it, tapering to the next. Every stage links to the Clients list
 * filtered to that stage.
 */
export function Funnel({ rows, source, periodLabel }: { rows: FunnelRow[]; source: "events" | "current"; periodLabel: string }) {
  const max = Math.max(...rows.map((r) => r.count));
  if (max === 0) {
    return <p className="small muted">The funnel fills in as deals are added and move stage. Each stage will show how many deals reached it and how many went on.</p>;
  }
  const width = (n: number) => (n > 0 ? Math.max(8, (n / max) * 100) : 4);
  return (
    <ChartTip>
      <ol className="ffunnel">
        {rows.map((r, i) => {
          const next = rows[i + 1];
          const top = width(r.count);
          const bottom = next ? width(next.count) : top * 0.88;
          const label = stageName(r.stage);
          // More deals can reach a stage than entered the one before it in the period (they were added earlier): no rate then.
          const rate = r.conversion !== null && next && r.conversion <= 1 ? r.conversion : null;
          const onward =
            rate !== null
              ? ` · ${pct(rate)} went on to ${stageName(next!.stage)}`
              : next && r.conversion !== null
                ? ` · ${next.count} reached ${stageName(next.stage)}, some from earlier periods`
                : "";
          const tip = `${label}: ${r.count} deal${r.count === 1 ? "" : "s"}${source === "events" ? " entered" : ""} · ${formatMoney(r.valueCents)}${onward}`;
          return (
            <li key={r.stage}>
              <Link href={`/admin/clients?stage=${r.stage === "outreach" ? "outreach_1" : r.stage}`} className="ffunnel-row" data-tip={tip} data-stage={r.stage} style={{ ["--i" as string]: i }}>
                <span className="ffunnel-name">{label}</span>
                <span className="ffunnel-shape" aria-hidden="true">
                  <svg viewBox="0 0 100 40" preserveAspectRatio="none">
                    <polygon points={`${50 - top / 2},0 ${50 + top / 2},0 ${50 + bottom / 2},40 ${50 - bottom / 2},40`} />
                  </svg>
                  <b data-light={top < 14 ? "" : undefined}>{r.count}</b>
                </span>
                <span className="ffunnel-figs">
                  <span>{formatMoney(r.valueCents)}</span>
                  {rate !== null && <small>{pct(rate)} on</small>}
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
      <p className="ffunnel-note">{source === "events" ? `Deals that reached each stage in ${periodLabel.toLowerCase()}, from stage moves and new deals.` : `No stage moves recorded in ${periodLabel.toLowerCase()}: showing where open deals stand now, and deals won in the period.`}</p>
    </ChartTip>
  );
}
