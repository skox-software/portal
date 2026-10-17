/**
 * Commission arithmetic and statement periods. Pure, so it can be tested alone.
 *
 * Commission is the rep's rate times cash SKOX actually collects. Rates are
 * basis points (1500 = 15%). Amounts round half up to the cent; clawbacks use
 * the same rate as the payment they reverse and are negative.
 */

export function commissionCents(baseCents: number, rateBps: number) {
  return Math.round((baseCents * rateBps) / 10_000);
}

export function clawbackCents(refundCents: number, rateBps: number) {
  return -commissionCents(refundCents, rateBps);
}

export function formatRate(bps: number) {
  const pct = bps / 100;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(2).replace(/0$/, "")}%`;
}

/** "15" or "12.5" → basis points, or null when it isn't a number. */
export function parseRatePercent(value: string) {
  const n = Number(value.trim().replace(/%$/, ""));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

/** The calendar month before `today` (YYYY-MM-DD), as first and last day. */
export function previousMonth(today: string) {
  const [y, m] = today.split("-").map(Number);
  const year = m === 1 ? y - 1 : y;
  const month = m === 1 ? 12 : m - 1;
  return monthPeriod(year, month);
}

export function monthPeriod(year: number, month: number) {
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const end = `${year}-${String(month).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
  return { start, end };
}

export function periodLabel(start: string) {
  const [y, m] = start.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

export type LedgerLine = { amountCents: number; earnedOn: string };

/**
 * Which pending lines go on this month's statement. Everything earned up to
 * the end of the period is included, older unpaid lines too. If the total
 * is zero or negative (refunds outweigh payments), nothing is drafted and
 * the lines carry forward to the next month.
 */
export function statementLines<T extends LedgerLine>(pending: T[], periodEnd: string) {
  const lines = pending.filter((l) => l.earnedOn <= periodEnd);
  const total = lines.reduce((sum, l) => sum + l.amountCents, 0);
  return total > 0 ? { lines, total } : { lines: [] as T[], total: 0 };
}
