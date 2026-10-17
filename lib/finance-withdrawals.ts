import { and, eq, ne } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { commissionEntries, invoices, withdrawalExpenses } from "@/lib/db/schema";
import { stripeInvoiceFee, stripeTreasury } from "@/lib/finance-stripe";
import { withdrawalAmounts } from "@/lib/withdrawal-math";

/** Lifetime earnings and cash eligibility; independent of the dashboard's revenue period. */
export async function financeWithdrawals(ws: string, fresh = false) {
  const db = getDb();
  const [entries, expenses, treasury] = await Promise.all([
    db.select({ entry: commissionEntries, intent: invoices.stripePaymentIntentId, number: invoices.number })
      .from(commissionEntries).leftJoin(invoices, eq(commissionEntries.invoiceId, invoices.id))
      .where(and(eq(commissionEntries.workspaceId, ws), ne(commissionEntries.status, "void"))),
    db.select().from(withdrawalExpenses).where(eq(withdrawalExpenses.workspaceId, ws)),
    stripeTreasury(fresh),
  ]);
  const reversed = new Set(entries.flatMap(({ entry }) => entry.reversalOf ? [entry.reversalOf] : []));
  const earned = entries.filter(({ entry }) => entry.kind === "earned" && !reversed.has(entry.id));
  const fees = new Map(await Promise.all(earned.map(async ({ entry: e, intent, number }) => [e.id,
    e.invoiceId && number ? await stripeInvoiceFee({ id: e.invoiceId, number, intent, paidAt: e.earnedAt, amount: e.baseCents }, fresh) : null,
  ] as const)));
  const rows = new Map<string, { id: string; grossCents: number; unpaidCents: number; feesCents: number | null; expensesCents: number }>();
  function row(id: string) {
    if (!rows.has(id)) rows.set(id, { id, grossCents: 0, unpaidCents: 0, feesCents: 0, expensesCents: 0 });
    return rows.get(id)!;
  }
  for (const { entry: e } of entries) {
    const r = row(e.repMembershipId);
    if (e.status === "pending" || e.status === "approved") r.unpaidCents += e.amountCents;
    if (e.kind !== "adjustment" || e.reversalOf) r.grossCents += e.amountCents;
  }
  for (const { entry: e } of earned) {
    const r = row(e.repMembershipId);
    const fee = fees.get(e.id);
    // Multiple payment events for one invoice need explicit charge matching before quoting cash.
    const repeats = earned.filter(other => other.entry.repMembershipId === e.repMembershipId && other.entry.invoiceId === e.invoiceId).length > 1;
    if (!fee?.ok || fee.data.amount !== e.baseCents || repeats) r.feesCents = null;
    else if (r.feesCents !== null) r.feesCents += Math.round(fee.data.fee * e.rateBps / 10000);
  }
  for (const expense of expenses) row(expense.membershipId).expensesCents += expense.amountCents;
  const cash = treasury.ok && treasury.data.accounts.length ? treasury.data.cash : null;
  return {
    rows: new Map(withdrawalAmounts([...rows.values()], cash).map(r => [r.id, r])),
    expenses,
    cashCents: cash,
  };
}
