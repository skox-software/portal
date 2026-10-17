import Link from "next/link";
import { Money, money } from "@/components/rep/Money";
import { Receipt } from "@/components/rep/Receipt";
import { requireRep } from "@/lib/access";
import { EMPTY_TOTALS, repTotals } from "@/lib/commissions";
import { formatRate, periodLabel } from "@/lib/commission-math";
import { myEntries, myProfile, myStatements } from "@/lib/rep-data";

export const metadata = { title: "Earnings" };

function monthKey(d: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit" }).format(d).slice(0, 7);
}

export default async function RepEarnings() {
  const { rep } = await requireRep();
  const [profile, entries, statements, totals] = await Promise.all([myProfile(rep), myEntries(rep), myStatements(rep), repTotals(rep.workspaceId, [rep.id])]);
  const t = totals.get(rep.id) ?? EMPTY_TOTALS;
  const made = entries.reduce((s, e) => s + e.amountCents, 0);

  // The last twelve months, oldest first.
  const now = new Date();
  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11 + i, 15));
    return { key: d.toISOString().slice(0, 7), label: d.toLocaleString("en-US", { month: "short", timeZone: "UTC" }) };
  });
  const byMonth = new Map<string, number>();
  for (const e of entries) byMonth.set(monthKey(e.earnedAt), (byMonth.get(monthKey(e.earnedAt)) ?? 0) + e.amountCents);
  const peak = Math.max(1, ...months.map((m) => byMonth.get(m.key) ?? 0));
  const year = now.getFullYear();

  return (
    <>
      <section className="rp-hero" aria-label="Earnings">
        <div>
          <p className="rp-kicker">Earnings</p>
          <p className="rp-money-label">Made with SKOX, all time</p>
          <p className="rp-bignum"><Money cents={made} /></p>
          <p className="rp-rate"><b>{profile ? formatRate(profile.rateBps) : "—"}</b> of every payment from your clients. Paid monthly.</p>
        </div>
        <div className="rp-tiles">
          <div className="rp-tile" data-hot={t.pending > 0 ? "" : undefined}><span>This month so far</span><strong><Money cents={t.pending} /></strong></div>
          <div className="rp-tile" data-hot={t.approved > 0 ? "" : undefined}><span>Approved, on the way</span><strong><Money cents={t.approved} /></strong></div>
          <div className="rp-tile"><span>Paid in {year}</span><strong><Money cents={t.paidThisYear} /></strong></div>
          <div className="rp-tile"><span>Paid all time</span><strong><Money cents={t.paidLifetime} /></strong></div>
        </div>
      </section>

      <section className="rp-section" aria-labelledby="chart-title">
        <div className="rp-section-head">
          <h2 id="chart-title">The last twelve months</h2>
          <span>Earned by month</span>
        </div>
        <div className="rp-chart" role="img" aria-label={months.map((m) => `${m.label} ${money(byMonth.get(m.key) ?? 0)}`).join(", ")}>
          {months.map((m, i) => {
            const v = byMonth.get(m.key) ?? 0;
            return (
              <div key={m.key} className="rp-bar-col">
                <em>{money(v)}</em>
                <i style={{ height: `${Math.max(0, (v / peak) * 100)}%`, animationDelay: `${i * 40}ms` }} data-zero={v <= 0 ? "" : undefined} data-now={i === 11 ? "" : undefined} />
              </div>
            );
          })}
        </div>
        <div className="rp-chart-x" aria-hidden="true">{months.map((m) => <span key={m.key}>{m.label}</span>)}</div>
      </section>

      <div className="rp-section rp-split">
        <section aria-labelledby="feed-title">
          <div className="rp-section-head">
            <h2 id="feed-title">Every dollar</h2>
            <span>{entries.length} line{entries.length === 1 ? "" : "s"}</span>
          </div>
          {entries.length === 0 ? (
            <p className="rp-empty">Nothing yet. The day one of your clients pays SKOX, the line appears here.</p>
          ) : (
            <ul className="rp-feed">{entries.map((e) => <Receipt key={e.id} line={e} />)}</ul>
          )}
        </section>
        <aside>
          <div className="rp-section-head">
            <h2>Statements</h2>
          </div>
          {statements.length === 0 ? (
            <p className="rp-empty">Your first statement appears after the month closes on the 1st and SKOX approves it.</p>
          ) : (
            <ul className="rp-statements">
              {statements.map((s) => (
                <li key={s.id}>
                  <Link href={`/rep/earnings/statements/${s.id}`}>
                    <strong>{periodLabel(s.periodStart)}</strong>
                    <b>{money(s.totalCents)}</b>
                    <small>{s.status === "paid" ? `Paid ${s.paidAt?.toLocaleDateString("en-US", { month: "short", day: "numeric" }) ?? ""}` : "Approved · payment on the way"}</small>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <div className="rp-panel" style={{ marginTop: 24 }}>
            <h2>How pay works</h2>
            <ol className="rp-steps" style={{ marginTop: 16 }}>
              <li><span><strong>Cash, not promises.</strong> You earn the day SKOX gets paid: deposits, final payments and monthly plans.</span></li>
              <li><span><strong>Monthly.</strong> Each month closes on the 1st. Once SKOX approves it, payment follows.</span></li>
              <li><span><strong>Refunds.</strong> If a client is refunded, the same share comes off your next statement.</span></li>
              <li><span><strong>Taxes.</strong> You&apos;re paid as a contractor. Your yearly total is here for your 1099.</span></li>
            </ol>
          </div>
        </aside>
      </div>
    </>
  );
}
