import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  clients,
  commissionEntries,
  invoiceRefunds,
  invoices,
  memberships,
  projects,
  repProfiles,
} from "@/lib/db/schema";
import { eventInsert } from "@/lib/events";
import { clawbackCents, commissionCents } from "@/lib/commission-math";

/**
 * The commission ledger. Append-only: payments add `earned` lines, refunds
 * and reversals add negative `clawback` lines, and corrections are
 * `adjustment`s. Nothing here ever edits an approved or paid line.
 */

type Invoice = typeof invoices.$inferSelect;

/** The rep credited on a project, with their current rate, or null. */
async function repForProject(projectId: string) {
  const db = getDb();
  const [row] = await db
    .select({ project: projects, rep: repProfiles, clientName: clients.name })
    .from(projects)
    .innerJoin(clients, eq(clients.id, projects.clientId))
    .innerJoin(repProfiles, eq(repProfiles.membershipId, projects.repMembershipId))
    .where(eq(projects.id, projectId))
    .limit(1);
  return row ?? null;
}

/**
 * Credits the project's rep for a paid invoice. Safe to call more than once
 * for the same payment: the ledger has one earning per invoice and paid-at.
 */
export async function recordEarning(invoice: Invoice, actor = "system") {
  if (invoice.status !== "paid" || !invoice.paidAt || invoice.amountCents <= 0) return null;
  const found = await repForProject(invoice.projectId);
  if (!found || found.rep.status !== "active") return null;
  const { rep, clientName } = found;
  const db = getDb();
  const amountCents = commissionCents(invoice.amountCents, rep.rateBps);
  const [entry] = await db
    .insert(commissionEntries)
    .values({
      workspaceId: invoice.workspaceId,
      repMembershipId: rep.membershipId,
      projectId: invoice.projectId,
      invoiceId: invoice.id,
      kind: "earned",
      baseCents: invoice.amountCents,
      rateBps: rep.rateBps,
      amountCents,
      earnedAt: invoice.paidAt,
      clientName,
      note: `Invoice ${invoice.number}`,
      createdBy: actor,
    })
    .onConflictDoNothing()
    .returning();
  if (!entry) return null;
  await eventInsert({
    workspaceId: invoice.workspaceId,
    projectId: invoice.projectId,
    actorId: actor,
    verb: "commission.earned",
    subjectType: "commission",
    subjectId: entry.id,
    payload: { invoice: invoice.number, amountCents, rateBps: rep.rateBps, rep: rep.displayName },
  });
  return entry;
}

/** The latest live earning for an invoice: what a refund or reversal claws back from. */
async function liveEarning(invoiceId: string) {
  const [row] = await getDb()
    .select()
    .from(commissionEntries)
    .where(and(eq(commissionEntries.invoiceId, invoiceId), eq(commissionEntries.kind, "earned"), ne(commissionEntries.status, "void")))
    .orderBy(desc(commissionEntries.earnedAt))
    .limit(1);
  return row ?? null;
}

/**
 * An invoice stopped being paid (staff re-opened or voided it). A pending
 * earning is simply voided; one already approved or paid is reversed with a
 * clawback on the next statement.
 */
export async function reverseEarning(invoice: Invoice, actor: string, reason: string) {
  const earning = await liveEarning(invoice.id);
  if (!earning) return;
  const db = getDb();
  if (earning.status === "pending") {
    await db.batch([
      db.update(commissionEntries).set({ status: "void", note: `${earning.note ?? ""} · voided: ${reason}`.trim() }).where(and(eq(commissionEntries.id, earning.id), eq(commissionEntries.status, "pending"))),
      eventInsert({ workspaceId: invoice.workspaceId, projectId: invoice.projectId, actorId: actor, verb: "commission.voided", subjectType: "commission", subjectId: earning.id, payload: { invoice: invoice.number, reason } }),
    ]);
    return;
  }
  const [entry] = await db
    .insert(commissionEntries)
    .values({
      workspaceId: invoice.workspaceId,
      repMembershipId: earning.repMembershipId,
      projectId: earning.projectId,
      invoiceId: invoice.id,
      kind: "clawback",
      baseCents: earning.baseCents,
      rateBps: earning.rateBps,
      amountCents: -earning.amountCents,
      earnedAt: new Date(),
      clientName: earning.clientName,
      note: `Invoice ${invoice.number} ${reason}`,
      createdBy: actor,
    })
    .returning();
  await eventInsert({ workspaceId: invoice.workspaceId, projectId: invoice.projectId, actorId: actor, verb: "commission.clawback", subjectType: "commission", subjectId: entry.id, payload: { invoice: invoice.number, amountCents: entry.amountCents, reason } });
}

/** Money refunded on an invoice so far. */
export async function refundedCents(invoiceId: string) {
  const [row] = await getDb()
    .select({ total: sql<number>`coalesce(sum(${invoiceRefunds.amountCents}), 0)::int` })
    .from(invoiceRefunds)
    .where(eq(invoiceRefunds.invoiceId, invoiceId));
  return Number(row?.total ?? 0);
}

/**
 * Records a refund and claws back the rep's share at the rate they earned.
 * `stripeRefundId` makes Stripe retries a no-op.
 */
export async function recordRefund(
  invoice: Invoice,
  input: { amountCents: number; reason: string | null; actor: string; stripeRefundId?: string | null },
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) return { ok: false, message: "Enter the amount refunded." };
  const already = await refundedCents(invoice.id);
  if (already + input.amountCents > invoice.amountCents) return { ok: false, message: "That's more than was paid on this invoice." };
  const db = getDb();
  const [refund] = await db
    .insert(invoiceRefunds)
    .values({
      workspaceId: invoice.workspaceId,
      invoiceId: invoice.id,
      amountCents: input.amountCents,
      reason: input.reason,
      stripeRefundId: input.stripeRefundId ?? null,
      createdBy: input.actor,
    })
    .onConflictDoNothing()
    .returning();
  if (!refund) return { ok: true }; // already recorded
  await eventInsert({ workspaceId: invoice.workspaceId, projectId: invoice.projectId, actorId: input.actor, verb: "invoice.refunded", subjectType: "invoice", subjectId: invoice.id, payload: { number: invoice.number, amountCents: input.amountCents, reason: input.reason } });

  const earning = await liveEarning(invoice.id);
  if (!earning) return { ok: true };
  const amountCents = clawbackCents(input.amountCents, earning.rateBps);
  if (amountCents === 0) return { ok: true };
  const [entry] = await db
    .insert(commissionEntries)
    .values({
      workspaceId: invoice.workspaceId,
      repMembershipId: earning.repMembershipId,
      projectId: earning.projectId,
      invoiceId: invoice.id,
      refundId: refund.id,
      kind: "clawback",
      baseCents: input.amountCents,
      rateBps: earning.rateBps,
      amountCents,
      earnedAt: refund.createdAt,
      clientName: earning.clientName,
      note: `Refund on invoice ${invoice.number}`,
      createdBy: input.actor,
    })
    .onConflictDoNothing()
    .returning();
  if (entry) {
    await eventInsert({ workspaceId: invoice.workspaceId, projectId: invoice.projectId, actorId: input.actor, verb: "commission.clawback", subjectType: "commission", subjectId: entry.id, payload: { invoice: invoice.number, amountCents } });
  }
  return { ok: true };
}

export type RepTotals = { pending: number; approved: number; paidThisYear: number; paidLifetime: number };

/** Earnings tiles for one rep, or for every rep when `repIds` is omitted. */
export async function repTotals(workspaceId: string, repIds?: string[]) {
  const year = new Date().getUTCFullYear();
  const rows = await getDb()
    .select({
      rep: commissionEntries.repMembershipId,
      pending: sql<number>`coalesce(sum(${commissionEntries.amountCents}) filter (where ${commissionEntries.status} = 'pending'), 0)::int`,
      approved: sql<number>`coalesce(sum(${commissionEntries.amountCents}) filter (where ${commissionEntries.status} = 'approved'), 0)::int`,
      paidThisYear: sql<number>`coalesce(sum(${commissionEntries.amountCents}) filter (where ${commissionEntries.status} = 'paid' and extract(year from ${commissionEntries.earnedAt}) = ${year}), 0)::int`,
      paidLifetime: sql<number>`coalesce(sum(${commissionEntries.amountCents}) filter (where ${commissionEntries.status} = 'paid'), 0)::int`,
    })
    .from(commissionEntries)
    .where(and(eq(commissionEntries.workspaceId, workspaceId), ...(repIds?.length ? [inArray(commissionEntries.repMembershipId, repIds)] : [])))
    .groupBy(commissionEntries.repMembershipId);
  const out = new Map<string, RepTotals>();
  for (const r of rows) {
    out.set(r.rep, { pending: Number(r.pending), approved: Number(r.approved), paidThisYear: Number(r.paidThisYear), paidLifetime: Number(r.paidLifetime) });
  }
  return out;
}

export const EMPTY_TOTALS: RepTotals = { pending: 0, approved: 0, paidThisYear: 0, paidLifetime: 0 };

/** Every rep in a workspace: membership, profile and email. */
export async function workspaceReps(workspaceId: string) {
  return getDb()
    .select({ membership: memberships, profile: repProfiles })
    .from(repProfiles)
    .innerJoin(memberships, eq(memberships.id, repProfiles.membershipId))
    .where(eq(repProfiles.workspaceId, workspaceId))
    .orderBy(repProfiles.displayName);
}
