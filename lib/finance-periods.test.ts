import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bucketKeys,
  bucketLabel,
  bucketOf,
  parsePeriod,
  periodRange,
  STAGE_WEIGHTS,
  toUnixRange,
  unixToSalesDate,
} from "./finance-periods.ts";

const TODAY = "2026-10-17"; // a Saturday

test("unknown periods fall back to the last 12 months", () => {
  assert.equal(parsePeriod("90d"), "90d");
  assert.equal(parsePeriod("ytd"), "ytd");
  assert.equal(parsePeriod("forever"), "12m");
  assert.equal(parsePeriod(undefined), "12m");
});

test("30 days is thirty daily buckets ending today", () => {
  const r = periodRange("30d", TODAY);
  assert.equal(r.startIso, "2026-09-18");
  assert.equal(r.bucket, "day");
  const keys = bucketKeys(r);
  assert.equal(keys.length, 30);
  assert.equal(keys[0], "2026-09-18");
  assert.equal(keys.at(-1), TODAY);
});

test("90 days is Monday-start weeks covering the whole window", () => {
  const r = periodRange("90d", TODAY);
  assert.equal(r.startIso, "2026-07-20");
  const keys = bucketKeys(r);
  assert.equal(keys[0], "2026-07-20"); // a Monday
  assert.equal(keys.at(-1), "2026-10-12");
  assert.equal(keys.length, 13);
  assert.equal(bucketOf("2026-10-17", r), "2026-10-12");
  assert.equal(bucketOf("2026-07-19", r), null);
});

test("12 months is twelve month buckets ending this month", () => {
  const r = periodRange("12m", TODAY);
  assert.equal(r.startIso, "2025-11-01");
  const keys = bucketKeys(r);
  assert.equal(keys.length, 12);
  assert.equal(keys[0], "2025-11-01");
  assert.equal(keys.at(-1), "2026-10-01");
  assert.equal(bucketOf("2026-02-28T15:00:00Z", r), "2026-02-01");
});

test("year to date starts on January 1, even in January", () => {
  assert.deepEqual(bucketKeys(periodRange("ytd", TODAY)).length, 10);
  const jan = periodRange("ytd", "2027-01-03");
  assert.equal(jan.startIso, "2027-01-01");
  assert.deepEqual(bucketKeys(jan), ["2027-01-01"]);
});

test("Stripe's created range runs midnight to midnight in Florida", () => {
  const { gte, lte } = toUnixRange(periodRange("30d", TODAY));
  // 2026-09-18 00:00 EDT is 04:00 UTC; 2026-10-17 23:59:59 EDT is 2026-10-18 03:59:59 UTC.
  assert.equal(gte, Date.parse("2026-09-18T04:00:00Z") / 1000);
  assert.equal(lte, Date.parse("2026-10-18T03:59:59Z") / 1000);
  const winter = toUnixRange(periodRange("ytd", "2026-01-10"));
  assert.equal(winter.gte, Date.parse("2026-01-01T05:00:00Z") / 1000);
});

test("a late-evening Stripe charge lands on the Florida date", () => {
  assert.equal(unixToSalesDate(Date.parse("2026-10-18T02:00:00Z") / 1000), "2026-10-17");
});

test("bucket labels are short", () => {
  assert.equal(bucketLabel("2026-10-01", "month"), "Oct");
  assert.equal(bucketLabel("2026-10-12", "week"), "Oct 12");
});

test("later stages weigh more and won/lost aren't weighted", () => {
  assert.equal(STAGE_WEIGHTS.outreach_1, 0.05);
  assert.ok(STAGE_WEIGHTS.replied! < STAGE_WEIGHTS.meeting!);
  assert.equal(STAGE_WEIGHTS.proposal_sent, 0.65);
  assert.equal(STAGE_WEIGHTS.outreach_closed, undefined);
  assert.equal(STAGE_WEIGHTS.won, undefined);
});
