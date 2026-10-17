/**
 * Totals Stripe balance transactions into the dashboard's buckets. Pure, so it
 * can be tested alone.
 *
 * Amounts are cents as Stripe reports them: a charge is positive, a refund or
 * payout negative, and `fee` is always what Stripe kept. Here every figure is
 * reported as a positive size, except `net`, which is what actually landed
 * in the balance from activity (payouts are excluded: moving money to the
 * bank isn't income or cost).
 */

import { bucketKeys, bucketOf, unixToSalesDate, type PeriodRange } from "./finance-periods.ts";

export type BalanceTxnLike = { type: string; amount: number; fee: number; net: number; created: number };
export type FeeBucket = { key: string; gross: number; fees: number; net: number; refunds: number; payouts: number };

const CHARGE_TYPES = new Set(["charge", "payment"]);
const REFUND_TYPES = new Set(["refund", "payment_refund", "payment_failure_refund"]);
const PAYOUT_TYPES = new Set(["payout", "payout_cancel", "payout_failure"]);

function empty(key: string): FeeBucket {
  return { key, gross: 0, fees: 0, net: 0, refunds: 0, payouts: 0 };
}

export function sumBalanceTransactions(txns: BalanceTxnLike[], range: PeriodRange) {
  const keys = bucketKeys(range);
  const byKey = new Map(keys.map((k) => [k, empty(k)]));
  const totals = empty("total");
  for (const t of txns) {
    const key = bucketOf(unixToSalesDate(t.created), range);
    const bucket = key ? byKey.get(key) : undefined;
    if (!bucket) continue;
    for (const b of [bucket, totals]) {
      if (CHARGE_TYPES.has(t.type)) {
        b.gross += t.amount;
        b.fees += t.fee;
        b.net += t.net;
      } else if (REFUND_TYPES.has(t.type)) {
        b.refunds += -t.amount;
        b.fees += t.fee;
        b.net += t.net;
      } else if (PAYOUT_TYPES.has(t.type)) {
        b.payouts += -t.amount;
      } else if (t.type === "stripe_fee") {
        // Stripe's own billing (Radar, Billing, etc.): the whole amount is a fee.
        b.fees += -t.amount;
        b.net += t.net;
      } else {
        // Adjustments, disputes and the like move the balance without being sales.
        b.net += t.net;
      }
    }
  }
  return { buckets: keys.map((k) => byKey.get(k)!), totals };
}
