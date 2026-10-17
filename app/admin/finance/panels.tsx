import Link from "next/link";
import { Funnel } from "@/components/finance/Funnel";
import { GoalDial } from "@/components/finance/GoalDial";
import { HeatMap } from "@/components/finance/HeatMap";
import { MoneyFlow } from "@/components/finance/MoneyFlow";
import { Race } from "@/components/finance/Race";
import { Runway } from "@/components/finance/Runway";
import type { HeatMetric } from "@/lib/finance-data";
import type { Mission } from "@/lib/finance-mission";

/*
 * The Mission Control panels, shared by the Finance page and wall mode so
 * both always draw the same thing. Each is a titled admin panel; `wall`
 * drops the links that make no sense on a screen nobody clicks.
 */

type PanelProps = { m: Mission; wall?: boolean };

function Panel({ id, title, intro, action, children, className }: { id: string; title: string; intro: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`admin-panel fpanel${className ? ` ${className}` : ""}`} aria-labelledby={`${id}-title`} id={id}>
      <div className="admin-panel-head">
        <div><h2 id={`${id}-title`}>{title}</h2><p>{intro}</p></div>
        {action}
      </div>
      <div className="finance-body">{children}</div>
    </section>
  );
}

export function FlowPanel({ m, wall }: PanelProps) {
  return (
    <Panel id="flow" title="Money flow" intro={`Open pipeline (weighted), won, invoiced and paid in ${m.range.label.toLowerCase()}, then earned shares before business expenses.${wall ? "" : " Hover a band for the amount."}`} className="fpanel-hero">
      <MoneyFlow input={m.flow} periodLabel={m.range.label} height={wall ? 480 : 340} />
    </Panel>
  );
}

export function RunwayPanel({ m, connected }: PanelProps & { connected: boolean }) {
  return (
    <Panel id="runway" title="Runway" intro={`The balance through ${m.range.label.toLowerCase()}, rebuilt from Stripe activity, and the next 60 days if open invoices are paid on their due dates and commission statements go out on the 5th.`}>
      {m.runway ? (
        <Runway {...m.runway} />
      ) : (
        <p className="small muted">{connected ? "The runway draws from Stripe's balance and activity, which aren't available right now. It returns on the next refresh that reaches Stripe." : "Connect Stripe to see the balance over time and where it's heading."}</p>
      )}
    </Panel>
  );
}

export function GoalPanel({ m, wall }: PanelProps) {
  return (
    <Panel id="goal" title="Goal" intro="Cash collected this year against the revenue target." action={wall ? undefined : <Link href="/admin/settings#ws-goal">Target</Link>}>
      <GoalDial
        ytdCents={m.goal.ytdCents}
        goalCents={m.goal.goalCents}
        balanceCents={m.live.balanceCents}
        balanceLabel={m.live.balanceSource === "payments" ? "payments balance" : "business account"}
        today={m.today}
      />
    </Panel>
  );
}

export function RacePanel({ m }: PanelProps) {
  return (
    <Panel id="race" title="The race" intro="Cash collected and deals won by owner, this month and this year.">
      <Race {...m.race} today={m.today} />
    </Panel>
  );
}

export function HeatPanel({ m, hrefFor, wall }: PanelProps & { hrefFor: (metric: HeatMetric) => string }) {
  return (
    <Panel id="heat" title="The year, day by day" intro={wall ? "The last 12 months in Florida time." : "The last 12 months in Florida time, whatever the period above. Hover a day for its number."}>
      <HeatMap {...m.heat} hrefFor={hrefFor} />
    </Panel>
  );
}

export function FunnelPanel({ m, wall }: PanelProps) {
  return (
    <Panel id="funnel" title="Funnel" intro={`How many deals reached each stage in ${m.range.label.toLowerCase()}, and how many went on.${wall ? "" : " Click a stage to see those clients."}`}>
      <Funnel {...m.funnel} periodLabel={m.range.label} />
    </Panel>
  );
}
