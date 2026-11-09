import type { Metadata } from "next";
import Link from "next/link";
import { and, count, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { requireStaff } from "@/lib/access";
import { getDb } from "@/lib/db";
import { companyProposals, companyRuns, deals, floorEvents, invoices } from "@/lib/db/schema";
import { SEATS, inboxOrder, seatByKey } from "@/lib/company";
import { deskIssues, headline } from "@/lib/command";
import { FLOOR_APPS, statsFor } from "@/lib/floor";
import { pullFloor } from "@/lib/floor-pull";
import { firstName } from "@/lib/format";
import { Decisions } from "@/components/command/Decisions";
import "./command.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Command" };

/** The full-time goal, in dollars of recurring revenue a month. */
const GOAL_MONTHLY = 15_000;
const usd = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;
const short = (cents: number) => (cents >= 1_000_000 ? `$${(cents / 100_000).toFixed(1)}k` : usd(cents));
const ago = (d: Date | string | null, now: Date) => {
  if (!d) return "never";
  const m = Math.round((now.getTime() - new Date(d).getTime()) / 60_000);
  if (m < 60) return `${Math.max(m, 1)} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
};

/**
 * Command: the CEO view. One sentence, three numbers, the decisions waiting, and only the desks that need a look.
 * Every figure is read from the portal: invoices, deals, the Control Center and the company inbox.
 */
export default async function CommandPage() {
  const { viewer, staff } = await requireStaff();
  const ws = staff.workspaceId;
  const db = getDb();
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const since30 = new Date(now.getTime() - 30 * 86_400_000);
  await pullFloor();

  const [paidAll, paidMonth, openDeals, pending, pendingCount, decided, runs, events, totals] = await Promise.all([
    db.select({ cents: sql<number>`coalesce(sum(${invoices.amountCents}),0)::int` }).from(invoices).where(and(eq(invoices.workspaceId, ws), eq(invoices.status, "paid"))),
    db.select({ cents: sql<number>`coalesce(sum(${invoices.amountCents}),0)::int` }).from(invoices).where(and(eq(invoices.workspaceId, ws), eq(invoices.status, "paid"), gte(invoices.paidAt, monthStart))),
    db.select({ stage: deals.stage, cents: deals.valueCents }).from(deals).where(and(eq(deals.workspaceId, ws), inArray(deals.stage, ["replied", "meeting", "proposal_sent", "won"]))),
    db.select().from(companyProposals).where(and(eq(companyProposals.workspaceId, ws), eq(companyProposals.status, "pending"))).orderBy(desc(companyProposals.createdAt)).limit(50),
    db.select({ n: count() }).from(companyProposals).where(and(eq(companyProposals.workspaceId, ws), eq(companyProposals.status, "pending"))),
    db.select({ status: companyProposals.status }).from(companyProposals).where(and(eq(companyProposals.workspaceId, ws), gte(companyProposals.decidedAt, since30), inArray(companyProposals.status, ["approved", "done"]))),
    db.select({ seat: companyRuns.seat, at: companyRuns.createdAt }).from(companyRuns).where(and(eq(companyRuns.workspaceId, ws), gte(companyRuns.createdAt, new Date(now.getTime() - 26 * 3_600_000)))),
    db.select().from(floorEvents).where(gte(floorEvents.at, since30)).orderBy(desc(floorEvents.at)).limit(5000),
    db.select({ app: floorEvents.app, n: count() }).from(floorEvents).where(eq(floorEvents.kind, "job")).groupBy(floorEvents.app),
  ]);

  // Money. No recurring billing exists yet, so recurring revenue is honestly $0 until desks are billed monthly.
  const recurring = 0;
  const goalPct = Math.min(100, Math.round((recurring / GOAL_MONTHLY) * 100));

  // Pipeline: deals that answered, met or have a proposal.
  const live = openDeals.filter((d) => d.stage !== "won");
  const pipelineCents = live.reduce((s, d) => s + (d.cents ?? 0), 0);
  const priced = live.filter((d) => d.cents).length;
  const proposals = live.filter((d) => d.stage === "proposal_sent").length;
  const meetings = live.filter((d) => d.stage === "meeting").length;

  // Desks, from the Control Center.
  const total = new Map(totals.map((t) => [t.app, t.n]));
  const desks = FLOOR_APPS.map((app) => {
    const rows = events.filter((e) => e.app === app.key);
    return { app, reporting: rows.length > 0 || (total.get(app.key) ?? 0) > 0, stats: statsFor(app, rows, now, total.get(app.key) ?? 0) };
  });
  const issues = deskIssues(desks, now);
  const healthy = desks.filter((d) => !issues.some((i) => i.key === d.app.key));
  const jobsToday = healthy.reduce((s, d) => s + d.stats.today, 0);

  // Decisions and the company.
  const top = inboxOrder(pending).slice(0, 3).map((p) => ({ id: p.id, seat: seatByKey.get(p.seat)?.name ?? p.seat, title: p.title, why: p.why, impact: p.impact }));
  const liveSeats = SEATS.filter((s) => s.status === "live" && s.title !== "Department" && !["josh", "advisory"].includes(s.key));
  const ranRecently = liveSeats.filter((s) => runs.some((r) => r.seat === s.key)).length;
  const carried = decided.filter((d) => d.status === "done").length;

  const hourET = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: "America/New_York" }).format(now)) % 24;
  const dateLine = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).format(now);
  const { greeting, rest } = headline(viewer.name ? firstName(viewer.name) : "Josh", hourET, pendingCount[0].n, issues);
  const down = issues.filter((i) => i.level === "down").length;

  return (
    <main className="cmd">
      <section className="cmd-top">
        <div className="cmd-meta">
          <span>{dateLine.toUpperCase()}</span>
          <span className="cmd-live"><i data-s={down ? "down" : issues.length ? "look" : "ok"} />{down ? `${down} desk down` : issues.length ? `${issues.length} desk${issues.length > 1 ? "s" : ""} to look at` : "All desks working"}</span>
        </div>
        <h1>{greeting} {rest.map((r, i) => <em key={i} data-first={i === 0 || undefined}>{r} </em>)}</h1>
      </section>

      <section className="cmd-numbers" aria-label="Key numbers">
        <div>
          <div className="cmd-label">Recurring revenue</div>
          <div className="cmd-big">{usd(recurring * 100)}<small>/mo</small></div>
          <div className="cmd-sub">{usd(paidAll[0].cents)} collected so far{paidMonth[0].cents ? <> · <span className="cmd-up">{usd(paidMonth[0].cents)}</span> this month</> : ""}</div>
          <div className="cmd-goal"><div className="cmd-bar"><span style={{ width: `${Math.max(goalPct, 1)}%` }} /></div><span>{goalPct}% of ${GOAL_MONTHLY / 1000}k goal</span></div>
        </div>
        <div>
          <div className="cmd-label">Pipeline</div>
          <div className="cmd-big">{live.length}<small>{live.length === 1 ? "deal" : "deals"} in play</small></div>
          <div className="cmd-sub">{priced ? `${short(pipelineCents)} priced · ` : ""}{meetings} {meetings === 1 ? "meeting" : "meetings"} · {proposals} {proposals === 1 ? "proposal" : "proposals"} out</div>
        </div>
        <div>
          <div className="cmd-label">Desks</div>
          <div className="cmd-big">{healthy.length}<small>of {desks.length} healthy</small></div>
          <div className="cmd-sub">{jobsToday} {jobsToday === 1 ? "job" : "jobs"} today{down ? ` · ${down} down` : issues.length ? ` · ${issues.length} to look at` : ""}</div>
        </div>
      </section>

      <Decisions items={top} total={pendingCount[0].n} />

      <section aria-labelledby="cmd-desks">
        <div className="cmd-head"><h2 id="cmd-desks">Desks</h2><Link className="cmd-link" href="/admin/control-center">Control Center</Link></div>
        {issues.map((i) => (
          <div className="cmd-desk" key={i.key}>
            <span className="cmd-dot" data-s={i.level} />
            <div><div className="cmd-nm">{i.name}</div><div className="cmd-cl">{i.client}</div></div>
            <div className="cmd-why" data-s={i.level}>{i.why}</div>
            <div className="cmd-when">{ago(i.lastAt, now)}</div>
          </div>
        ))}
        <div className="cmd-healthy">
          <span>{healthy.length ? <><b>{healthy.length} {healthy.length === 1 ? "desk" : "desks"} healthy</b> · {jobsToday} {jobsToday === 1 ? "job" : "jobs"} today</> : "No healthy desks right now"}</span>
          <Link className="cmd-link" href="/admin/control-center">Show all</Link>
        </div>
      </section>

      <details className="cmd-more">
        <summary>Pipeline and the company <span>Open</span></summary>
        <div className="cmd-stats">
          <div><div className="cmd-label">Meetings</div><div className="cmd-v">{meetings}</div></div>
          <div><div className="cmd-label">Proposals out</div><div className="cmd-v">{proposals}</div></div>
          <div><div className="cmd-label">Won</div><div className="cmd-v">{openDeals.filter((d) => d.stage === "won").length}</div></div>
          <div><div className="cmd-label">Approvals carried out</div><div className="cmd-v">{decided.length ? `${carried} of ${decided.length}` : "—"}</div><div className="cmd-d">last 30 days</div></div>
          <div><div className="cmd-label">Seats ran</div><div className="cmd-v">{ranRecently} of {liveSeats.length}</div><div className="cmd-d">in the last day</div></div>
        </div>
      </details>
    </main>
  );
}
