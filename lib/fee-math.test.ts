import assert from "node:assert/strict";
import { test } from "node:test";
import { periodRange } from "./finance-periods.ts";
import { sumBalanceTransactions } from "./fee-math.ts";

const range = periodRange("12m", "2026-10-17");
const at = (iso: string) => Date.parse(iso) / 1000;

test("charges, refunds and payouts land in their month", () => {
  const { buckets, totals } = sumBalanceTransactions([
    { type: "charge", amount: 500_000, fee: 14_530, net: 485_470, created: at("2026-09-10T15:00:00Z") },
    { type: "refund", amount: -50_000, fee: 0, net: -50_000, created: at("2026-09-20T15:00:00Z") },
    { type: "payout", amount: -435_470, fee: 0, net: -435_470, created: at("2026-10-02T15:00:00Z") },
    { type: "stripe_fee", amount: -500, fee: 0, net: -500, created: at("2026-10-03T15:00:00Z") },
  ], range);
  const sep = buckets.find((b) => b.key === "2026-09-01")!;
  assert.deepEqual(sep, { key: "2026-09-01", gross: 500_000, fees: 14_530, net: 435_470, refunds: 50_000, payouts: 0 });
  const oct = buckets.find((b) => b.key === "2026-10-01")!;
  assert.equal(oct.payouts, 435_470);
  assert.equal(oct.fees, 500);
  assert.equal(oct.net, -500);
  assert.equal(totals.gross, 500_000);
  assert.equal(totals.fees, 15_030);
  assert.equal(buckets.length, 12);
});

test("a charge just after midnight UTC belongs to the Florida evening before", () => {
  const { buckets } = sumBalanceTransactions([
    { type: "payment", amount: 1_000, fee: 59, net: 941, created: at("2026-10-01T02:00:00Z") },
  ], range);
  assert.equal(buckets.find((b) => b.key === "2026-09-01")!.gross, 1_000);
  assert.equal(buckets.find((b) => b.key === "2026-10-01")!.gross, 0);
});

test("transactions outside the period are ignored", () => {
  const { totals } = sumBalanceTransactions([
    { type: "charge", amount: 1_000, fee: 59, net: 941, created: at("2024-01-10T15:00:00Z") },
  ], range);
  assert.equal(totals.gross, 0);
});

test("adjustments move net only", () => {
  const { totals } = sumBalanceTransactions([
    { type: "adjustment", amount: -1_500, fee: 0, net: -1_500, created: at("2026-05-10T15:00:00Z") },
  ], range);
  assert.deepEqual({ gross: totals.gross, fees: totals.fees, net: totals.net }, { gross: 0, fees: 0, net: -1_500 });
});
