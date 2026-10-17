import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clawbackCents,
  commissionCents,
  formatRate,
  monthPeriod,
  parseRatePercent,
  previousMonth,
  statementLines,
} from "./commission-math.ts";

test("commission is rate times cash, rounded half up to the cent", () => {
  assert.equal(commissionCents(500_000, 1500), 75_000);
  assert.equal(commissionCents(25_000, 1000), 2_500);
  assert.equal(commissionCents(1_001, 1250), 125); // 125.125
  assert.equal(commissionCents(1_004, 1250), 126); // 125.5
});

test("a refund claws back the same rate, as a negative", () => {
  assert.equal(clawbackCents(250_000, 1500), -37_500);
  assert.equal(clawbackCents(0, 1500), -0);
});

test("rates read and print as percentages", () => {
  assert.equal(formatRate(1500), "15%");
  assert.equal(formatRate(1250), "12.5%");
  assert.equal(parseRatePercent("12.5"), 1250);
  assert.equal(parseRatePercent("15%"), 1500);
  assert.equal(parseRatePercent("x"), null);
});

test("statement periods are whole calendar months", () => {
  assert.deepEqual(previousMonth("2026-11-01"), { start: "2026-10-01", end: "2026-10-31" });
  assert.deepEqual(previousMonth("2027-01-01"), { start: "2026-12-01", end: "2026-12-31" });
  assert.deepEqual(monthPeriod(2028, 2), { start: "2028-02-01", end: "2028-02-29" });
});

test("a statement takes everything pending through the period end", () => {
  const pending = [
    { amountCents: 75_000, earnedOn: "2026-10-03" },
    { amountCents: 3_750, earnedOn: "2026-09-12" },
    { amountCents: 3_750, earnedOn: "2026-11-02" },
  ];
  const s = statementLines(pending, "2026-10-31");
  assert.equal(s.lines.length, 2);
  assert.equal(s.total, 78_750);
});

test("a month where refunds outweigh payments carries forward", () => {
  const s = statementLines(
    [
      { amountCents: 3_750, earnedOn: "2026-10-03" },
      { amountCents: -75_000, earnedOn: "2026-10-20" },
    ],
    "2026-10-31",
  );
  assert.deepEqual(s, { lines: [], total: 0 });
});

// Business allocation is independent of Stripe balances and operating expenses.
import * as math from "./commission-math.ts";
const reiss = { id: "reiss", role: "staff_owner" };
const josh = { id: "josh", role: "staff_owner" };
const rep = { id: "rep", role: "rep" };
test("a founder-owned $625 invoice credits its owner the full $625", () => {
  assert.equal(typeof math.dealAllocations, "function");
  assert.deepEqual(math.dealAllocations(62500, reiss, [reiss, josh]), [{ id: "reiss", rateBps: 10000, amountCents: 62500 }]);
  assert.deepEqual(math.dealAllocations(62500, josh, [reiss, josh]), [{ id: "josh", rateBps: 10000, amountCents: 62500 }]);
});
test("rep-owned cash splits 20% to the rep and 40% to each founder", () => {
  assert.equal(typeof math.dealAllocations, "function");
  assert.deepEqual(math.dealAllocations(125000, rep, [reiss, josh]), [
    { id: "rep", rateBps: 2000, amountCents: 25000 },
    { id: "josh", rateBps: 4000, amountCents: 50000 },
    { id: "reiss", rateBps: 4000, amountCents: 50000 },
  ]);
});
test("odd cents are conserved and founder ordering cannot change the split", () => {
  assert.equal(typeof math.dealAllocations, "function");
  for (let cents = 1; cents < 100; cents++) {
    const a = math.dealAllocations(cents, rep, [reiss, josh]);
    assert.equal(a.reduce((sum, x) => sum + x.amountCents, 0), cents);
    assert.deepEqual(a, math.dealAllocations(cents, rep, [josh, reiss]));
  }
});
test("rep allocations fail closed if both founders are not configured", () => {
  assert.equal(typeof math.dealAllocations, "function");
  assert.throws(() => math.dealAllocations(100, rep, [reiss]), /two founders/);
  assert.throws(() => math.dealAllocations(100, rep, [reiss, reiss]), /two founders/);
});

test("partial refunds reverse every allocation and final refund clears odd cents", () => {
  assert.equal(typeof math.refundAllocations, "function");
  const shares = math.dealAllocations(101, rep, [reiss, josh]);
  const first = math.refundAllocations(101, shares, 0, 33);
  const last = math.refundAllocations(101, shares, 33, 68);
  assert.equal(first.reduce((sum, x) => sum + x.amountCents, 0), -33);
  shares.forEach((share, i) => assert.equal(first[i].amountCents + last[i].amountCents, -share.amountCents));
});
