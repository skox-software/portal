import { and, desc, eq, ne } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { Notice, readMessage } from "@/components/Notice";
import { SubmitButton } from "@/components/SubmitButton";
import { LedgerTable } from "@/components/rep/LedgerTable";
import { requireStaff } from "@/lib/access";
import { EMPTY_TOTALS, repTotals, workspaceReps } from "@/lib/commissions";
import { periodLabel, previousMonth } from "@/lib/commission-math";
import { getDb } from "@/lib/db";
import { commissionEntries, commissionStatements } from "@/lib/db/schema";
import { formatMoney } from "@/lib/format";
import { salesToday } from "@/lib/follow-up";
import { withBase } from "@/lib/paths";
import { canApproveCommissions } from "@/lib/permissions";
import { addAdjustment, approve, closeMonth, discard, markPaid } from "./actions";
import "../reps/reps-admin.css";

export const metadata: Metadata = { title: "Commissions" };

const STATUS_LABEL = { draft: "Draft · needs approval", approved: "Approved · pay it", paid: "Paid", void: "Void" } as const;

export default async function AdminCommissions({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const { staff } = await requireStaff();
  const owner = canApproveCommissions(staff.role);
  const ws = staff.workspaceId;
  const db = getDb();
  const repFilter = typeof sp.rep === "string" ? sp.rep : "";
  const [reps, totals, statements, entries] = await Promise.all([
    workspaceReps(ws),
    repTotals(ws),
    db.select().from(commissionStatements).where(eq(commissionStatements.workspaceId, ws)).orderBy(desc(commissionStatements.periodStart)).limit(60),
    db
      .select()
      .from(commissionEntries)
      .where(and(eq(commissionEntries.workspaceId, ws), ne(commissionEntries.status, "void"), ...(repFilter ? [eq(commissionEntries.repMembershipId, repFilter)] : [])))
      .orderBy(desc(commissionEntries.earnedAt))
      .limit(200),
  ]);
  const nameOf = new Map(reps.map((r) => [r.membership.id, r.profile.displayName]));
  const open = statements.filter((s) => s.status === "draft" || s.status === "approved");
  const closed = statements.filter((s) => s.status === "paid");
  const owed = [...totals.values()].reduce((s, t) => s + t.pending + t.approved, 0);
  const paidYear = [...totals.values()].reduce((s, t) => s + t.paidThisYear, 0);
  const last = previousMonth(salesToday());
  const year = new Date().getFullYear();

  return (
    <main className="shell page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Sales team</p>
          <h1>Commissions</h1>
          <p className="muted">Reps earn their rate on every paid invoice from clients they brought. Refunds claw back at the same rate. Each month closes into statements on the 1st.</p>
        </div>
        <div className="pipeline-head-actions">
          <Link className="btn btn-ghost" href="/admin/reps">Reps</Link>
          {owner && <a className="btn btn-ghost" href={withBase(`/api/commissions/export?year=${year}`)}>1099 export {year}</a>}
        </div>
      </div>
      <Notice error={readMessage(sp.error)} notice={readMessage(sp.notice)} />

      <div className="admin-metrics">
        <div className="admin-metric"><span>Owed to reps</span><strong>{formatMoney(owed)}</strong></div>
        <div className="admin-metric"><span>Statements to act on</span><strong>{open.length}</strong></div>
        <div className="admin-metric"><span>Paid in {year}</span><strong>{formatMoney(paidYear)}</strong></div>
        <div className="admin-metric"><span>Reps</span><strong>{reps.length}</strong></div>
      </div>

      <div className="rep-grid">
        <div className="stack">
          <section className="admin-panel" aria-labelledby="open-title">
            <div className="admin-panel-head">
              <h2 id="open-title">Statements to act on</h2>
              <form action={closeMonth} className="row">
                <input type="hidden" name="month" value={last.start.slice(0, 7)} />
                <SubmitButton className="btn btn-ghost btn-small" pendingLabel="Closing…">Close {periodLabel(last.start)}</SubmitButton>
              </form>
            </div>
            {open.length === 0 ? (
              <p className="rep-empty">Nothing waiting. Statements appear here when a month closes.</p>
            ) : (
              <ul className="rep-list">
                {open.map((s) => (
                  <li key={s.id} style={{ padding: "16px 24px", display: "grid", gap: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                      <div>
                        <strong>{nameOf.get(s.repMembershipId) ?? "Rep"} · {periodLabel(s.periodStart)}</strong>
                        <div className="small muted">{STATUS_LABEL[s.status]}</div>
                      </div>
                      <strong className="rep-money" style={{ fontSize: 18 }}>{formatMoney(s.totalCents)}</strong>
                    </div>
                    {owner ? (
                      <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
                        <Link className="btn btn-ghost btn-small" href={`/admin/commissions?rep=${s.repMembershipId}#ledger`}>See lines</Link>
                        {s.status === "draft" && (
                          <>
                            <form action={approve}><input type="hidden" name="statementId" value={s.id} /><SubmitButton className="btn btn-primary btn-small" pendingLabel="Approving…">Approve</SubmitButton></form>
                            <form action={discard}><input type="hidden" name="statementId" value={s.id} /><SubmitButton className="btn btn-ghost btn-small" pendingLabel="…">Discard draft</SubmitButton></form>
                          </>
                        )}
                        {s.status === "approved" && (
                          <form action={markPaid} className="row" style={{ gap: 8 }}>
                            <input type="hidden" name="statementId" value={s.id} />
                            <label className="sr-only" htmlFor={`ref-${s.id}`}>Payment reference</label>
                            <input id={`ref-${s.id}`} name="reference" placeholder="Transfer reference" maxLength={200} style={{ maxWidth: 220 }} />
                            <SubmitButton className="btn btn-primary btn-small" pendingLabel="Saving…">Mark paid</SubmitButton>
                          </form>
                        )}
                      </div>
                    ) : (
                      <p className="small muted">Waiting on the workspace owner.</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="admin-panel" id="ledger" aria-labelledby="ledger-title">
            <div className="admin-panel-head">
              <h2 id="ledger-title">Ledger{repFilter && nameOf.get(repFilter) ? ` · ${nameOf.get(repFilter)}` : ""}</h2>
              <form className="row" style={{ gap: 8 }}>
                <label className="sr-only" htmlFor="ledger-rep">Rep</label>
                <select id="ledger-rep" name="rep" defaultValue={repFilter} style={{ width: "auto" }}>
                  <option value="">All reps</option>
                  {reps.map((r) => <option key={r.membership.id} value={r.membership.id}>{r.profile.displayName}</option>)}
                </select>
                <button className="btn btn-ghost btn-small" type="submit">Show</button>
              </form>
            </div>
            {entries.length === 0 ? <p className="rep-empty">No commission lines yet. They appear when a client with a credited rep pays an invoice.</p> : <LedgerTable lines={entries} rep={(l) => nameOf.get(l.repMembershipId ?? "") ?? "—"} />}
          </section>
        </div>

        <aside className="stack">
          <section className="admin-panel" aria-labelledby="totals-title">
            <div className="admin-panel-head"><h2 id="totals-title">By rep</h2></div>
            {reps.length === 0 ? (
              <p className="rep-empty"><Link href="/admin/reps">Invite your first rep</Link>.</p>
            ) : (
              <ul className="rep-list">
                {reps.map((r) => {
                  const t = totals.get(r.membership.id) ?? EMPTY_TOTALS;
                  return (
                    <li key={r.membership.id}>
                      <Link className="rep-row" href={`/admin/commissions?rep=${r.membership.id}#ledger`}>
                        <strong>{r.profile.displayName}</strong>
                        <span className="rep-money">{formatMoney(t.pending + t.approved)} owed</span>
                        <small>{formatMoney(t.paidThisYear)} paid in {year}</small>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
          {owner && reps.length > 0 && (
            <form action={addAdjustment} className="card stack">
              <div className="card-head"><h2>Add an adjustment</h2></div>
              <div className="field">
                <label htmlFor="adj-rep">Rep</label>
                <select id="adj-rep" name="membershipId" required>{reps.map((r) => <option key={r.membership.id} value={r.membership.id}>{r.profile.displayName}</option>)}</select>
              </div>
              <div className="field">
                <label htmlFor="adj-amount">Amount</label>
                <input id="adj-amount" name="amount" inputMode="decimal" placeholder="250.00 or -100.00" required />
                <span className="hint">Negative to deduct. Goes on the next statement.</span>
              </div>
              <div className="field">
                <label htmlFor="adj-note">Reason</label>
                <input id="adj-note" name="note" required minLength={3} maxLength={300} placeholder="Bonus for first close" />
                <span className="hint">The rep sees this.</span>
              </div>
              <div><SubmitButton className="btn btn-primary btn-small" pendingLabel="Adding…">Add adjustment</SubmitButton></div>
            </form>
          )}
          {closed.length > 0 && (
            <section className="admin-panel" aria-labelledby="paid-title">
              <div className="admin-panel-head"><h2 id="paid-title">Paid statements</h2></div>
              <ul className="rep-list">
                {closed.slice(0, 12).map((s) => (
                  <li key={s.id} className="rep-row" style={{ cursor: "default" }}>
                    <strong>{nameOf.get(s.repMembershipId)} · {periodLabel(s.periodStart)}</strong>
                    <span className="rep-money">{formatMoney(s.totalCents)}</span>
                    {s.paymentReference && <small>Ref {s.paymentReference}</small>}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </main>
  );
}
