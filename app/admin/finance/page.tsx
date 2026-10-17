import type { Metadata } from "next";
import Link from "next/link";
import { BarChart } from "@/components/charts/BarChart";
import { Donut } from "@/components/charts/Donut";
import { StackedBars } from "@/components/charts/StackedBars";
import { axisCount } from "@/components/charts/Axis";
import { PeriodSwitcher } from "@/components/PeriodSwitcher";
import { ActivityFeed } from "@/components/finance/ActivityFeed";
import { LiveProvider } from "@/components/finance/LiveProvider";
import { LiveTicker } from "@/components/finance/LiveTicker";
import { eq } from "drizzle-orm";
import { requireStaff } from "@/lib/access";
import { getDb } from "@/lib/db";
import { workspaces } from "@/lib/db/schema";
import { Funnel } from "@/components/finance/Funnel";
import { GoalDial } from "@/components/finance/GoalDial";
import { HeatMap } from "@/components/finance/HeatMap";
import { MoneyFlow } from "@/components/finance/MoneyFlow";
import { Race } from "@/components/finance/Race";
import { Runway } from "@/components/finance/Runway";
import { collectedByBucket, collectedSince, dailyActivity, dealsWonByOwner, funnel, HEAT_METRICS, type HeatMetric, invoicedInPeriod, invoicesByPaymentIntent, leaderboard, openInvoiceDues, outstanding, raceStandings, refundsByBucket, sharesByOwner, unpaidStatements, weightedPipeline } from "@/lib/finance-data";
import { balanceSeries, projectForward } from "@/lib/forecast-math";
import { addDays, salesToday } from "@/lib/follow-up";
import { liveSnapshot } from "@/lib/finance-live";
import { bucketKeys, bucketLabel, parsePeriod, periodRange, unixToSalesDate } from "@/lib/finance-periods";
import { stripeActivity, stripeBalance, stripeCharges, stripePayouts, stripeTreasury, type StripeRead } from "@/lib/finance-stripe";
import { firstName, formatDate, formatMoney } from "@/lib/format";
import { columnLabel } from "@/lib/pipeline";
import { stripeEnabled } from "@/lib/stripe";
import "./finance.css";

export const metadata: Metadata = { title: "Finance" };

/**
 * Where the money stands: Stripe's balance and payouts, cash collected by
 * period, what's owed to SKOX, deals won and who is owed commission. Portal
 * numbers come from the database; Stripe numbers are read live and, if
 * Stripe is slow or the key lacks a permission, the Stripe cards say so
 * instead of failing the page. Both staff roles see everything here.
 */
export default async function AdminFinance({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const { staff } = await requireStaff();
  const ws = staff.workspaceId;
  const period = parsePeriod(typeof sp.period === "string" ? sp.period : undefined);
  const fresh = sp.fresh === "1";
  const range = periodRange(period);
  const heat: HeatMetric = HEAT_METRICS.includes(sp.heat as HeatMetric) ? (sp.heat as HeatMetric) : "cash";
  const today = salesToday();
  const yearStart = addDays(today, -364);
  const connected = stripeEnabled();

  const [collected, refunds, owed, won, pipeline, leaders, balance, payouts, activity, charges, treasury, live, invoiced, shares, dues, statementsDue, heatValues, race, funnelData, [workspace], ytdCents] = await Promise.all([
    collectedByBucket(ws, range),
    refundsByBucket(ws, range),
    outstanding(ws),
    dealsWonByOwner(ws, range),
    weightedPipeline(ws),
    leaderboard(ws, range),
    stripeBalance(fresh),
    stripePayouts(fresh),
    stripeActivity(range, fresh),
    stripeCharges(range, fresh),
    stripeTreasury(fresh),
    liveSnapshot(ws),
    invoicedInPeriod(ws, range),
    sharesByOwner(ws, range),
    openInvoiceDues(ws),
    unpaidStatements(ws),
    dailyActivity(ws, heat, yearStart, today),
    raceStandings(ws, today),
    funnel(ws, range),
    getDb().select({ goalCents: workspaces.revenueGoalCents, goalYear: workspaces.revenueGoalYear }).from(workspaces).where(eq(workspaces.id, ws)).limit(1),
    collectedSince(ws, `${today.slice(0, 4)}-01-01`),
  ]);
  const goalCents = workspace?.goalYear === Number(today.slice(0, 4)) ? workspace.goalCents : null;
  // No Treasury account at all is a fact, not a failure; a permission error is.
  const hasTreasury = treasury.ok && treasury.data.accounts.length > 0;
  const nextPayout = payouts.ok ? payouts.data.next : null;
  const chargeInvoices = charges.ok ? await invoicesByPaymentIntent(ws, charges.data.flatMap((c) => (c.paymentIntent ? [c.paymentIntent] : []))) : new Map();

  const keys = bucketKeys(range);
  const labels = keys.map((k) => bucketLabel(k, range.bucket));
  const collectedTotal = collected.reduce((s, b) => s + b.value.cents, 0);
  const paymentCount = collected.reduce((s, b) => s + b.value.count, 0);
  const refundTotal = refunds.reduce((s, b) => s + b.value, 0);
  const failures = [...new Set([balance, payouts, activity, charges, treasury].flatMap((r) => (r.ok ? [] : [r.reason])))];

  const revenue = keys.map((key, i) => {
    const cash = collected[i].value.cents;
    const back = refunds[i].value;
    const net = activity.ok ? activity.data.buckets[i]?.net : undefined;
    return {
      key,
      label: labels[i],
      parts: [Math.max(0, cash - back), back],
      tip: `${labels[i]}: collected ${formatMoney(cash)} · refunded ${formatMoney(back)}${net !== undefined ? ` · Stripe net ${formatMoney(net)}` : ""}`,
    };
  });

  // Deals won: the two owners who closed most get their own color, everyone else is "Others".
  const nameFor = (email: string | null) => leaders.find((l) => l.email === email && l.repMembershipId)?.name ?? (email ? firstName(email) : "Unassigned");
  const byOwner = new Map<string | null, number>();
  for (const w of won) byOwner.set(w.owner, (byOwner.get(w.owner) ?? 0) + w.count);
  const top = [...byOwner.entries()].filter(([email]) => email).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([email]) => email);
  const groups = [...top.map((email) => nameFor(email)), "Others"];
  const wonSeries = keys.map((key, i) => {
    const parts = groups.map(() => 0);
    for (const w of won.filter((w) => w.key === key)) {
      const at = top.indexOf(w.owner);
      parts[at === -1 ? groups.length - 1 : at] += w.count;
    }
    return { key, label: labels[i], parts, tip: `${labels[i]}: ${groups.map((g, j) => `${g} ${parts[j]}`).join(" · ")}` };
  });
  const wonCount = won.reduce((s, w) => s + w.count, 0);
  const wonValue = won.reduce((s, w) => s + w.valueCents, 0);

  const notDue = owed.openCents - owed.overdueCents;
  const flowInput = {
    pipelineCents: pipeline.weightedCents,
    wonCents: wonValue,
    invoicedCents: invoiced,
    paidCents: collectedTotal,
    // Stripe's view of fees and refunds when it answers; the portal's refunds otherwise.
    feesCents: activity.ok ? activity.data.totals.fees : 0,
    refundsCents: activity.ok ? activity.data.totals.refunds : refundTotal,
    shares,
  };

  // Runway: walk the balance back through the period from today's figure, then project 60 days on.
  const runwayBalance = hasTreasury ? treasury.data.cash : balance.ok ? balance.data.available + balance.data.pending : null;
  const runway =
    runwayBalance !== null && activity.ok
      ? {
          history: balanceSeries({ date: today, cents: runwayBalance }, range.startIso, activity.data.days, !hasTreasury),
          projection: projectForward(runwayBalance, dues, statementsDue, today),
          sourceLabel: hasTreasury ? "Business account" : "Payments balance",
        }
      : null;

  return (
    <LiveProvider initial={live}>
    <main className="shell page">
      <LiveTicker />
      <div className="page-head">
        <div>
          <p className="eyebrow">Mission control</p>
          <h1>Finance</h1>
          <p className="muted">Stripe balance and payouts, cash collected, money owed, deals won and commission. {range.label}, in Florida time.</p>
        </div>
        <div className="finance-head-actions">
          <PeriodSwitcher path="/admin/finance" current={period} params={heat === "cash" ? {} : { heat }} />
          {connected && <Link className="btn btn-ghost btn-small" href={`/admin/finance?period=${period}&fresh=1`}>Refresh Stripe</Link>}
        </div>
      </div>

      {!connected ? (
        <p className="finance-strip"><strong>Connect Stripe</strong> to see balance, fees and payouts here. Add a restricted key with read access to Balance, Payouts, Charges, PaymentIntents and Financial accounts (Money management) as STRIPE_SECRET_KEY. Portal numbers below are complete without it.</p>
      ) : failures.length > 0 ? (
        <p className="finance-strip" role="status"><strong>Stripe unavailable:</strong> {failures.join("; ")}. Portal numbers below are unaffected.</p>
      ) : null}

      <section className="admin-metrics finance-metrics" aria-label="Money summary">
        {hasTreasury && (
          <div className="admin-metric">
            <span>Business account</span>
            <strong>{formatMoney(treasury.data.cash)}</strong>
            <small>{treasury.data.accounts[0].name ?? "Stripe business account"}{treasury.data.inboundPending ? ` · ${formatMoney(treasury.data.inboundPending)} arriving` : ""}</small>
          </div>
        )}
        <div className="admin-metric"><span>Payments balance</span><strong>{stripeMoney(balance, (b) => b.available + b.pending)}</strong><small>{balance.ok && balance.data.pending ? `${formatMoney(balance.data.pending)} still settling` : hasTreasury ? "Auto-transfers to the business account" : "Available and settling"}</small></div>
        {(!hasTreasury || nextPayout) && (
          <div className="admin-metric">
            <span>Next payout</span>
            <strong>{payouts.ok ? (nextPayout ? formatMoney(nextPayout.amount) : "None") : "—"}</strong>
            <small>{payouts.ok ? (nextPayout ? `Arrives ${formatDate(unixToSalesDate(nextPayout.arrivalDate))}` : "Nothing scheduled") : "Stripe unavailable"}</small>
          </div>
        )}
        <Link className="admin-metric" href="/admin/billing?status=paid"><span>Collected</span><strong>{formatMoney(collectedTotal)}</strong><small>{paymentCount} paid invoice{paymentCount === 1 ? "" : "s"}{refundTotal ? ` · ${formatMoney(refundTotal)} refunded` : ""}</small></Link>
        <Link className="admin-metric" href="/admin/billing?status=overdue"><span>Outstanding</span><strong>{formatMoney(owed.openCents)}</strong><small>{owed.overdueCount} overdue · {formatMoney(owed.overdueCents)}</small></Link>
      </section>

      <section className="admin-panel fpanel-hero" aria-labelledby="flow-title">
        <div className="admin-panel-head">
          <div><h2 id="flow-title">Money flow</h2><p>Open pipeline (weighted), won, invoiced and paid in {range.label.toLowerCase()}, then where the paid money went. Hover a band for the amount.</p></div>
        </div>
        <div className="finance-body"><MoneyFlow input={flowInput} periodLabel={range.label} /></div>
      </section>

      <section className="admin-panel finance-section" aria-labelledby="runway-title">
        <div className="admin-panel-head">
          <div><h2 id="runway-title">Runway</h2><p>The balance through {range.label.toLowerCase()}, rebuilt from Stripe activity, and the next 60 days if open invoices are paid on their due dates and commission statements go out on the 5th.</p></div>
        </div>
        <div className="finance-body">
          {runway ? <Runway {...runway} /> : <p className="small muted">{connected ? "The runway draws from Stripe's balance and activity, which aren't available right now." : "Connect Stripe to see the balance over time and where it's heading."}</p>}
        </div>
      </section>

      <section className="admin-panel finance-section" aria-labelledby="goal-title">
        <div className="admin-panel-head">
          <div><h2 id="goal-title">Goal</h2><p>Cash collected this year against the revenue target.</p></div>
          <Link href="/admin/settings#ws-goal">Target</Link>
        </div>
        <div className="finance-body">
          <GoalDial ytdCents={ytdCents} goalCents={goalCents} balanceCents={live.balanceCents} balanceLabel={live.balanceSource === "payments" ? "payments balance" : "business account"} today={today} />
        </div>
      </section>

      <section className="admin-panel finance-section" aria-labelledby="race-title">
        <div className="admin-panel-head">
          <div><h2 id="race-title">The race</h2><p>Cash collected and deals won by owner, this month and this year.</p></div>
        </div>
        <div className="finance-body"><Race {...race} today={today} /></div>
      </section>

      <section className="admin-panel finance-section" aria-labelledby="heat-title" id="heat">
        <div className="admin-panel-head">
          <div><h2 id="heat-title">The year, day by day</h2><p>The last 12 months in Florida time, whatever the period above. Hover a day for its number.</p></div>
        </div>
        <div className="finance-body">
          <HeatMap metric={heat} values={heatValues} startIso={yearStart} endIso={today} hrefFor={(m) => `/admin/finance?${new URLSearchParams({ period, ...(m === "cash" ? {} : { heat: m }) })}#heat`} />
        </div>
      </section>

      <section className="admin-panel finance-section" aria-labelledby="funnel-title">
        <div className="admin-panel-head">
          <div><h2 id="funnel-title">Funnel</h2><p>How many deals reached each stage in {range.label.toLowerCase()}, and how many went on. Click a stage to see those clients.</p></div>
        </div>
        <div className="finance-body"><Funnel {...funnelData} periodLabel={range.label} /></div>
      </section>

      <section className="admin-panel finance-section" aria-labelledby="revenue-title">
        <div className="admin-panel-head">
          <div><h2 id="revenue-title">Revenue</h2><p>Paid invoices by {range.bucket}, from the portal. The line is Stripe&apos;s net after fees and refunds.</p></div>
        </div>
        <div className="finance-body">
          <StackedBars
            label={`Revenue by ${range.bucket}`}
            series={revenue}
            colors={["var(--amber)", "var(--danger)"]}
            legend={["Collected, kept", "Refunded"]}
            line={activity.ok ? { values: activity.data.buckets.map((b) => b.net), label: "Stripe net", color: "var(--ink)" } : undefined}
          />
        </div>
      </section>

      <div className="finance-grid">
        <section className="admin-panel" aria-labelledby="stripe-title">
          <div className="admin-panel-head"><div><h2 id="stripe-title">Stripe</h2><p>Every charge on the account, portal or not.</p></div></div>
          {activity.ok ? (
            <div className="finance-body">
              <dl className="finance-figures">
                <div><dt>Gross</dt><dd>{formatMoney(activity.data.totals.gross)}</dd></div>
                <div><dt>Fees{activity.data.totals.gross > 0 ? ` · ${((activity.data.totals.fees / activity.data.totals.gross) * 100).toFixed(1)}%` : ""}</dt><dd>{formatMoney(activity.data.totals.fees)}</dd></div>
                <div><dt>Net</dt><dd>{formatMoney(activity.data.totals.net)}</dd></div>
              </dl>
              {activity.data.capped && <p className="small muted">Showing the first 2,000 Stripe transactions in this period.</p>}
            </div>
          ) : (
            <p className="admin-empty">{connected ? "Stripe totals are unavailable right now." : "Connect Stripe to see gross, fees and net."}</p>
          )}
          {charges.ok && charges.data.length > 0 && (
            <>
              <h3 className="finance-subhead">Recent charges</h3>
              <div className="finance-table-scroll">
                <table className="finance-table">
                  <thead><tr><th>Date</th><th>For</th><th className="num">Amount</th><th>Receipt</th></tr></thead>
                  <tbody>
                    {charges.data.map((c) => {
                      const inv = c.paymentIntent ? chargeInvoices.get(c.paymentIntent) : undefined;
                      return (
                        <tr key={c.id}>
                          <td>{formatDate(unixToSalesDate(c.created))}</td>
                          <td>
                            {inv ? <Link href={`/projects/${inv.projectId}/billing#invoice-${inv.id}`}>{inv.clientName} · {inv.number}</Link> : (c.description ?? "Outside the portal")}
                            {c.status !== "succeeded" && <small>{c.status}</small>}
                          </td>
                          <td className="num">{formatMoney(c.amount)}{c.refunded > 0 && <small>{formatMoney(c.refunded)} refunded</small>}</td>
                          <td>{c.receiptUrl ? <a href={c.receiptUrl} target="_blank" rel="noreferrer">Receipt</a> : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {payouts.ok && payouts.data.recent.length > 0 && (
            <>
              <h3 className="finance-subhead">Payouts</h3>
              <div className="finance-table-scroll">
                <table className="finance-table">
                  <thead><tr><th>Arrives</th><th>Status</th><th className="num">Amount</th></tr></thead>
                  <tbody>
                    {payouts.data.recent.map((p) => (
                      <tr key={p.id}>
                        <td>{formatDate(unixToSalesDate(p.arrivalDate))}</td>
                        <td><span className={`chip ${p.status === "paid" ? "chip-ok" : p.status === "failed" || p.status === "canceled" ? "" : "chip-amber"}`}>{p.status.replace("_", " ")}</span></td>
                        <td className="num">{formatMoney(p.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>

        <section className="admin-panel" aria-labelledby="owed-title">
          <div className="admin-panel-head"><div><h2 id="owed-title">Owed to SKOX</h2><p>Open invoices now, and the pipeline weighted by stage.</p></div></div>
          <div className="finance-body">
            {owed.openCents > 0 ? (
              <Donut
                caption="outstanding"
                center={formatMoney(owed.openCents)}
                parts={[
                  { label: "Not yet due", value: notDue, color: "var(--amber)", tip: `Not yet due ${formatMoney(notDue)}` },
                  { label: "Overdue", value: owed.overdueCents, color: "var(--danger)", tip: `Overdue ${formatMoney(owed.overdueCents)} (${owed.overdueCount})` },
                ]}
              />
            ) : (
              <p className="small muted">No open invoices.</p>
            )}
            <div className="finance-pipeline">
              <p>Weighted pipeline</p>
              <strong>{formatMoney(pipeline.weightedCents)}</strong>
              <p>of {formatMoney(pipeline.valueCents)} in open deals</p>
            </div>
            {pipeline.stages.length > 0 && (
              <BarChart
                label="Weighted pipeline by stage"
                series={(["lead", "initial_outreach", "proposal_sent", "negotiation"] as const).map((stage) => {
                  const s = pipeline.stages.find((r) => r.stage === stage);
                  const label = columnLabel(stage);
                  return { key: stage, label, value: s?.weightedCents ?? 0, tip: `${label}: ${s?.count ?? 0} deals · ${formatMoney(s?.valueCents ?? 0)} × ${Math.round((s?.weight ?? 0) * 100)}% = ${formatMoney(s?.weightedCents ?? 0)}` };
                })}
              />
            )}
          </div>
        </section>
      </div>

      <section className="admin-panel finance-section" aria-labelledby="won-title">
        <div className="admin-panel-head">
          <div><h2 id="won-title">Deals won</h2><p>{wonCount} won · {formatMoney(wonValue)} agreed value. Dated by when each deal first reached Won.</p></div>
          <Link href="/admin/pipeline">Pipeline</Link>
        </div>
        <div className="finance-body">
          <StackedBars label={`Deals won by ${range.bucket}`} series={wonSeries} colors={[...top.map((_, i) => (i === 0 ? "var(--amber)" : "var(--ink)")), "var(--muted)"]} legend={groups} format={axisCount} />
        </div>
      </section>

      <section className="admin-panel finance-section" aria-labelledby="team-title">
        <div className="admin-panel-head">
          <div><h2 id="team-title">Team</h2><p>Deals and cash for {range.label.toLowerCase()}. Commission owed is everything not yet paid.</p></div>
          <Link href="/admin/commissions">Commissions</Link>
        </div>
        {leaders.length === 0 ? (
          <p className="admin-empty">No deals won or commission yet in this period.</p>
        ) : (
          <div className="finance-table-scroll">
            <table className="finance-table">
              <thead><tr><th>Person</th><th className="num">Deals won</th><th className="num">Won value</th><th className="num">Collected</th><th className="num">Commission owed</th></tr></thead>
              <tbody>
                {leaders.map((l) => (
                  <tr key={l.email ?? "none"}>
                    <td>{l.repMembershipId ? l.name : nameFor(l.email)}{l.email && <small>{l.email}</small>}</td>
                    <td className="num">{l.dealsWon}</td>
                    <td className="num">{formatMoney(l.wonValueCents)}</td>
                    <td className="num">{formatMoney(l.collectedCents)}</td>
                    <td className="num">{l.owedCents === null ? "—" : l.repMembershipId ? <Link href={`/admin/commissions?rep=${l.repMembershipId}#ledger`}>{formatMoney(l.owedCents)}</Link> : formatMoney(l.owedCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="finance-section"><ActivityFeed /></div>
    </main>
    </LiveProvider>
  );
}

function stripeMoney<T>(read: StripeRead<T>, pick: (data: T) => number) {
  return read.ok ? formatMoney(pick(read.data)) : "—";
}
