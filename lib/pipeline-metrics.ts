/**
 * The numbers above each board. Pure, so they can be tested alone; the pages
 * read the events and deals they're built from.
 *
 * Every rate carries its sample size (`n`), and has no value until there is
 * a sample: an empty board says "no data yet", never "0%".
 */

import { CONNECTED, DIALED, salesToday, type Outcome } from "./follow-up.ts";
import { OPEN_ACTIVE, type DealStage } from "./pipeline.ts";

export type Rate = { hits: number; n: number; pct: number | null };

export function rate(hits: number, n: number): Rate {
  return { hits, n, pct: n > 0 ? Math.round((hits / n) * 100) : null };
}

/** "42%", or "–" with no sample. */
export function formatPct(r: Rate) {
  return r.pct === null ? "–" : `${r.pct}%`;
}

/** One contact attempt from the audit trail: a logged call (any outcome) or an email sent from the portal. */
export type ContactEvent = { dealId: string; verb: string; outcome: string | null; at: Date };

export const RATE_WINDOW_DAYS = 30;
/** Industries with fewer dials than this are listed but not compared. */
export const MIN_INDUSTRY_DIALS = 5;

type Tally = { dials: number; connects: number; interested: number; previews: number };
const tally = (): Tally => ({ dials: 0, connects: 0, interested: 0, previews: 0 });

function add(t: Tally, outcome: Outcome) {
  if (!DIALED.includes(outcome)) return;
  t.dials++;
  if (CONNECTED.includes(outcome)) t.connects++;
  if (outcome === "interested" || outcome === "preview") t.interested++;
  if (outcome === "preview") t.previews++;
}

/**
 * Attempts today, then the call funnel over the last 30 days: connect rate
 * (reached the owner over dials), interest rate (interested or asked for a
 * preview, over connects) and preview rate (over connects). Counted per call.
 */
export function outreachMetrics(events: ContactEvent[], industryOf: Map<string, string | null>, now: Date) {
  const today = salesToday(now);
  const since = now.getTime() - RATE_WINDOW_DAYS * 86_400_000;
  let attemptsToday = 0;
  const all = tally();
  const byIndustry = new Map<string, Tally>();
  for (const e of events) {
    const attempt = e.verb === "deal.email_sent" || (e.verb === "deal.call_logged" && !!e.outcome);
    if (attempt && salesToday(e.at) === today) attemptsToday++;
    if (e.verb !== "deal.call_logged" || !e.outcome || e.at.getTime() < since) continue;
    const outcome = e.outcome as Outcome;
    add(all, outcome);
    const industry = industryOf.get(e.dealId)?.trim() || "Not set";
    if (!byIndustry.has(industry)) byIndustry.set(industry, tally());
    add(byIndustry.get(industry)!, outcome);
  }
  const rates = (t: Tally) => ({
    dials: t.dials,
    connect: rate(t.connects, t.dials),
    interest: rate(t.interested, t.connects),
    preview: rate(t.previews, t.connects),
  });
  return {
    attemptsToday,
    ...rates(all),
    industries: [...byIndustry]
      .filter(([, t]) => t.dials > 0)
      .map(([industry, t]) => ({ industry, comparable: t.dials >= MIN_INDUSTRY_DIALS, ...rates(t) }))
      .sort((a, b) => b.dials - a.dials || a.industry.localeCompare(b.industry)),
  };
}

export type ActiveDeal = {
  stage: DealStage;
  valueCents: number | null;
  nextStepOn: string | null;
  createdAt: Date;
  promotedAt: Date | null;
  wonAt: Date | null;
};

/**
 * Open value (Interested, Scope call, Proposal), win rate (won over won and
 * lost), average days to close (from promotion, or from being added when it
 * started in the Pipeline, to won) and open deals with no next step or an
 * overdue one.
 */
export function activeMetrics(deals: ActiveDeal[], today: string) {
  const open = deals.filter((d) => OPEN_ACTIVE.includes(d.stage));
  const won = deals.filter((d) => d.stage === "won");
  const lost = deals.filter((d) => d.stage === "lost");
  const closed = won.filter((d) => d.wonAt);
  const days = closed.map((d) => Math.max(0, (d.wonAt!.getTime() - (d.promotedAt ?? d.createdAt).getTime()) / 86_400_000));
  const needsNext = open.filter((d) => !d.nextStepOn || d.nextStepOn < today).length;
  return {
    openCents: open.reduce((n, d) => n + (d.valueCents ?? 0), 0),
    openCount: open.length,
    unvalued: open.filter((d) => !d.valueCents).length,
    winRate: rate(won.length, won.length + lost.length),
    avgDaysToClose: days.length ? Math.round(days.reduce((a, b) => a + b, 0) / days.length) : null,
    closedN: days.length,
    needsNext,
  };
}
