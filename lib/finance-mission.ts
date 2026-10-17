import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { workspaces } from "@/lib/db/schema";
import {
  collectedByBucket,
  collectedSince,
  dailyActivity,
  dealsWonByOwner,
  funnel,
  invoicedInPeriod,
  openInvoiceDues,
  raceStandings,
  refundsByBucket,
  sharesByOwner,
  unpaidStatements,
  weightedPipeline,
  type HeatMetric,
} from "@/lib/finance-data";
import { liveSnapshot } from "@/lib/finance-live";
import type { PeriodRange } from "@/lib/finance-periods";
import { stripeActivity, stripeBalance, stripeTreasury } from "@/lib/finance-stripe";
import { balanceSeries, projectForward } from "@/lib/forecast-math";
import { addDays, salesToday } from "@/lib/follow-up";
import type { MoneyFlowInput } from "@/lib/sankey-math";

/**
 * Everything the Mission Control panels draw, read in one go, for the
 * Finance page and wall mode alike. Stripe reads are memoised and never
 * throw (see lib/finance-stripe.ts), so this can't fail because of Stripe;
 * a missing Stripe only empties the panels that need it.
 */
export async function loadMission(ws: string, range: PeriodRange, heat: HeatMetric, fresh = false) {
  const today = salesToday();
  const year = today.slice(0, 4);
  const yearStart = addDays(today, -364);
  const [live, collected, refunds, won, pipeline, invoiced, shares, dues, statementsDue, heatValues, race, funnelData, [workspace], ytdCents, balance, activity, treasury] =
    await Promise.all([
      liveSnapshot(ws),
      collectedByBucket(ws, range),
      refundsByBucket(ws, range),
      dealsWonByOwner(ws, range),
      weightedPipeline(ws),
      invoicedInPeriod(ws, range),
      sharesByOwner(ws, range),
      openInvoiceDues(ws),
      unpaidStatements(ws),
      dailyActivity(ws, heat, yearStart, today),
      raceStandings(ws, today),
      funnel(ws, range),
      getDb().select({ goalCents: workspaces.revenueGoalCents, goalYear: workspaces.revenueGoalYear }).from(workspaces).where(eq(workspaces.id, ws)).limit(1),
      collectedSince(ws, `${year}-01-01`),
      stripeBalance(fresh),
      stripeActivity(range, fresh),
      stripeTreasury(fresh),
    ]);

  // No business account at all is a fact, not a failure; a permission error is.
  const hasTreasury = treasury.ok && treasury.data.accounts.length > 0;
  const collectedTotal = collected.reduce((s, b) => s + b.value.cents, 0);
  const refundTotal = refunds.reduce((s, b) => s + b.value, 0);
  const wonValue = won.reduce((s, w) => s + w.valueCents, 0);

  const flow: MoneyFlowInput = {
    pipelineCents: pipeline.weightedCents,
    wonCents: wonValue,
    invoicedCents: invoiced,
    paidCents: collectedTotal,
    // Stripe's view of fees and refunds when it answers; the portal's refunds otherwise.
    feesCents: activity.ok ? activity.data.totals.fees : 0,
    refundsCents: activity.ok ? activity.data.totals.refunds : refundTotal,
    shares,
  };

  // Runway: walk the balance back through the period from today's figure, then project 60 days on.
  const runwayBalance = hasTreasury ? treasury.data.cash : balance.ok ? balance.data.available + balance.data.pending : null;
  const runway =
    runwayBalance !== null && activity.ok
      ? {
          history: balanceSeries({ date: today, cents: runwayBalance }, range.startIso, activity.data.days, !hasTreasury),
          projection: projectForward(runwayBalance, dues, statementsDue, today),
          sourceLabel: hasTreasury ? "Business account" : "Payments balance",
        }
      : null;

  return {
    today,
    range,
    live,
    flow,
    runway,
    race,
    funnel: funnelData,
    heat: { metric: heat, values: heatValues, startIso: yearStart, endIso: today },
    goal: {
      ytdCents,
      // A target counts only for the year it was set in.
      goalCents: workspace?.goalYear === Number(year) ? workspace.goalCents : null,
    },
    // The page's older sections reuse these reads rather than asking twice.
    reads: { collected, refunds, won, pipeline, balance, activity, treasury, hasTreasury, collectedTotal, refundTotal, wonValue },
  };
}

export type Mission = Awaited<ReturnType<typeof loadMission>>;
