import { money } from "@/components/rep/Money";
import { formatRate } from "@/lib/commission-math";

export type ReceiptLine = {
  id: string;
  kind: "earned" | "clawback" | "adjustment";
  clientName: string | null;
  baseCents: number;
  rateBps: number;
  amountCents: number;
  status: "pending" | "approved" | "paid" | "void";
  earnedAt: Date;
  note: string | null;
};

const STATUS = { pending: "THIS MONTH", approved: "ON THE WAY", paid: "PAID", void: "VOID" } as const;

function day(d: Date) {
  return d.toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" });
}

/** One line of the money feed: "Bayside Plumbing paid $5,000 → you made $750". */
export function Receipt({ line }: { line: ReceiptLine }) {
  const who = line.clientName ?? "SKOX";
  const headline =
    line.kind === "earned" ? `${who} paid ${money(line.baseCents)}`
    : line.kind === "clawback" ? `${who} was refunded ${money(line.baseCents)}`
    : line.note ?? "Adjustment";
  const detail =
    line.kind === "adjustment" ? `${day(line.earnedAt)} · adjustment from SKOX`
    : `${day(line.earnedAt)} · ${formatRate(line.rateBps)} ${line.kind === "clawback" ? "clawed back" : "to you"}`;
  return (
    <li className="rp-receipt" data-kind={line.kind}>
      <strong>{headline}</strong>
      <small>{detail}</small>
      <b>
        {line.amountCents >= 0 ? "+" : ""}
        {money(line.amountCents)}
        <em>{STATUS[line.status]}</em>
      </b>
    </li>
  );
}
