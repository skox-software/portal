import { eq } from "drizzle-orm";
import Link from "next/link";
import { after } from "next/server";
import { LeadRow } from "@/components/rep/LeadRow";
import { Money } from "@/components/rep/Money";
import { Receipt } from "@/components/rep/Receipt";
import { requireRep } from "@/lib/access";
import { EMPTY_TOTALS, repTotals } from "@/lib/commissions";
import { formatRate } from "@/lib/commission-math";
import { getDb } from "@/lib/db";
import { memberships } from "@/lib/db/schema";
import { followUpState, salesToday } from "@/lib/follow-up";
import { myEntries, myLeads, myProfile } from "@/lib/rep-data";
import { REP_STATUSES, repCanWork } from "@/lib/rep-status";

export const metadata = { title: { absolute: "Desk · SKOX Sales Rep Desk" } };

function greeting(now = new Date()) {
  const h = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }).format(now));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export default async function RepDesk() {
  const { rep } = await requireRep();
  const [profile, leads, totals, entries] = await Promise.all([myProfile(rep), myLeads(rep), repTotals(rep.workspaceId, [rep.id]), myEntries(rep)]);
  const money = totals.get(rep.id) ?? EMPTY_TOTALS;
  const today = salesToday();
  const since = profile?.lastSeenAt ?? null;
  after(async () => {
    await getDb().update(memberships).set({ lastSeenAt: new Date() }).where(eq(memberships.id, rep.id));
  });

  const made = entries.reduce((s, e) => s + e.amountCents, 0);
  const open = leads.filter((l) => repCanWork(l.status));
  const due = open
    .filter((l) => ["overdue", "today"].includes(followUpState(l.nextStepOn, today)))
    .sort((a, b) => (a.nextStepOn ?? "").localeCompare(b.nextStepOn ?? ""));
  const fresh = open.filter((l) => !l.lastContactedAt && !due.includes(l));
  const queue = [...due, ...fresh].slice(0, 8);
  const newFromSkox = leads.filter((l) => l.repSource === "assigned" && since && l.createdAt > since).length;
  const won = leads.filter((l) => l.status === "won").length;
  const rate = profile ? formatRate(profile.rateBps) : "your rate";
  const first = (profile?.displayName ?? "").split(" ")[0];

  return (
    <>
      <section className="rp-hero" aria-label="Your money">
        <div>
          <p className="rp-hello">
            {greeting()}{first ? <>, <strong>{first}</strong></> : null}.
            {newFromSkox > 0 && <> SKOX sent you <strong>{newFromSkox} new lead{newFromSkox === 1 ? "" : "s"}</strong>.</>}
          </p>
          <p className="rp-money-label">Made with SKOX</p>
          <p className="rp-bignum"><Money cents={made} /></p>
          <p className="rp-rate"><b>{rate}</b> of every dollar your clients pay SKOX, for as long as they stay.</p>
        </div>
        <div className="rp-tiles">
          <Link className="rp-tile" href="/rep/earnings" data-hot={money.pending + money.approved > 0 ? "" : undefined}>
            <span>On the way</span>
            <strong><Money cents={money.pending + money.approved} /></strong>
          </Link>
          <Link className="rp-tile" href="/rep/earnings">
            <span>Paid this year</span>
            <strong><Money cents={money.paidThisYear} /></strong>
          </Link>
          <Link className="rp-tile" href="/rep/leads?view=due">
            <span>Calls due</span>
            <strong>{due.length}</strong>
          </Link>
          <Link className="rp-tile" href="/rep/leads?status=won">
            <span>Clients won</span>
            <strong>{won}</strong>
          </Link>
        </div>
      </section>

      <section className="rp-section" aria-labelledby="calls-title">
        <div className="rp-section-head">
          <h2 id="calls-title">Your calls today</h2>
          <Link href="/rep/leads">All {leads.length} leads →</Link>
        </div>
        {queue.length === 0 ? (
          <p className="rp-empty">
            {open.length ? "You're caught up. Nothing is due until your next follow-up." : <>No open leads right now. <Link href="/rep/leads/new">Add one you know</Link>, or watch for new ones from SKOX.</>}
          </p>
        ) : (
          <ul className="rp-leads">{queue.map((l) => <LeadRow key={l.id} lead={l} today={today} />)}</ul>
        )}
      </section>

      <section className="rp-section" aria-labelledby="board-title">
        <div className="rp-section-head">
          <h2 id="board-title">Your board</h2>
          <span>Where every lead stands</span>
        </div>
        <div className="rp-board">
          {REP_STATUSES.map((s) => (
            <Link key={s.value} href={`/rep/leads?status=${s.value}`} data-status={s.value}>
              <span>{s.label}</span>
              <strong>{leads.filter((l) => l.status === s.value).length}</strong>
            </Link>
          ))}
        </div>
      </section>

      <div className="rp-section rp-split">
        <section aria-labelledby="feed-title">
          <div className="rp-section-head">
            <h2 id="feed-title">Money feed</h2>
            <Link href="/rep/earnings">Earnings →</Link>
          </div>
          {entries.length === 0 ? (
            <p className="rp-empty">The day one of your clients pays SKOX, it shows up here with exactly what you made.</p>
          ) : (
            <ul className="rp-feed">{entries.slice(0, 6).map((e) => <Receipt key={e.id} line={e} />)}</ul>
          )}
        </section>
        <aside className="rp-panel" data-accent aria-labelledby="how-title">
          <h2 id="how-title">How you win</h2>
          <p>Your job is the conversation. SKOX does the rest.</p>
          <ol className="rp-steps">
            <li><span><strong>Call your leads.</strong> Work the ones SKOX sends and add your own. First to add a business owns it.</span></li>
            <li><span><strong>Book the scope call.</strong> Put it on SKOX&apos;s calendar and mark it booked.</span></li>
            <li><span><strong>SKOX closes.</strong> Watch the lead move to With SKOX, then Won.</span></li>
            <li><span><strong>Get paid on every payment.</strong> {rate} of each deposit, final payment and monthly plan. Statements close on the 1st.</span></li>
          </ol>
        </aside>
      </div>
    </>
  );
}
