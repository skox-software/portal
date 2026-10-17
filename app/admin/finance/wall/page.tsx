import type { Metadata } from "next";
import Link from "next/link";
import { LiveProvider } from "@/components/finance/LiveProvider";
import { LiveTicker } from "@/components/finance/LiveTicker";
import { WallRotator } from "@/components/finance/WallRotator";
import { requireStaff } from "@/lib/access";
import { HEAT_METRICS, type HeatMetric } from "@/lib/finance-data";
import { loadMission } from "@/lib/finance-mission";
import { parsePeriod, periodRange } from "@/lib/finance-periods";
import { stripeEnabled } from "@/lib/stripe";
import { FlowPanel, FunnelPanel, HeatPanel, RacePanel, RunwayPanel } from "../panels";

export const metadata: Metadata = { title: "Finance wall" };

/**
 * Finance for a screen on the wall: the live ticker always on top and one
 * big panel at a time, rotating every 20 seconds, the data refreshed every
 * minute. Same panels and numbers as /admin/finance.
 */
export default async function FinanceWall({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const { staff } = await requireStaff();
  const period = parsePeriod(typeof sp.period === "string" ? sp.period : undefined);
  const heat: HeatMetric = HEAT_METRICS.includes(sp.heat as HeatMetric) ? (sp.heat as HeatMetric) : "cash";
  const m = await loadMission(staff.workspaceId, periodRange(period), heat);
  const heatHref = (metric: HeatMetric) => `/admin/finance/wall?${new URLSearchParams({ period, ...(metric === "cash" ? {} : { heat: metric }) })}`;

  return (
    <LiveProvider initial={m.live}>
      <main className="fwall" data-theme="mission">
        <header className="fwall-head">
          <div>
            <p className="eyebrow">Mission control</p>
            <h1>Finance</h1>
          </div>
          <p className="fwall-period">{m.range.label} · Florida time</p>
          <Link href={`/admin/finance?period=${period}`} className="fwall-exit">Exit wall mode</Link>
        </header>
        <LiveTicker wall />
        <p className="fwall-phone">Wall mode is for a big screen. <Link href={`/admin/finance?period=${period}`}>Open Finance</Link> on this one.</p>
        <WallRotator
          panels={[
            { key: "flow", title: "Money flow", node: <FlowPanel m={m} wall /> },
            { key: "runway", title: "Runway", node: <RunwayPanel m={m} wall connected={stripeEnabled()} /> },
            { key: "race", title: "The race", node: <RacePanel m={m} wall /> },
            { key: "heat", title: "Heat map", node: <HeatPanel m={m} wall hrefFor={heatHref} /> },
            { key: "funnel", title: "Funnel", node: <FunnelPanel m={m} wall /> },
          ]}
        />
      </main>
    </LiveProvider>
  );
}
