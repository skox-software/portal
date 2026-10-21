/**
 * Reporting periods for the finance dashboard. Pure, so it can be tested alone.
 *
 * Every period is a run of calendar dates in the sales time zone (Florida),
 * cut into day, week (Monday start, like Postgres `date_trunc('week')`) or
 * month buckets. Bucket keys are the bucket's first day, YYYY-MM-DD.
 */

import { addDays, SALES_TZ, salesToday } from "./follow-up.ts";
import type { DealStage } from "./pipeline.ts";

export const PERIODS = ["30d", "90d", "12m", "ytd"] as const;
export type PeriodKey = (typeof PERIODS)[number];
export type Bucket = "day" | "week" | "month";
export type PeriodRange = { key: PeriodKey; startIso: string; endIso: string; bucket: Bucket; label: string };

export const DEFAULT_PERIOD: PeriodKey = "12m";

export const PERIOD_CHIP: Record<PeriodKey, string> = { "30d": "30d", "90d": "90d", "12m": "12m", ytd: "YTD" };

export function parsePeriod(value: string | null | undefined): PeriodKey {
  return PERIODS.includes(value as PeriodKey) ? (value as PeriodKey) : DEFAULT_PERIOD;
}

/** The chance an open deal closes, by stage: what the weighted pipeline multiplies by. */
export const STAGE_WEIGHTS: Partial<Record<DealStage, number>> = {
  outreach_1: 0.05,
  outreach_2: 0.05,
  outreach_3: 0.05,
  outreach_4: 0.05,
  emailed: 0.15,
  replied: 0.3,
  meeting: 0.5,
  proposal_sent: 0.65,
};

function monthStart(iso: string) {
  return `${iso.slice(0, 7)}-01`;
}

function addMonths(iso: string, months: number) {
  const [y, m] = iso.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + months, 1));
  return d.toISOString().slice(0, 10);
}

/** The Monday on or before a date. */
function weekStart(iso: string) {
  const dow = new Date(`${iso}T12:00:00Z`).getUTCDay();
  return addDays(iso, -((dow + 6) % 7));
}

export function periodRange(key: PeriodKey, todayIso: string = salesToday()): PeriodRange {
  switch (key) {
    case "30d":
      return { key, startIso: addDays(todayIso, -29), endIso: todayIso, bucket: "day", label: "Last 30 days" };
    case "90d":
      return { key, startIso: addDays(todayIso, -89), endIso: todayIso, bucket: "week", label: "Last 90 days" };
    case "12m":
      return { key, startIso: addMonths(monthStart(todayIso), -11), endIso: todayIso, bucket: "month", label: "Last 12 months" };
    case "ytd":
      return { key, startIso: `${todayIso.slice(0, 4)}-01-01`, endIso: todayIso, bucket: "month", label: "Year to date" };
  }
}

/** The bucket a date falls in, or null when it's outside the period. */
export function bucketOf(iso: string, range: PeriodRange) {
  const day = iso.slice(0, 10);
  if (day < range.startIso || day > range.endIso) return null;
  if (range.bucket === "day") return day;
  if (range.bucket === "week") return weekStart(day);
  return monthStart(day);
}

/** Every bucket in the period, oldest first, so empty ones still draw. */
export function bucketKeys(range: PeriodRange) {
  const keys: string[] = [];
  const last = bucketOf(range.endIso, range)!;
  let key = bucketOf(range.startIso, range)!;
  while (key <= last) {
    keys.push(key);
    key = range.bucket === "day" ? addDays(key, 1) : range.bucket === "week" ? addDays(key, 7) : addMonths(key, 1);
  }
  return keys;
}

/** Short axis label for a bucket key: "Oct 3" for days and weeks, "Oct" for months. */
export function bucketLabel(key: string, bucket: Bucket) {
  const d = new Date(`${key}T12:00:00Z`);
  return bucket === "month"
    ? d.toLocaleDateString("en-US", { timeZone: "UTC", month: "short" })
    : d.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
}

/** Minutes the sales time zone is ahead of UTC at an instant (negative in Florida). */
function tzOffsetMinutes(at: Date) {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: SALES_TZ, timeZoneName: "longOffset" })
    .formatToParts(at)
    .find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
  return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
}

/** Unix seconds of midnight at the start of a date in the sales time zone. */
function midnightUnix(iso: string) {
  const noon = new Date(`${iso}T12:00:00Z`);
  return Math.floor((Date.parse(`${iso}T00:00:00Z`) - tzOffsetMinutes(noon) * 60_000) / 1000);
}

/** The period as Stripe's `created` filter: from the first midnight to the last second of the final day. */
export function toUnixRange(range: PeriodRange) {
  return { gte: midnightUnix(range.startIso), lte: midnightUnix(addDays(range.endIso, 1)) - 1 };
}

/** A Stripe timestamp (unix seconds) as a calendar date in the sales time zone. */
export function unixToSalesDate(seconds: number) {
  return salesToday(new Date(seconds * 1000));
}
