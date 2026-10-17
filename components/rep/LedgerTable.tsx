import { formatRate } from "@/lib/commission-math";
import { formatMoney } from "@/lib/format";

type Line = {
  id: string;
  kind: "earned" | "clawback" | "adjustment";
  clientName: string | null;
  baseCents: number;
  rateBps: number;
  amountCents: number;
  status: "pending" | "approved" | "paid" | "void";
  earnedAt: Date;
  note: string | null;
  repMembershipId?: string;
};

const KIND = { earned: "Payment", clawback: "Refund", adjustment: "Adjustment" } as const;
const STATUS = { pending: "Pending", approved: "Approved", paid: "Paid", void: "Void" } as const;

function day(d: Date) {
  return d.toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric" });
}

/** The commission ledger, as reps and staff both see it. */
export function LedgerTable({ lines, showStatus = true, rep }: { lines: Line[]; showStatus?: boolean; rep?: (l: Line) => string }) {
  return (
    <div className="table-wrap">
      <table className="rep-table">
        <thead>
          <tr>
            <th>Date</th>
            {rep && <th>Rep</th>}
            <th>Client</th>
            <th>Type</th>
            <th className="num">Collected</th>
            <th className="num">Rate</th>
            <th className="num">You earn</th>
            {showStatus && <th>Status</th>}
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.id}>
              <td data-label="">{day(l.earnedAt)}</td>
              {rep && <td data-label="Rep">{rep(l)}</td>}
              <td data-label="">{l.clientName ?? "—"}{l.kind === "adjustment" && l.note ? <span className="small muted"> · {l.note}</span> : null}</td>
              <td data-label="">{KIND[l.kind]}</td>
              <td className="num rep-money" data-label="Collected">{l.kind === "adjustment" ? "—" : formatMoney(l.kind === "clawback" ? -l.baseCents : l.baseCents)}</td>
              <td className="num" data-label="Rate">{l.kind === "adjustment" ? "—" : formatRate(l.rateBps)}</td>
              <td className="num rep-money" data-label="" data-negative={l.amountCents < 0 ? "" : undefined}>{formatMoney(l.amountCents)}</td>
              {showStatus && <td data-label="">{STATUS[l.status]}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
