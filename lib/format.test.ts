import assert from "node:assert/strict";
import { test } from "node:test";
import { daysUntil, describeDaysUntil, formatDate, midpoint, todayIso } from "./format.ts";

const noonUtc = new Date("2026-09-12T12:00:00Z");

test("days until a delivery date counts calendar days", () => {
  assert.equal(daysUntil("2026-09-12", noonUtc), 0);
  assert.equal(daysUntil("2026-09-26", noonUtc), 14);
  assert.equal(daysUntil("2026-09-10", noonUtc), -2);
});

test("days are described the way a client would say them", () => {
  assert.equal(describeDaysUntil(0), "Today");
  assert.equal(describeDaysUntil(1), "Tomorrow");
  assert.equal(describeDaysUntil(14), "In 14 days");
  assert.equal(describeDaysUntil(-3), "3 days ago");
});

test("the default halfway review sits between start and delivery", () => {
  assert.equal(midpoint("2026-09-14", "2026-09-28"), "2026-09-21");
  assert.equal(midpoint("2026-09-14", "2026-09-14"), "2026-09-14");
});

test("dates format without shifting across time zones", () => {
  assert.equal(formatDate("2026-09-28"), "Sep 28, 2026");
  assert.equal(formatDate(null), "No date");
  assert.equal(todayIso(noonUtc), "2026-09-12");
});
