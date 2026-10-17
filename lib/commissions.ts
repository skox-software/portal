import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  clients,
  deals,
  commissionEntries,
  invoiceRefunds,
  invoices,
  memberships,
  projects,
  repProfiles,
} from "@/lib/db/schema";
import { eventInsert } from "@/lib/events";
import { planDealShares, refundClawbackLines } from "@/lib/commission-math";
import { sendEmail } from "@/lib/email";
import { formatMoney } from "@/lib/format";
import { ownerRecipients, portalLink, staffRecipients } from "@/lib/notify";

/**
 * The commission ledger. Append-only: payments add `earned` lines, refunds
 * and reversals add negative `clawback` lines, and corrections are
 * `adjustment`s. Nothing here ever edits an approved or paid line.
 */

type Invoice = typeof invoices.$inferSelect;

/** Explicit project/deal credit wins; a founder deal owner is the fallback. Never throws on setup problems. */
async function allocationsForProject(projectId: string, workspaceId: string, baseCents: number) {
  const db = getDb();
  const [project] = await db.select({ repId: projects.repMembershipId, clientName: clients.name })
    .from(projects).innerJoin(clients, eq(clients.id, projects.clientId))
    .where(and(eq(projects.id, projectId), eq(projects.workspaceId, workspaceId))).limit(1);
  if (!project) return null;
  const people = await workspaceReps(workspaceId);
  const sources = project.repId ? [] : await db.select({ repId: deals.repMembershipId, ownerEmail: deals.ownerEmail }).from(deals)
    .where(and(eq(deals.projectId, projectId), eq(deals.workspaceId, workspaceId)));
  const plan = planDealShares({
    baseCents, projectRepId: project.repId, deals: sources,
    people: people.map(p => ({ id: p.membership.id, role: p.membership.role, email: p.membership.email, status: p.profile.status, name: p.profile.displayName })),
  });
  if (!plan || "attention" in plan) return plan;
  return { clientName: project.clientName, allocations: plan.allocations, notes: plan.notes, people };
}

/**
 * Commission setup needs a person: log it on the audit trail and email the
 * owner(s). Never throws, so it can't take a payment down with it.
 */
export async function flagCommissionAttention(invoice: Invoice, reason: string, actor = "system") {
  try {
    await eventInsert({ workspaceId: invoice.workspaceId, projectId: invoice.projectId, actorId: actor,
      verb: "commission.needs_attention", subjectType: "invoice", subjectId: invoice.id, payload: { invoice: invoice.number, reason } });
  } catch (error) {
    console.error("[commissions] could not log needs_attention", { invoiceId: invoice.id, reason, error });
  }
  try {
    const owners = await ownerRecipients(invoice.workspaceId);
    await sendEmail(owners.length ? owners : await staffRecipients(invoice.workspaceId), {
      subject: `Check commission: invoice ${invoice.number}`,
      preheader: "A payment was recorded, but its commission could not be allocated.",
      heading: "Commission review required",
      paragraphs: [
        `Invoice ${invoice.number} (${invoice.title}) is paid for ${formatMoney(invoice.amountCents, invoice.currency)}, but no commission was recorded for it.`,
        `Reason: ${reason}`,
        "Fix the project's credit or the commission profiles, then add the earning as an adjustment.",
      ],
      cta: { label: "Open commissions", href: portalLink("/admin/commissions") },
    });
  } catch (error) {
    console.error("[commissions] could not email needs_attention", { invoiceId: invoice.id, reason, error });
  }
}

/**
 * One atomic insert for all recipients. Retried payments cannot duplicate
 * shares. Setup problems are flagged for a person and return null; they
 * never throw, so a payment is always recorded.
 */
export async function recordEarning(invoice: Invoice, actor = "system") {
  if (invoice.status !== "paid" || !invoice.paidAt || invoice.amountCents <= 0) return null;
  const found = await allocationsForProject(invoice.projectId, invoice.workspaceId, invoice.amountCents);
  if (!found) return null;
  if ("attention" in found) {
    await flagCommissionAttention(invoice, found.attention, actor);
    return null;
  }
  const note = found.notes.length ? found.notes.join(" ") : null;
  if (!found.allocations.length) {
    if (note) await eventInsert({ workspaceId: invoice.workspaceId, projectId: invoice.projectId, actorId: actor,
      verb: "commission.skipped", subjectType: "invoice", subjectId: invoice.id, payload: { invoice: invoice.number, note } });
    return null;
  }
  const db = getDb();
  const values = found.allocations.map(share => ({
    id: crypto.randomUUID(), rep_id: share.id, rate_bps: share.rateBps, amount_cents: share.amountCents,
    name: found.people.find(p => p.membership.id === share.id)?.profile.displayName ?? null,
  }));
  // Serialize a payment's allocation, then freeze the entire first split. A
  // retry after ownership changes must not add a second set of recipients.
  const [, result] = await db.batch([
    db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${invoice.id}, 0))`),
    db.execute(sql`
      with src as (
        select * from jsonb_to_recordset(${JSON.stringify(values)}::jsonb) as x(id uuid, rep_id uuid, rate_bps int, amount_cents int, name text)
      ), inserted as (
        insert into commission_entries (id, workspace_id, rep_membership_id, project_id, invoice_id, kind, base_cents, rate_bps, amount_cents, earned_at, client_name, note, created_by)
        select src.id, ${invoice.workspaceId}::uuid, src.rep_id, ${invoice.projectId}::uuid, ${invoice.id}::uuid, 'earned', ${invoice.amountCents}, src.rate_bps, src.amount_cents, ${invoice.paidAt.toISOString()}::timestamptz, ${found.clientName}, ${`Invoice ${invoice.number} · gross deal share`}, ${actor}
        from src
        where not exists (select 1 from commission_entries where invoice_id = ${invoice.id}::uuid and earned_at = ${invoice.paidAt.toISOString()}::timestamptz and kind = 'earned')
        returning *
      ), logged as (
        insert into events (workspace_id, project_id, actor_id, verb, subject_type, subject_id, payload)
        select inserted.workspace_id, inserted.project_id, ${actor}, 'commission.earned', 'commission', inserted.id::text,
          jsonb_strip_nulls(jsonb_build_object('invoice', ${invoice.number}::text, 'amountCents', inserted.amount_cents, 'rateBps', inserted.rate_bps, 'rep', src.name, 'note', ${note}::text))
        from inserted join src on src.id = inserted.id
      ) select * from inserted
    `),
  ]);
  return result.rows[0] ?? null;
}

/** All recipients of the latest payment, excluding voided/reversed earnings. */
async function liveEarnings(invoiceId: string) {
  const rows = await getDb().select().from(commissionEntries)
    .where(and(eq(commissionEntries.invoiceId, invoiceId), eq(commissionEntries.kind, "earned"), ne(commissionEntries.status, "void")))
    .orderBy(desc(commissionEntries.earnedAt));
  if (!rows.length) return [];
  const latest = rows.filter(r => r.earnedAt.getTime() === rows[0].earnedAt.getTime());
  const reversals = await getDb().select({ id: commissionEntries.reversalOf }).from(commissionEntries)
    .where(inArray(commissionEntries.reversalOf, latest.map(r => r.id)));
  const reversed = new Set(reversals.map(r => r.id));
  return latest.filter(r => !reversed.has(r.id));
}

/**
 * Takes back each recipient's remaining earnings when a paid invoice is
 * re-opened or voided. An earning nobody has approved yet (pending, on no
 * statement or only a draft) is voided outright, along with its refund
 * clawbacks, so the net is zero and nothing shows on a statement. Anything
 * approved or paid is never edited: it gets a negative reversal line instead.
 */
export async function reverseEarning(invoice: Invoice, actor: string, reason: string) {
  const earnings = await liveEarnings(invoice.id);
  if (!earnings.length) return;
  const db = getDb();
  const refunds = await db.select().from(commissionEntries).where(and(
    eq(commissionEntries.invoiceId, invoice.id), eq(commissionEntries.kind, "clawback"), ne(commissionEntries.status, "void"),
    sql`${commissionEntries.refundId} is not null`, sql`${commissionEntries.earnedAt} >= ${earnings[0].earnedAt}`,
  ));
  const note = `Invoice ${invoice.number} ${reason}`;
  const reverse: typeof earnings = [];
  for (const earning of earnings) {
    const own = refunds.filter(r => r.repMembershipId === earning.repMembershipId);
    const ids = [earning.id, ...own.map(r => r.id)];
    const statementIds = [...new Set([earning, ...own].map(e => e.statementId).filter((id): id is string => Boolean(id)))];
    // All or nothing, decided under the invoice lock: if any line is approved,
    // paid, or on a non-draft statement, nothing is voided and we reverse instead.
    const [, voided] = await db.batch([
      db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${invoice.id}, 0))`),
      db.execute(sql`
        with blocked as (
          select 1 from commission_entries c left join commission_statements s on s.id = c.statement_id
          where c.id in (${sql.join(ids.map(id => sql`${id}::uuid`), sql`, `)})
            and not (c.status = 'pending' and (c.statement_id is null or s.status = 'draft'))
        ), voided as (
          update commission_entries c set status = 'void', statement_id = null,
            note = concat_ws(' · ', c.note, ${`voided: ${note}`}::text)
          where c.id in (${sql.join(ids.map(id => sql`${id}::uuid`), sql`, `)}) and not exists (select 1 from blocked)
          returning c.*
        ), logged as (
          insert into events (workspace_id, project_id, actor_id, verb, subject_type, subject_id, payload)
          select workspace_id, ${invoice.projectId}::uuid, ${actor}, 'commission.voided', 'commission', id::text,
            jsonb_build_object('invoice', ${invoice.number}::text, 'amountCents', amount_cents, 'reason', ${reason}::text)
          from voided
        ) select id from voided
      `),
      // A draft that lost lines shows its new total until it's approved (which re-totals anyway).
      ...(statementIds.length ? [db.execute(sql`
        update commission_statements s set total_cents = (select coalesce(sum(amount_cents), 0) from commission_entries where statement_id = s.id)
        where s.status = 'draft' and s.id in (${sql.join(statementIds.map(id => sql`${id}::uuid`), sql`, `)})
      `)] : []),
    ]);
    if (!voided.rows.length) reverse.push(earning);
  }
  if (!reverse.length) return;
  const entries = await db.insert(commissionEntries).values(reverse.map(earning => ({
    workspaceId: invoice.workspaceId, repMembershipId: earning.repMembershipId,
    projectId: earning.projectId, invoiceId: invoice.id, kind: "clawback" as const,
    reversalOf: earning.id, baseCents: earning.baseCents, rateBps: earning.rateBps,
    amountCents: -(earning.amountCents + refunds.filter(r => r.repMembershipId === earning.repMembershipId).reduce((sum, r) => sum + r.amountCents, 0)),
    earnedAt: new Date(), clientName: earning.clientName,
    note, createdBy: actor,
  }))).onConflictDoNothing().returning();
  for (const entry of entries) await eventInsert({ workspaceId: invoice.workspaceId, projectId: invoice.projectId, actorId: actor,
    verb: "commission.clawback", subjectType: "commission", subjectId: entry.id, payload: { invoice: invoice.number, amountCents: entry.amountCents, reason } });
}

/** Money refunded on an invoice so far. */
export async function refundedCents(invoiceId: string) {
  const [row] = await getDb()
    .select({ total: sql<number>`coalesce(sum(${invoiceRefunds.amountCents}), 0)::int` })
    .from(invoiceRefunds)
    .where(eq(invoiceRefunds.invoiceId, invoiceId));
  return Number(row?.total ?? 0);
}

/** Refund clawbacks already written against the latest earnings, per recipient (positive cents). */
async function clawedSoFar(invoiceId: string, earnings: Awaited<ReturnType<typeof liveEarnings>>) {
  if (!earnings.length) return [];
  const rows = await getDb().select({ rep: commissionEntries.repMembershipId, amountCents: commissionEntries.amountCents }).from(commissionEntries).where(and(
    eq(commissionEntries.invoiceId, invoiceId), eq(commissionEntries.kind, "clawback"), ne(commissionEntries.status, "void"),
    sql`${commissionEntries.refundId} is not null`, sql`${commissionEntries.earnedAt} >= ${earnings[0].earnedAt}`,
  ));
  return earnings.map(e => -rows.filter(r => r.rep === e.repMembershipId).reduce((sum, r) => sum + r.amountCents, 0));
}

/**
 * Records a refund and claws back each recipient's share at the rate they
 * earned. The caller says what the invoice's cumulative refunded total should
 * now be (Stripe's `amount_refunded`); the new refund is the difference from
 * what's recorded, computed under the invoice lock, so concurrent refunds
 * never double-count. `stripeRefundId` makes Stripe retries a no-op.
 * `recordedCents` is what this call added (0 when there was nothing new).
 */
export async function recordRefund(
  invoice: Invoice,
  input: { targetRefundedCents: number; reason: string | null; actor: string; stripeRefundId?: string | null },
): Promise<{ ok: true; recordedCents: number } | { ok: false; message: string }> {
  const target = input.targetRefundedCents;
  if (!Number.isInteger(target) || target <= 0) return { ok: false, message: "Enter the amount refunded." };
  if (target > invoice.amountCents) return { ok: false, message: "That's more than was paid on this invoice." };
  const db = getDb();
  const existingRefund = async () => input.stripeRefundId ? (await db.select({ id: invoiceRefunds.id }).from(invoiceRefunds).where(eq(invoiceRefunds.stripeRefundId, input.stripeRefundId)).limit(1))[0] : undefined;
  if (await existingRefund()) return { ok: true, recordedCents: 0 };
  for (let attempt = 0; ; attempt++) {
    const already = await refundedCents(invoice.id);
    const amountCents = target - already;
    if (amountCents <= 0) return { ok: true, recordedCents: 0 };
    const earnings = await liveEarnings(invoice.id);
    const lines = refundClawbackLines(invoice.amountCents, earnings.map(e => ({ id: e.repMembershipId, rateBps: e.rateBps, amountCents: e.amountCents })), await clawedSoFar(invoice.id, earnings), target);
    const refundId = crypto.randomUUID();
    const now = new Date();
    const entries = lines.map(line => ({
      id: crypto.randomUUID(), workspaceId: invoice.workspaceId, repMembershipId: line.id,
      projectId: invoice.projectId, invoiceId: invoice.id, refundId, kind: "clawback" as const,
      baseCents: amountCents, rateBps: line.rateBps, amountCents: line.amountCents,
      earnedAt: now, clientName: earnings[line.index].clientName, note: `Refund on invoice ${invoice.number}`, createdBy: input.actor,
    }));
    try {
      // Refund and every recipient's clawback commit together, including their audit events.
      await db.batch([
        db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${invoice.id}, 0))`),
        // If another refund committed after our read, roll back and recalculate from the target.
        db.execute(sql`select 1 / case when coalesce(sum(amount_cents),0) = ${already} then 1 else 0 end from invoice_refunds where invoice_id=${invoice.id}::uuid`),
        db.insert(invoiceRefunds).values({ id: refundId, workspaceId: invoice.workspaceId, invoiceId: invoice.id, amountCents, reason: input.reason, stripeRefundId: input.stripeRefundId ?? null, createdBy: input.actor, createdAt: now }),
        eventInsert({ workspaceId: invoice.workspaceId, projectId: invoice.projectId, actorId: input.actor, verb: "invoice.refunded", subjectType: "invoice", subjectId: invoice.id, payload: { number: invoice.number, amountCents, reason: input.reason } }),
        ...(entries.length ? [db.insert(commissionEntries).values(entries)] : []),
        ...entries.map(entry => eventInsert({ workspaceId: invoice.workspaceId, projectId: invoice.projectId, actorId: input.actor, verb: "commission.clawback", subjectType: "commission", subjectId: entry.id, payload: { invoice: invoice.number, amountCents: entry.amountCents } })),
      ]);
      return { ok: true, recordedCents: amountCents };
    } catch (error) {
      // A concurrent Stripe retry may have committed the same refund first.
      if (await existingRefund()) return { ok: true, recordedCents: 0 };
      const code = (error as { code?: string; cause?: { code?: string } }).cause?.code ?? (error as { code?: string }).code;
      if (code === "22012" && attempt < 2) continue;
      throw error;
    }
  }
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
