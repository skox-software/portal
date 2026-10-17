import "./earnings-breakdown.css";
import { formatMoney } from "@/lib/format";
import type { financeWithdrawals } from "@/lib/finance-withdrawals";

type Props = { data: Awaited<ReturnType<typeof financeWithdrawals>>; people: { id: string; name: string }[] };
export function EarningsBreakdown({ data, people }: Props) {
  return <section className="admin-panel" aria-labelledby="earnings-breakdown-title">
    <div className="admin-panel-head"><div>
      <h2 id="earnings-breakdown-title">Gross earnings & available to withdraw</h2>
      <p>All-time earnings after refunds, before fees and expenses. Deal ownership stays unchanged.</p>
    </div></div>
    <div style={{ overflowX: "auto", padding: "0 24px 20px" }}>
      <table className="earnings-table">
        <thead><tr><th>Person</th><th>Gross earnings</th><th>Stripe fees</th><th>Business expenses</th><th>Available to withdraw</th></tr></thead>
        <tbody>{people.map(person => {
          const r = data.rows.get(person.id);
          return <tr key={person.id}>
            <td>{person.name}</td>
            <td>{formatMoney(r?.grossCents ?? 0)}</td>
            <td>{r?.feesCents === null ? "Unavailable" : formatMoney(r?.feesCents ?? 0)}</td>
            <td>{formatMoney(r?.expensesCents ?? 0)}{data.expenses.filter(e => e.membershipId === person.id).map(e => <small key={e.id} style={{ display: "block" }}>{e.description}</small>)}</td>
            <td><strong>{r ? r.availableCents === null ? "Unavailable" : formatMoney(r.availableCents) : formatMoney(0)}</strong></td>
          </tr>;
        })}</tbody>
      </table>
      <p className="small muted">Available = unpaid earnings and adjustments − actual invoice Stripe fees − recorded business expenses. Previous withdrawals are excluded. Cash already reflects expenses, so they are not deducted twice.</p>
      <p className="small muted">{data.cashCents === null ? "Live business balance unavailable; withdrawal amounts cannot be confirmed." : `Live business balance: ${formatMoney(data.cashCents)}. If cash is short, availability is reduced proportionally across positive balances.`} Refresh Finance to update. This is a cash estimate, not a payout or an approved statement.</p>
    </div>
  </section>;
}
