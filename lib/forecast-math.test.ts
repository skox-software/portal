import assert from "node:assert/strict";
import { test } from "node:test";
import { balanceSeries, dailyNets, monthEnd, paceToDate, projectForward, statementPayDay } from "./forecast-math.ts";

// Noon UTC is morning in Florida, so these land on the date they say.
const at = (iso: string) => Date.parse(`${iso}T16:00:00Z`) / 1000;

test("transactions total per Florida day, sweeps kept apart from activity", () => {
  const days = dailyNets([
    { type: "charge", net: 9_700, created: at("2026-10-02") },
    { type: "stripe_fee", net: -200, created: at("2026-10-02") },
    { type: "payout", net: -9_500, created: at("2026-10-03") },
    // 11pm in Florida on Oct 3 is Oct 4 in UTC.
    { type: "refund", net: -1_000, created: Date.parse("2026-10-04T03:00:00Z") / 1000 },
  ]);
  assert.deepEqual(days, [
    { date: "2026-10-02", activity: 9_500, moved: 0 },
    { date: "2026-10-03", activity: -1_000, moved: -9_500 },
  ]);
});

test("the balance history walks back from today's balance", () => {
  const days = [
    { date: "2026-10-02", activity: 10_000, moved: 0 },
    { date: "2026-10-04", activity: -2_000, moved: -5_000 },
  ];
  const business = balanceSeries({ date: "2026-10-04", cents: 50_000 }, "2026-10-01", days, false);
  assert.deepEqual(business, [
    { date: "2026-10-01", cents: 42_000 },
    { date: "2026-10-02", cents: 52_000 },
    { date: "2026-10-03", cents: 52_000 },
    { date: "2026-10-04", cents: 50_000 },
  ]);
  const payments = balanceSeries({ date: "2026-10-04", cents: 0 }, "2026-10-03", days, true);
  assert.deepEqual(payments.map((p) => p.cents), [7_000, 0]);
});

test("statements are paid on the 5th of the next month", () => {
  assert.equal(statementPayDay("2026-09-30"), "2026-10-05");
  assert.equal(statementPayDay("2026-12-31"), "2027-01-05");
});

test("the projection pays invoices on their due date and statements on pay day", () => {
  const points = projectForward(
    100_000,
    [{ dueOn: "2026-10-20", amountCents: 30_000 }, { dueOn: "2026-10-01", amountCents: 5_000 }],
    [{ periodEnd: "2026-10-31", totalCents: 40_000 }],
    "2026-10-17",
    30,
  );
  assert.equal(points.length, 30);
  assert.equal(points[0].date, "2026-10-18");
  // The overdue invoice lands tomorrow.
  assert.equal(points[0].expected, 105_000);
  assert.equal(points.find((p) => p.date === "2026-10-20")!.expected, 135_000);
  const payDay = points.find((p) => p.date === "2026-11-05")!;
  assert.equal(payDay.outflow, 40_000);
  assert.equal(payDay.expected, 95_000);
  assert.equal(points.at(-1)!.date, "2026-11-16");
});

test("the floor assumes nobody pays but the statements still go out", () => {
  const points = projectForward(10_000, [{ dueOn: "2026-10-18", amountCents: 50_000 }], [{ periodEnd: "2026-08-31", totalCents: 25_000 }], "2026-10-17", 5);
  // A statement whose pay day has passed goes out tomorrow.
  assert.equal(points[0].floor, -15_000);
  assert.equal(points[0].expected, 35_000);
  assert.ok(points.every((p) => p.floor <= p.expected));
});

test("month ends", () => {
  assert.equal(monthEnd("2026-10-17"), "2026-10-31");
  assert.equal(monthEnd("2028-02-03"), "2028-02-29");
});

test("pace straight-lines what's done so far to the end of the period", () => {
  assert.equal(paceToDate(10_000, 10, 31), 31_000);
  assert.equal(paceToDate(0, 5, 30), 0);
  assert.equal(paceToDate(500, 0, 30), 500);
  assert.equal(paceToDate(900, 40, 30), 900);
});
