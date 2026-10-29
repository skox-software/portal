/**
 * Commission arithmetic and statement periods. Pure, so it can be tested alone.
 *
 * Commission is the rep's rate times cash UnBusy actually collects. Rates are
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

/** A founder closing a lead another founder sourced keeps 60%; the sourcer gets 40%. */
export const CLOSER_RATE_BPS = 6000;
export const SOURCER_RATE_BPS = 4000;

/**
 * Gross invoice ownership. Operating expenses and Stripe fees never change it.
 *
 * - A founder closing a lead they added: 100% to them.
 * - A founder closing a lead the other founder sourced (`sourcer`): 60% closer, 40% sourcer.
 * - A sales rep's deal: 20% rep, 40% to each founder.
 */
export function dealAllocations(baseCents: number, credited: DealParticipant, founders: DealParticipant[], sourcer?: DealParticipant | null): DealAllocation[] {
  if (!Number.isSafeInteger(baseCents) || baseCents < 0) throw new Error("Invalid invoice amount");
  if (credited.role === "staff_owner" || credited.role === "staff") {
    if (!sourcer || sourcer.id === credited.id) return [{ id: credited.id, rateBps: 10000, amountCents: baseCents }];
    if (!["staff_owner", "staff"].includes(sourcer.role)) throw new Error("Only a founder can be credited for sourcing a lead");
    // The sourcer's 40% rounds half up, like every share; the closer gets exactly the rest.
    const sourcerCents = commissionCents(baseCents, SOURCER_RATE_BPS);
    return [
      { id: credited.id, rateBps: CLOSER_RATE_BPS, amountCents: baseCents - sourcerCents },
      { id: sourcer.id, rateBps: SOURCER_RATE_BPS, amountCents: sourcerCents },
    ];
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

/** Someone who can be credited on a deal: their membership, role and commission profile. */
export type ShareCandidate = { id: string; role: string; email: string; status: string; name: string; userId?: string | null };

/**
 * Who shares in one paid invoice, decided without throwing.
 *
 * - `{ attention }`: setup is broken or ambiguous and a person must decide.
 *   The payment itself is never blocked by this.
 * - `null`: nobody is credited, so there's nothing to record.
 * - `{ allocations, notes }`: the lines to write. A paused recipient's line
 *   is left out and explained in `notes`; the others keep their exact share.
 */
export function planDealShares(input: {
  baseCents: number;
  projectRepId: string | null;
  /** Every deal behind the project: who's credited, and who added it (an auth user id, or a marker like "website"). */
  deals: { repId: string | null; ownerEmail: string | null; createdBy?: string | null }[];
  people: ShareCandidate[];
  /** The founder who sources every lead no founder added by hand: imports, the lead scanner, website enquiries. */
  defaultSourceEmail?: string | null;
}): { attention: string } | { allocations: DealAllocation[]; notes: string[] } | null {
  const { people } = input;
  const isFounder = (p: ShareCandidate) => p.role === "staff_owner" || p.role === "staff";
  let credited: ShareCandidate | undefined;
  if (input.projectRepId) {
    credited = people.find((p) => p.id === input.projectRepId);
    if (!credited) return { attention: "The project's credited person has no commission profile." };
  } else {
    const ids = new Set(
      input.deals
        .map((d) => d.repId ?? people.find((p) => isFounder(p) && p.email.toLowerCase() === d.ownerEmail?.toLowerCase())?.id)
        .filter((id): id is string => Boolean(id)),
    );
    if (ids.size > 1) return { attention: "This project's deals have different owners. Set the project's credited person." };
    if (ids.size === 0) return null;
    credited = people.find((p) => ids.has(p.id));
    if (!credited) return { attention: "The deal's credited rep has no commission profile." };
  }

  // Founders are staff with an active profile. Exactly two share a rep deal;
  // if one of exactly two founders is paused, their line is skipped below.
  let founders: ShareCandidate[] = [];
  if (credited.role === "rep") {
    const all = people.filter(isFounder);
    const active = all.filter((p) => p.status === "active");
    if (active.length === 2) founders = active;
    else if (all.length === 2) founders = all;
    else return { attention: `Rep deals need exactly two active founder profiles; found ${active.length}.` };
  }

  // Who sourced the lead: the founder who added it, else the default source founder.
  let sourcer: ShareCandidate | undefined;
  if (isFounder(credited) && input.deals.length) {
    const fallback = people.find((p) => isFounder(p) && p.email.toLowerCase() === input.defaultSourceEmail?.toLowerCase());
    const ids = new Set(
      input.deals
        .map((d) => (people.find((p) => isFounder(p) && p.userId && p.userId === d.createdBy) ?? fallback)?.id)
        .filter((id): id is string => Boolean(id)),
    );
    if (ids.size > 1) return { attention: "This project's leads were added by different founders, so the 60/40 split is ambiguous. Credit the deal by hand." };
    sourcer = people.find((p) => ids.has(p.id));
  }

  let allocations: DealAllocation[];
  try {
    allocations = dealAllocations(
      input.baseCents,
      { id: credited.id, role: credited.role },
      founders.map((p) => ({ id: p.id, role: p.role })),
      sourcer ? { id: sourcer.id, role: sourcer.role } : null,
    );
  } catch (error) {
    return { attention: (error as Error).message };
  }
  const notes: string[] = [];
  const paused = new Set([credited, ...founders, ...(sourcer ? [sourcer] : [])].filter((p) => p.status !== "active").map((p) => p.id));
  for (const share of allocations) {
    if (!paused.has(share.id)) continue;
    const who = people.find((p) => p.id === share.id);
    notes.push(`${who?.name ?? "A recipient"} is paused: their ${formatRate(share.rateBps)} share (${share.amountCents}¢) was left unallocated.`);
  }
  return { allocations: allocations.filter((share) => !paused.has(share.id)), notes };
}

/**
 * One refund's clawback lines, measured against what each recipient has
 * actually been clawed back so far (`clawedSoFar`, positive cents, same order
 * as `shares`). Each recipient's cumulative clawback tracks the rounded
 * proportional target, so a full refund always clears every cent.
 *
 * Rounding can put a recipient ahead of their target, which would make their
 * line a positive "clawback". That line is skipped and the cents carry into
 * the next line instead, so lines are only ever negative, and 0¢ lines are
 * dropped. Returned lines keep the index of the share they belong to.
 */
export function refundClawbackLines(
  baseCents: number,
  shares: DealAllocation[],
  clawedSoFar: number[],
  refundedAfter: number,
): (DealAllocation & { index: number })[] {
  if (clawedSoFar.length !== shares.length) throw new Error("Every share needs its clawback so far");
  const target = refundAllocations(baseCents, shares, 0, refundedAfter).map((x) => -x.amountCents);
  const raw = shares.map((_, i) => clawedSoFar[i] - target[i]);
  return carryPositive(raw)
    .map((amountCents, index) => ({ ...shares[index], amountCents, index }))
    .filter((line) => line.amountCents !== 0);
}

/** Moves positive amounts into the following lines (wrapping to earlier ones) so none stays positive. */
export function carryPositive(lines: number[]) {
  const out = [...lines];
  let carry = 0;
  for (let i = 0; i < out.length; i++) {
    out[i] += carry;
    carry = Math.max(0, out[i]);
    out[i] -= carry;
  }
  // Left over after the last line: absorb into the latest negative lines.
  for (let i = out.length - 1; i >= 0 && carry > 0; i--) {
    const take = Math.min(carry, -out[i]);
    out[i] += take;
    carry -= take;
  }
  if (carry > 0) throw new Error("Clawback lines cannot net positive");
  return out;
}
