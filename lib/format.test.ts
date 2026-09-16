import assert from "node:assert/strict";
import { test } from "node:test";
import { daysUntil, describeDaysUntil, formatDate, midpoint, timeAgo, todayIso } from "./format.ts";

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

test("time ago reads the way staff would say it", () => {
  const now = new Date("2026-09-16T12:00:00Z");
  const ago = (ms: number) => timeAgo(new Date(now.getTime() - ms), now);
  assert.equal(timeAgo(null, now), null);
  assert.equal(ago(5_000), "just now");
  assert.equal(ago(60_000), "1 minute ago");
  assert.equal(ago(45 * 60_000), "45 minutes ago");
  assert.equal(ago(2 * 3_600_000), "2 hours ago");
  assert.equal(ago(26 * 3_600_000), "yesterday");
  assert.equal(ago(9 * 86_400_000), "9 days ago");
  assert.equal(ago(70 * 86_400_000), "2 months ago");
  assert.equal(ago(400 * 86_400_000), "1 year ago");
});

test("a clock skewed into the future never reads as negative", () => {
  const now = new Date("2026-09-16T12:00:00Z");
  assert.equal(timeAgo(new Date(now.getTime() + 5_000), now), "just now");
});
