import { financeWithdrawals } from "@/lib/finance-withdrawals";
import { EarningsBreakdown } from "@/components/finance/EarningsBreakdown";
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
import { requireStaff } from "@/lib/access";
import { HEAT_METRICS, invoicesByPaymentIntent, leaderboard, outstanding, type HeatMetric } from "@/lib/finance-data";
import { loadMission } from "@/lib/finance-mission";
import { bucketKeys, bucketLabel, parsePeriod, periodRange, unixToSalesDate } from "@/lib/finance-periods";
import { stripeCharges, stripePayouts, type StripeRead } from "@/lib/finance-stripe";
import { firstName, formatDate, formatMoney } from "@/lib/format";
import { columnLabel } from "@/lib/pipeline";
import { stripeEnabled } from "@/lib/stripe";
import { FlowPanel, FunnelPanel, GoalPanel, HeatPanel, RacePanel, RunwayPanel } from "./panels";
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
  const connected = stripeEnabled();

  const [m, owed, leaders, payouts, charges, withdrawals] = await Promise.all([
    loadMission(ws, range, heat, fresh),
    outstanding(ws),
    leaderboard(ws, range),
    stripePayouts(fresh),
    stripeCharges(range, fresh),
    financeWithdrawals(ws, fresh),
  ]);
  const { collected, refunds, won, pipeline, balance, activity, treasury, hasTreasury, collectedTotal, refundTotal, wonValue } = m.reads;
  const live = m.live;
  const nextPayout = payouts.ok ? payouts.data.next : null;
  const chargeInvoices = charges.ok ? await invoicesByPaymentIntent(ws, charges.data.flatMap((c) => (c.paymentIntent ? [c.paymentIntent] : []))) : new Map();

  const keys = bucketKeys(range);
  const labels = keys.map((k) => bucketLabel(k, range.bucket));
  const paymentCount = collected.reduce((s, b) => s + b.value.count, 0);
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

  const notDue = owed.openCents - owed.overdueCents;
  const heatHref = (metric: HeatMetric) => `/admin/finance?${new URLSearchParams({ period, ...(metric === "cash" ? {} : { heat: metric }) })}#heat`;

  return (
    <LiveProvider initial={live}>
      <main data-theme="mission" className="fmission">
        <div className="shell page fmission-shell">
          <LiveTicker />
          <div className="fmission-grid">
            <div className="fmission-main">
              <div className="page-head">
                <div>
                  <p className="eyebrow">Mission control</p>
                  <h1>Finance</h1>
                  <p className="muted">Stripe balance and payouts, cash collected, money owed, deals won and commission. {range.label}, in Florida time.</p>
                </div>
                <div className="finance-head-actions">
                  <PeriodSwitcher path="/admin/finance" current={period} params={heat === "cash" ? {} : { heat }} />
                  {connected && <Link className="btn btn-ghost btn-small" href={`/admin/finance?period=${period}&fresh=1`}>Refresh Stripe</Link>}
                  <Link className="btn btn-ghost btn-small fwall-link" href={`/admin/finance/wall?period=${period}`} target="_blank" rel="noopener">Wall mode ↗</Link>
                </div>
              </div>

              {!connected ? (
                <p className="finance-strip"><strong>Connect Stripe</strong> to see balance, fees and payouts here. Add a restricted key with read access to Balance, Payouts, Charges, PaymentIntents and Financial accounts (Money management) as STRIPE_SECRET_KEY. Portal numbers below are complete without it.</p>
              ) : failures.length > 0 ? (
                <p className="finance-strip" role="status"><strong>Stripe unavailable:</strong> {failures.join("; ")}. Portal numbers below are unaffected.</p>
              ) : null}

              <section className="admin-metrics finance-metrics" aria-label="Money summary">
                {hasTreasury && treasury.ok && (
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

              <EarningsBreakdown data={withdrawals} people={leaders.flatMap(l => l.repMembershipId ? [{ id: l.repMembershipId, name: l.name }] : [])} />
              <FlowPanel m={m} />

              <div className="fmission-cols">
                <RunwayPanel m={m} connected={connected} />
                <div className="fmission-stack">
                  <GoalPanel m={m} />
                  <RacePanel m={m} />
                </div>
              </div>

              <HeatPanel m={m} hrefFor={heatHref} />

              <div className="fmission-cols fmission-cols-even">
                <FunnelPanel m={m} />
                <section className="admin-panel" aria-labelledby="revenue-title">
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
              </div>

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

              <section className="admin-panel" aria-labelledby="won-title">
                <div className="admin-panel-head">
                  <div><h2 id="won-title">Deals won</h2><p>{wonCount} won · {formatMoney(wonValue)} agreed value. Dated by when each deal first reached Won.</p></div>
                  <Link href="/admin/pipeline">Pipeline</Link>
                </div>
                <div className="finance-body">
                  <StackedBars label={`Deals won by ${range.bucket}`} series={wonSeries} colors={[...top.map((_, i) => (i === 0 ? "var(--amber)" : "var(--ink)")), "var(--muted)"]} legend={groups} format={axisCount} />
                </div>
              </section>

              <section className="admin-panel" aria-labelledby="team-title">
                <div className="admin-panel-head">
                  <div><h2 id="team-title">Team</h2><p>Deals and cash for {range.label.toLowerCase()}. Gross earnings are all-time, after refunds and before expenses. See the withdrawal breakdown above for available cash.</p></div>
                  <Link href="/admin/commissions">Commissions</Link>
                </div>
                {leaders.length === 0 ? (
                  <p className="admin-empty">No deals won or commission yet in this period.</p>
                ) : (
                  <div className="finance-table-scroll">
                    <table className="finance-table">
                      <thead><tr><th>Person</th><th className="num">Deals won</th><th className="num">Won value</th><th className="num">Collected</th><th className="num">Gross earnings</th></tr></thead>
                      <tbody>
                        {leaders.map((l) => (
                          <tr key={l.email ?? "none"}>
                            <td>{l.repMembershipId ? l.name : nameFor(l.email)}{l.email && <small>{l.email}</small>}</td>
                            <td className="num">{l.dealsWon}</td>
                            <td className="num">{formatMoney(l.wonValueCents)}</td>
                            <td className="num">{formatMoney(l.collectedCents)}</td>
                            <td className="num">{l.owedCents === null ? "—" : l.repMembershipId ? <Link href={`/admin/commissions?rep=${l.repMembershipId}#ledger`}>{formatMoney(withdrawals.rows.get(l.repMembershipId ?? "")?.grossCents ?? 0)}</Link> : formatMoney(withdrawals.rows.get(l.repMembershipId ?? "")?.grossCents ?? 0)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>
            <aside className="fmission-rail" aria-label="Live activity">
              <ActivityFeed />
            </aside>
          </div>
        </div>
      </main>
    </LiveProvider>
  );
}

function stripeMoney<T>(read: StripeRead<T>, pick: (data: T) => number) {
  return read.ok ? formatMoney(pick(read.data)) : "—";
}
