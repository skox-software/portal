import { collectedSince, dueTodayCount, liveEvents, weightedPipeline } from "@/lib/finance-data";
import { stripeBalance, stripeTreasury } from "@/lib/finance-stripe";
import { salesToday } from "@/lib/follow-up";
import type { LiveEvent } from "@/lib/live-feed";

/**
 * What the live ticker and activity feed show, read in one go. The page
 * renders it as the first paint and `/api/finance/live` returns the same
 * shape every 30 seconds after that.
 *
 * Stripe figures are null when Stripe is missing or failing: the ticker
 * shows a dash, never a stale or invented number. They go through the same
 * two-minute memo as the rest of the page, so polling doesn't hammer Stripe.
 */
export type LiveSnapshot = {
  at: string;
  /** Business account cash when SKOX has one, otherwise the payments balance. */
  balanceCents: number | null;
  balanceSource: "business" | "payments" | null;
  paymentsBalanceCents: number | null;
  collectedMonthCents: number;
  /** Open deals weighted by stage. */
  openPipelineCents: number;
  dueTodayCount: number;
  events: LiveEvent[];
};

export async function liveSnapshot(ws: string): Promise<LiveSnapshot> {
  const today = salesToday();
  const [treasury, balance, collectedMonthCents, pipeline, due, events] = await Promise.all([
    stripeTreasury(),
    stripeBalance(),
    collectedSince(ws, `${today.slice(0, 7)}-01`),
    weightedPipeline(ws),
    dueTodayCount(ws, today),
    liveEvents(ws),
  ]);
  const paymentsBalanceCents = balance.ok ? balance.data.available + balance.data.pending : null;
  const business = treasury.ok && treasury.data.accounts.length > 0 ? treasury.data.cash : null;
  return {
    at: new Date().toISOString(),
    balanceCents: business ?? paymentsBalanceCents,
    balanceSource: business !== null ? "business" : paymentsBalanceCents !== null ? "payments" : null,
    paymentsBalanceCents,
    collectedMonthCents,
    openPipelineCents: pipeline.weightedCents,
    dueTodayCount: due,
    events,
  };
}
