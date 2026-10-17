/**
 * Runway, forecast and pace for the finance page. Pure, so it can be tested
 * alone. Dates are YYYY-MM-DD calendar days in the sales time zone; amounts
 * are cents.
 */

import { addDays } from "./follow-up.ts";
import { unixToSalesDate } from "./finance-periods.ts";

export type TxnLike = { type: string; net: number; created: number };
export type DayNet = { date: string; activity: number; moved: number };
export type BalancePoint = { date: string; cents: number };

/**
 * Money moving between SKOX's own balances (payouts to the bank, sweeps into
 * the business account, top-ups), as opposed to activity that earns or costs.
 */
const MOVED = new Set([
  "payout",
  "payout_cancel",
  "payout_failure",
  "transfer",
  "transfer_cancel",
  "transfer_failure",
  "transfer_refund",
  "inbound_transfer",
  "inbound_transfer_reversal",
  "topup",
  "topup_reversal",
]);

/** Stripe balance transactions totalled per sales-time-zone day, oldest first. */
export function dailyNets(txns: TxnLike[]): DayNet[] {
  const days = new Map<string, DayNet>();
  for (const t of txns) {
    const date = unixToSalesDate(t.created);
    const d = days.get(date) ?? { date, activity: 0, moved: 0 };
    if (MOVED.has(t.type)) d.moved += t.net;
    else d.activity += t.net;
    days.set(date, d);
  }
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * The closing balance of every day from `startIso` to `end.date`, walked back
 * from a balance known today. Stripe only tells us the balance now, so each
 * earlier day is today's figure minus everything that happened after it.
 *
 * `includeMoved` is true for the payments balance (a payout really leaves
 * it) and false for the business account, which those sweeps fill.
 */
export function balanceSeries(end: BalancePoint, startIso: string, days: DayNet[], includeMoved: boolean): BalancePoint[] {
  const byDate = new Map(days.map((d) => [d.date, d.activity + (includeMoved ? d.moved : 0)]));
  const out: BalancePoint[] = [];
  let running = end.cents;
  for (let date = end.date; date >= startIso; date = addDays(date, -1)) {
    out.push({ date, cents: running });
    running -= byDate.get(date) ?? 0;
  }
  return out.reverse();
}

export type OpenInvoice = { dueOn: string; amountCents: number };
export type StatementDue = { periodEnd: string; totalCents: number };
export type ProjectedPoint = { date: string; expected: number; floor: number; inflow: number; outflow: number };

/** Commission statements are paid on the 5th of the month after their period ends. */
export function statementPayDay(periodEnd: string) {
  const [y, m] = periodEnd.split("-").map(Number);
  return new Date(Date.UTC(y, m, 5)).toISOString().slice(0, 10);
}

/**
 * Day-by-day balance for the next `horizonDays`, starting tomorrow.
 * Expected: every open invoice is paid on its due date (overdue ones
 * tomorrow) and every unpaid statement goes out on its pay day (late ones
 * tomorrow). Floor: the same outgoings with no payments at all.
 */
export function projectForward(
  todayBalance: number,
  openInvoices: OpenInvoice[],
  statementsDue: StatementDue[],
  today: string,
  horizonDays = 60,
): ProjectedPoint[] {
  const first = addDays(today, 1);
  const inflow = new Map<string, number>();
  const outflow = new Map<string, number>();
  for (const inv of openInvoices) {
    const day = inv.dueOn < first ? first : inv.dueOn;
    inflow.set(day, (inflow.get(day) ?? 0) + inv.amountCents);
  }
  for (const s of statementsDue) {
    const pay = statementPayDay(s.periodEnd);
    const day = pay < first ? first : pay;
    outflow.set(day, (outflow.get(day) ?? 0) + s.totalCents);
  }
  const out: ProjectedPoint[] = [];
  let expected = todayBalance;
  let floor = todayBalance;
  for (let i = 1; i <= horizonDays; i++) {
    const date = addDays(today, i);
    const inC = inflow.get(date) ?? 0;
    const outC = outflow.get(date) ?? 0;
    expected += inC - outC;
    floor -= outC;
    out.push({ date, expected, floor, inflow: inC, outflow: outC });
  }
  return out;
}

/** Last day of the month a date is in. */
export function monthEnd(iso: string) {
  const [y, m] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/**
 * Where a period ends up at the current rate: `valueSoFar` after
 * `dayOfPeriod` of `daysInPeriod` days, straight-lined to the end.
 */
export function paceToDate(valueSoFar: number, dayOfPeriod: number, daysInPeriod: number) {
  if (dayOfPeriod <= 0 || daysInPeriod <= 0) return valueSoFar;
  const day = Math.min(dayOfPeriod, daysInPeriod);
  return Math.round((valueSoFar / day) * daysInPeriod);
}

/** Day of the month and of the year for a date, with the lengths, for pace lines. */
export function calendarProgress(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const dayOfYear = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 86_400_000) + 1;
  const daysInYear = Math.round((Date.UTC(y + 1, 0, 1) - Date.UTC(y, 0, 1)) / 86_400_000);
  return { dayOfMonth: d, daysInMonth, dayOfYear, daysInYear };
}

export type Racer = { key: string; name: string; values: number[] };

/**
 * Ranks people by their values, compared left to right (cash, then wins),
 * and says how each moved against an earlier ranking: positive is up.
 * Someone absent before has no movement.
 */
export function rankChange(now: { key: string; values: number[] }[], before: { key: string; values: number[] }[]) {
  const order = (rows: { key: string; values: number[] }[]) =>
    [...rows]
      .filter((r) => r.values.some((v) => v > 0))
      .sort((a, b) => {
        for (let i = 0; i < Math.max(a.values.length, b.values.length); i++) {
          const d = (b.values[i] ?? 0) - (a.values[i] ?? 0);
          if (d) return d;
        }
        return a.key.localeCompare(b.key);
      })
      .map((r) => r.key);
  const was = order(before);
  const is = order(now);
  return new Map(is.map((key, i) => [key, was.includes(key) ? was.indexOf(key) - i : 0]));
}
