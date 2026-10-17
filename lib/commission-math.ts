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

export type DealParticipant = { id: string; role: string };
export type DealAllocation = { id: string; rateBps: number; amountCents: number };

/** Gross invoice ownership. Operating expenses and Stripe fees never change it. */
export function dealAllocations(baseCents: number, credited: DealParticipant, founders: DealParticipant[]): DealAllocation[] {
  if (!Number.isSafeInteger(baseCents) || baseCents < 0) throw new Error("Invalid invoice amount");
  if (credited.role === "staff_owner" || credited.role === "staff") {
    return [{ id: credited.id, rateBps: 10000, amountCents: baseCents }];
  }
  if (credited.role !== "rep") throw new Error("Only a founder or sales rep can earn a deal share");
  const founderProfiles = [...founders].sort((a, b) => a.id.localeCompare(b.id));
  if (founderProfiles.length !== 2 || new Set(founderProfiles.map(p => p.id)).size !== 2 || founderProfiles.some(p => !["staff_owner", "staff"].includes(p.role) || p.id === credited.id)) {
    throw new Error("Rep deals require exactly two founders with founder profiles");
  }
  const repCents = commissionCents(baseCents, 2000);
  const remaining = baseCents - repCents;
  return [
    { id: credited.id, rateBps: 2000, amountCents: repCents },
    { id: founderProfiles[0].id, rateBps: 4000, amountCents: Math.ceil(remaining / 2) },
    { id: founderProfiles[1].id, rateBps: 4000, amountCents: Math.floor(remaining / 2) },
  ];
}

/** Cumulative allocation avoids rounding drift across several partial refunds. */
export function refundAllocations(baseCents: number, shares: DealAllocation[], alreadyRefunded: number, refundCents: number): DealAllocation[] {
  if (baseCents <= 0 || alreadyRefunded < 0 || refundCents < 0 || alreadyRefunded + refundCents > baseCents) throw new Error("Invalid refund amount");
  const at = (refunded: number) => {
    const exact = shares.map(s => s.amountCents * refunded / baseCents);
    const rounded = exact.map(Math.floor);
    const target = Math.round(exact.reduce((sum, x) => sum + x, 0));
    const order = exact.map((x, i) => ({ i, remainder: x - rounded[i] })).sort((a, b) => b.remainder - a.remainder || shares[a.i].id.localeCompare(shares[b.i].id));
    const missing = target - rounded.reduce((sum, x) => sum + x, 0);
    for (let i = 0; i < missing; i++) rounded[order[i].i]++;
    return rounded;
  };
  const before = at(alreadyRefunded);
  const after = at(alreadyRefunded + refundCents);
  return shares.map((share, i) => ({ ...share, amountCents: before[i] - after[i] }));
}
