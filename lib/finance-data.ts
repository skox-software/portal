import { and, desc, eq, inArray, isNotNull, ne, or, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { clients, commissionEntries, commissionStatements, deals, events, invoiceRefunds, invoices, projects, repProfiles } from "@/lib/db/schema";
import { repTotals, workspaceReps, EMPTY_TOTALS } from "@/lib/commissions";
import { bucketKeys, STAGE_WEIGHTS, type PeriodRange } from "@/lib/finance-periods";
import { SALES_TZ, salesToday } from "@/lib/follow-up";
import { describeEvent, LIVE_VERBS, type LiveEvent } from "@/lib/live-feed";
import { normalizeEmail } from "@/lib/permissions";

/**
 * The portal's side of the finance dashboard: what invoices, refunds, deals
 * and the commission ledger say. Every query is scoped to one workspace and
 * buckets dates in the sales time zone, so a payment at 9pm in Florida
 * counts on the day it happened there.
 */

const TZ = sql.raw(`'${SALES_TZ}'`);

/** `date_trunc` on a timestamp, as the YYYY-MM-DD bucket key. The unit is from a fixed list, never user input. */
function bucketExpr(column: unknown, range: PeriodRange) {
  const unit = sql.raw(`'${range.bucket}'`);
  return sql<string>`to_char(date_trunc(${unit}, ${column} at time zone ${TZ}), 'YYYY-MM-DD')`;
}

function inPeriod(column: unknown, range: PeriodRange) {
  return sql`(${column} at time zone ${TZ})::date between ${range.startIso}::date and ${range.endIso}::date`;
}

/** Fills every bucket of the period, zeros included, in order. */
function fill<T>(range: PeriodRange, rows: { key: string; value: T }[], zero: T) {
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  return bucketKeys(range).map((key) => ({ key, value: byKey.get(key) ?? zero }));
}

/** Paid invoices by bucket of their paid-at date. */
export async function collectedByBucket(ws: string, range: PeriodRange) {
  const key = bucketExpr(invoices.paidAt, range);
  const rows = await getDb()
    .select({ key, cents: sql<number>`coalesce(sum(${invoices.amountCents}), 0)::int`, count: sql<number>`count(*)::int` })
    .from(invoices)
    .where(and(eq(invoices.workspaceId, ws), eq(invoices.status, "paid"), isNotNull(invoices.paidAt), inPeriod(invoices.paidAt, range)))
    .groupBy(key);
  return fill(range, rows.map((r) => ({ key: r.key, value: { cents: Number(r.cents), count: Number(r.count) } })), { cents: 0, count: 0 });
}

/** Money returned to clients, by bucket of the refund date. */
export async function refundsByBucket(ws: string, range: PeriodRange) {
  const key = bucketExpr(invoiceRefunds.createdAt, range);
  const rows = await getDb()
    .select({ key, cents: sql<number>`coalesce(sum(${invoiceRefunds.amountCents}), 0)::int` })
    .from(invoiceRefunds)
    .where(and(eq(invoiceRefunds.workspaceId, ws), inPeriod(invoiceRefunds.createdAt, range)))
    .groupBy(key);
  return fill(range, rows.map((r) => ({ key: r.key, value: Number(r.cents) })), 0);
}

/** Open invoices right now, and how much of that is past its due date. Not period-scoped. */
export async function outstanding(ws: string) {
  const today = salesToday();
  const [row] = await getDb()
    .select({
      openCents: sql<number>`coalesce(sum(${invoices.amountCents}) filter (where ${invoices.status} = 'open'), 0)::int`,
      openCount: sql<number>`count(*) filter (where ${invoices.status} = 'open')::int`,
      overdueCents: sql<number>`coalesce(sum(${invoices.amountCents}) filter (where ${invoices.status} = 'open' and ${invoices.dueOn} < ${today}::date), 0)::int`,
      overdueCount: sql<number>`count(*) filter (where ${invoices.status} = 'open' and ${invoices.dueOn} < ${today}::date)::int`,
    })
    .from(invoices)
    .where(eq(invoices.workspaceId, ws));
  return {
    openCents: Number(row?.openCents ?? 0),
    openCount: Number(row?.openCount ?? 0),
    overdueCents: Number(row?.overdueCents ?? 0),
    overdueCount: Number(row?.overdueCount ?? 0),
  };
}

/** A deal counts as won once it reached Won or was onboarded into a project. Dated by `won_at`. */
const isWon = or(eq(deals.stage, "won"), isNotNull(deals.projectId));

/** Deals won per bucket and owner email (lower-cased; null when nobody owns it). */
export async function dealsWonByOwner(ws: string, range: PeriodRange) {
  const key = bucketExpr(deals.wonAt, range);
  const owner = sql<string | null>`lower(${deals.ownerEmail})`;
  const rows = await getDb()
    .select({ key, owner, count: sql<number>`count(*)::int`, valueCents: sql<number>`coalesce(sum(${deals.valueCents}), 0)::int` })
    .from(deals)
    .where(and(eq(deals.workspaceId, ws), isWon, isNotNull(deals.wonAt), inPeriod(deals.wonAt, range)))
    .groupBy(key, owner);
  return rows.map((r) => ({ key: r.key, owner: r.owner, count: Number(r.count), valueCents: Number(r.valueCents) }));
}

/** Open deals by stage, and their value weighted by how likely each stage is to close. */
export async function weightedPipeline(ws: string) {
  const rows = await getDb()
    .select({ stage: deals.stage, count: sql<number>`count(*)::int`, valueCents: sql<number>`coalesce(sum(${deals.valueCents}), 0)::int` })
    .from(deals)
    .where(and(eq(deals.workspaceId, ws), inArray(deals.stage, ["lead", "initial_outreach", "proposal_sent", "negotiation"]), sql`${deals.projectId} is null`))
    .groupBy(deals.stage);
  const stages = rows.map((r) => {
    const weight = STAGE_WEIGHTS[r.stage] ?? 0;
    return { stage: r.stage, count: Number(r.count), valueCents: Number(r.valueCents), weight, weightedCents: Math.round(Number(r.valueCents) * weight) };
  });
  return {
    stages,
    valueCents: stages.reduce((s, r) => s + r.valueCents, 0),
    weightedCents: stages.reduce((s, r) => s + r.weightedCents, 0),
  };
}

/** Cash collected in the period on projects that came from each owner's deals. */
async function collectedByOwner(ws: string, range: PeriodRange) {
  const owner = sql<string | null>`lower(${deals.ownerEmail})`;
  const rows = await getDb()
    .select({ owner, cents: sql<number>`coalesce(sum(${invoices.amountCents}), 0)::int` })
    .from(invoices)
    .innerJoin(deals, eq(deals.projectId, invoices.projectId))
    .where(and(eq(invoices.workspaceId, ws), eq(invoices.status, "paid"), isNotNull(invoices.paidAt), inPeriod(invoices.paidAt, range)))
    .groupBy(owner);
  return new Map(rows.map((r) => [r.owner, Number(r.cents)]));
}

export type LeaderRow = {
  email: string | null;
  name: string;
  dealsWon: number;
  wonValueCents: number;
  collectedCents: number;
  /** Commission not yet paid (pending + approved), lifetime; null when they have no commission profile. */
  owedCents: number | null;
  paidThisYearCents: number;
  repMembershipId: string | null;
};

/**
 * One row per person who closed a deal or earns commission. Deals and cash
 * are for the period; commission owed is everything not yet paid.
 */
export async function leaderboard(ws: string, range: PeriodRange) {
  const [won, collected, reps, totals] = await Promise.all([
    dealsWonByOwner(ws, range),
    collectedByOwner(ws, range),
    workspaceReps(ws),
    repTotals(ws),
  ]);
  const rows = new Map<string | null, LeaderRow>();
  const row = (email: string | null) => {
    let r = rows.get(email);
    if (!r) {
      r = { email, name: email ?? "Unassigned", dealsWon: 0, wonValueCents: 0, collectedCents: 0, owedCents: null, paidThisYearCents: 0, repMembershipId: null };
      rows.set(email, r);
    }
    return r;
  };
  for (const w of won) {
    const r = row(w.owner);
    r.dealsWon += w.count;
    r.wonValueCents += w.valueCents;
  }
  for (const [owner, cents] of collected) row(owner).collectedCents += cents;
  for (const { membership, profile } of reps) {
    const r = row(normalizeEmail(membership.email));
    const t = totals.get(membership.id) ?? EMPTY_TOTALS;
    r.name = profile.displayName;
    r.owedCents = t.pending + t.approved;
    r.paidThisYearCents = t.paidThisYear;
    r.repMembershipId = membership.id;
  }
  return [...rows.values()].sort((a, b) => b.collectedCents - a.collectedCents || b.wonValueCents - a.wonValueCents || b.dealsWon - a.dealsWon);
}

/** Portal invoices behind Stripe payment intents, to label the recent-charges table. */
export async function invoicesByPaymentIntent(ws: string, intents: string[]) {
  if (!intents.length) return new Map<string, { id: string; number: string; projectId: string; clientName: string }>();
  const rows = await getDb()
    .select({ intent: invoices.stripePaymentIntentId, id: invoices.id, number: invoices.number, projectId: invoices.projectId, clientName: clients.name })
    .from(invoices)
    .innerJoin(projects, eq(projects.id, invoices.projectId))
    .innerJoin(clients, eq(clients.id, projects.clientId))
    .where(and(eq(invoices.workspaceId, ws), inArray(invoices.stripePaymentIntentId, intents)));
  return new Map(rows.map((r) => [r.intent!, { id: r.id, number: r.number, projectId: r.projectId, clientName: r.clientName }]));
}

/** Cash collected on paid invoices from a sales-time-zone date (YYYY-MM-DD) to now. */
export async function collectedSince(ws: string, iso: string) {
  const [row] = await getDb()
    .select({ cents: sql<number>`coalesce(sum(${invoices.amountCents}), 0)::int` })
    .from(invoices)
    .where(and(eq(invoices.workspaceId, ws), eq(invoices.status, "paid"), isNotNull(invoices.paidAt), sql`(${invoices.paidAt} at time zone ${TZ})::date >= ${iso}::date`));
  return Number(row?.cents ?? 0);
}

/** Open invoices whose due date is `today` (sales time zone). */
export async function dueTodayCount(ws: string, today: string) {
  const [row] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(invoices)
    .where(and(eq(invoices.workspaceId, ws), eq(invoices.status, "open"), eq(invoices.dueOn, today)));
  return Number(row?.n ?? 0);
}

/**
 * The latest money-moving events, worded for the feed. Deal edits that
 * didn't change stage are left out in SQL, so a burst of edits can't push
 * real news off the list. The client's name comes from the event's project.
 */
export async function liveEvents(ws: string, limit = 25): Promise<LiveEvent[]> {
  const rows = await getDb()
    .select({ id: events.id, verb: events.verb, payload: events.payload, at: events.createdAt, client: clients.name })
    .from(events)
    .leftJoin(projects, eq(projects.id, events.projectId))
    .leftJoin(clients, eq(clients.id, projects.clientId))
    .where(and(eq(events.workspaceId, ws), inArray(events.verb, [...LIVE_VERBS]), or(ne(events.verb, "deal.updated"), sql`${events.payload} ? 'to'`)))
    .orderBy(desc(events.createdAt))
    .limit(limit);
  return rows.flatMap((r) => {
    const payload = { ...(r.payload as Record<string, unknown>), ...(r.client ? { client: r.client } : {}) };
    const line = describeEvent(r.verb, payload);
    return line ? [{ ...line, id: r.id, verb: r.verb, at: r.at.toISOString() }] : [];
  });
}

/** Invoices raised in the period (anything not voided), by the day they were created. */
export async function invoicedInPeriod(ws: string, range: PeriodRange) {
  const [row] = await getDb()
    .select({ cents: sql<number>`coalesce(sum(${invoices.amountCents}), 0)::int` })
    .from(invoices)
    .where(and(eq(invoices.workspaceId, ws), ne(invoices.status, "void"), inPeriod(invoices.createdAt, range)));
  return Number(row?.cents ?? 0);
}

/**
 * Commission earned in the period per person: Reiss's partner share and any
 * rep's, net of clawbacks, voided lines left out. Dated by when the money
 * moved (`earned_at`), like the statements.
 */
export async function sharesByOwner(ws: string, range: PeriodRange) {
  const rows = await getDb()
    .select({ id: commissionEntries.repMembershipId, name: repProfiles.displayName, cents: sql<number>`coalesce(sum(${commissionEntries.amountCents}), 0)::int` })
    .from(commissionEntries)
    .innerJoin(repProfiles, eq(repProfiles.membershipId, commissionEntries.repMembershipId))
    .where(and(eq(commissionEntries.workspaceId, ws), ne(commissionEntries.status, "void"), inPeriod(commissionEntries.earnedAt, range)))
    .groupBy(commissionEntries.repMembershipId, repProfiles.displayName);
  return rows.map((r) => ({ id: r.id, name: r.name, cents: Number(r.cents) })).filter((r) => r.cents > 0).sort((a, b) => b.cents - a.cents);
}

/** Every open invoice's due date and amount: what the runway expects to come in. */
export async function openInvoiceDues(ws: string) {
  const rows = await getDb()
    .select({ dueOn: invoices.dueOn, amountCents: invoices.amountCents })
    .from(invoices)
    .where(and(eq(invoices.workspaceId, ws), eq(invoices.status, "open")));
  return rows.map((r) => ({ dueOn: r.dueOn, amountCents: Number(r.amountCents) }));
}

/** Commission statements drafted or approved but not paid: what the runway expects to go out. */
export async function unpaidStatements(ws: string) {
  const rows = await getDb()
    .select({ periodEnd: commissionStatements.periodEnd, totalCents: commissionStatements.totalCents })
    .from(commissionStatements)
    .where(and(eq(commissionStatements.workspaceId, ws), inArray(commissionStatements.status, ["draft", "approved"])));
  return rows.map((r) => ({ periodEnd: r.periodEnd, totalCents: Number(r.totalCents) })).filter((r) => r.totalCents > 0);
}

export const HEAT_METRICS = ["cash", "won", "calls"] as const;
export type HeatMetric = (typeof HEAT_METRICS)[number];

/**
 * One number per sales-time-zone day for the heat map: cash collected (cents),
 * deals won (count, by `won_at`) or calls logged (count, from the audit trail).
 */
export async function dailyActivity(ws: string, metric: HeatMetric, startIso: string, endIso: string) {
  const db = getDb();
  const range = { startIso, endIso, bucket: "day" } as PeriodRange;
  const day = (column: unknown) => sql<string>`to_char((${column} at time zone ${TZ})::date, 'YYYY-MM-DD')`;
  let rows: { key: string; value: number }[];
  if (metric === "cash") {
    const key = day(invoices.paidAt);
    rows = await db
      .select({ key, value: sql<number>`coalesce(sum(${invoices.amountCents}), 0)::int` })
      .from(invoices)
      .where(and(eq(invoices.workspaceId, ws), eq(invoices.status, "paid"), isNotNull(invoices.paidAt), inPeriod(invoices.paidAt, range)))
      .groupBy(key);
  } else if (metric === "won") {
    const key = day(deals.wonAt);
    rows = await db
      .select({ key, value: sql<number>`count(*)::int` })
      .from(deals)
      .where(and(eq(deals.workspaceId, ws), isWon, isNotNull(deals.wonAt), inPeriod(deals.wonAt, range)))
      .groupBy(key);
  } else {
    const key = day(events.createdAt);
    rows = await db
      .select({ key, value: sql<number>`count(*)::int` })
      .from(events)
      .where(and(eq(events.workspaceId, ws), eq(events.verb, "deal.call_logged"), inPeriod(events.createdAt, range)))
      .groupBy(key);
  }
  return new Map(rows.map((r) => [r.key, Number(r.value)]));
}
