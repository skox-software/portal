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
