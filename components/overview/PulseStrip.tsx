import Link from "next/link";
import { formatMoney } from "@/lib/format";
import type { Overview } from "@/lib/overview-data";

/** Six numbers, each a link to the page that explains it. */
export function PulseStrip({ pulse }: { pulse: Overview["pulse"] }) {
  const p = pulse;
  const collectedNote = p.pace
    ? `${p.pace.percentOfGoal}% of the ${formatMoney(p.goalCents ?? 0)} goal · ${p.pace.onTrack ? "on track" : "behind pace"}`
    : `Last month ${formatMoney(p.lastMonthCents)}`;
  return (
    <section className="admin-metrics admin-metrics-6" aria-label="Business pulse">
      <Link className="admin-metric" href="/admin/finance">
        <span>{p.bankSource === "payments" ? "Stripe balance" : "In the bank"}</span>
        <strong>{p.bankCents === null ? "—" : formatMoney(p.bankCents)}</strong>
        <small>{p.bankCents === null ? "Stripe unavailable" : p.bankSource === "business" ? "Stripe business account" : "Available and settling"}</small>
      </Link>
      <Link className="admin-metric" href="/admin/finance">
        <span>Collected this month</span>
        <strong>{formatMoney(p.collectedMonthCents)}</strong>
        <small className={p.pace && !p.pace.onTrack ? "ov-warn" : undefined}>{collectedNote}</small>
      </Link>
      <Link className="admin-metric" href="/admin/pipeline">
        <span>Pipeline, weighted</span>
        <strong>{formatMoney(p.weightedPipelineCents)}</strong>
        <small>
          {p.openDealCount} open deal{p.openDealCount === 1 ? "" : "s"}
          {p.openDealCents ? ` · ${formatMoney(p.openDealCents)} face value` : ""}
        </small>
      </Link>
      <Link className="admin-metric" href={p.owed.overdueCount ? "/admin/billing?status=overdue" : "/admin/billing?status=open"}>
        <span>Owed to SKOX</span>
        <strong>{formatMoney(p.owed.openCents)}</strong>
        <small className={p.owed.overdueCount ? "ov-warn" : undefined}>{p.owed.overdueCount ? `${p.owed.overdueCount} overdue · ${formatMoney(p.owed.overdueCents)}` : `${p.owed.openCount} unpaid, none overdue`}</small>
      </Link>
      <Link className="admin-metric" href="/admin/clients?view=due">
        <span>Follow-ups due</span>
        <strong>{p.followUpsMine}</strong>
        <small>{p.followUpsTeam === p.followUpsMine ? "Yours and unassigned" : `${p.followUpsTeam} across the team`}</small>
      </Link>
      <Link className="admin-metric" href="/admin/inbox">
        <span>Inbox</span>
        <strong>{p.inboxUnread}</strong>
        <small>{p.inboxUnfiled ? `Unread · ${p.inboxUnfiled} need a client` : "Unread · everything filed"}</small>
      </Link>
    </section>
  );
}
