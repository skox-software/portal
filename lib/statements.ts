import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { commissionEntries, commissionStatements, memberships, repProfiles } from "@/lib/db/schema";
import { eventInsert } from "@/lib/events";
import { periodLabel, statementLines } from "@/lib/commission-math";
import { formatMoney } from "@/lib/format";
import { portalLink } from "@/lib/notify";
import { isStaffRole } from "@/lib/permissions";
import { sendEmail } from "@/lib/email";

/**
 * Monthly commission statements. A month closes into one draft per rep with
 * money owed; the workspace owner approves it, pays it outside the portal,
 * and marks it paid with the transfer reference. Paid statements never change.
 */

/** Pending lines not yet on a statement, with the day they were earned (Florida time). */
async function openLines(workspaceId: string) {
  return getDb()
    .select({
      id: commissionEntries.id,
      rep: commissionEntries.repMembershipId,
      amountCents: commissionEntries.amountCents,
      earnedAt: commissionEntries.earnedAt,
    })
    .from(commissionEntries)
    .where(and(eq(commissionEntries.workspaceId, workspaceId), eq(commissionEntries.status, "pending"), isNull(commissionEntries.statementId)))
    .orderBy(asc(commissionEntries.earnedAt));
}

function floridaDay(d: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/**
 * Drafts statements for a closed month. Idempotent: a rep who already has a
 * statement for the period is skipped, and lines only ever join one statement.
 */
export async function draftStatements(workspaceId: string, period: { start: string; end: string }, actor = "system") {
  const db = getDb();
  const lines = (await openLines(workspaceId)).map((l) => ({ ...l, earnedOn: floridaDay(l.earnedAt) }));
  const byRep = new Map<string, typeof lines>();
  for (const l of lines) byRep.set(l.rep, [...(byRep.get(l.rep) ?? []), l]);

  const existing = await db
    .select({ rep: commissionStatements.repMembershipId })
    .from(commissionStatements)
    .where(and(eq(commissionStatements.workspaceId, workspaceId), eq(commissionStatements.periodStart, period.start)));
  const done = new Set(existing.map((e) => e.rep));

  const drafted: string[] = [];
  for (const [rep, pending] of byRep) {
    if (done.has(rep)) continue;
    const { lines: picked, total } = statementLines(pending, period.end);
    if (!picked.length) continue;
    const id = crypto.randomUUID();
    try {
      await db.batch([
        db.insert(commissionStatements).values({ id, workspaceId, repMembershipId: rep, periodStart: period.start, periodEnd: period.end, totalCents: total }),
        db
          .update(commissionEntries)
          .set({ statementId: id })
          .where(and(inArray(commissionEntries.id, picked.map((p) => p.id)), isNull(commissionEntries.statementId), eq(commissionEntries.status, "pending"))),
        eventInsert({ workspaceId, actorId: actor, verb: "statement.drafted", subjectType: "statement", subjectId: id, payload: { period: period.start, totalCents: total, lines: picked.length } }),
      ]);
      drafted.push(id);
    } catch (error) {
      // Another run drafted it first (unique rep + period). Nothing to do.
      console.warn("[statements] draft skipped", { rep, period: period.start, error: (error as Error).message });
    }
  }
  return drafted;
}

async function statementWithRep(id: string, workspaceId: string) {
  const [row] = await getDb()
    .select({ statement: commissionStatements, email: memberships.email, role: memberships.role, name: repProfiles.displayName })
    .from(commissionStatements)
    .innerJoin(memberships, eq(memberships.id, commissionStatements.repMembershipId))
    .innerJoin(repProfiles, eq(repProfiles.membershipId, commissionStatements.repMembershipId))
    .where(and(eq(commissionStatements.id, id), eq(commissionStatements.workspaceId, workspaceId)))
    .limit(1);
  return row ?? null;
}

type Result = { ok: true; message: string } | { ok: false; message: string };

/**
 * Where the statement email points. Reps read it in their own area; a staff
 * founder can't open /rep (it 404s for staff), so they get the ledger.
 */
function statementHref(found: NonNullable<Awaited<ReturnType<typeof statementWithRep>>>) {
  return isStaffRole(found.role)
    ? portalLink(`/admin/commissions?rep=${found.statement.repMembershipId}#ledger`)
    : portalLink(`/rep/earnings/statements/${found.statement.id}`);
}

/** The total is re-read from its lines, so what's approved is exactly what's listed. */
export async function approveStatement(id: string, workspaceId: string, actor: string): Promise<Result> {
  const db = getDb();
  const found = await statementWithRep(id, workspaceId);
  if (!found || found.statement.status !== "draft") return { ok: false, message: "Only a draft statement can be approved." };
  const lines = await db.select({ amountCents: commissionEntries.amountCents }).from(commissionEntries).where(eq(commissionEntries.statementId, id));
  const total = lines.reduce((s, l) => s + l.amountCents, 0);
  if (total <= 0) return { ok: false, message: "This statement has nothing owed. Discard it instead." };
  const now = new Date();
  await db.batch([
    db.update(commissionStatements).set({ status: "approved", approvedAt: now, approvedBy: actor, totalCents: total }).where(and(eq(commissionStatements.id, id), eq(commissionStatements.status, "draft"))),
    db.update(commissionEntries).set({ status: "approved" }).where(and(eq(commissionEntries.statementId, id), eq(commissionEntries.status, "pending"))),
    eventInsert({ workspaceId, actorId: actor, verb: "statement.approved", subjectType: "statement", subjectId: id, payload: { totalCents: total, rep: found.name } }),
  ]);
  await sendEmail([found.email], {
    subject: `Your ${periodLabel(found.statement.periodStart)} commission is approved`,
    preheader: `${formatMoney(total)} approved. Payment follows shortly.`,
    heading: `${formatMoney(total)} approved`,
    paragraphs: [`Your commission statement for ${periodLabel(found.statement.periodStart)} has been approved. We'll send payment shortly and let you know when it's on its way.`],
    cta: { label: "View statement", href: statementHref(found) },
  });
  return { ok: true, message: `Approved ${formatMoney(total)} for ${found.name}.` };
}

export async function markStatementPaid(id: string, workspaceId: string, actor: string, reference: string): Promise<Result> {
  const db = getDb();
  const found = await statementWithRep(id, workspaceId);
  if (!found || found.statement.status !== "approved") return { ok: false, message: "Approve the statement before marking it paid." };
  const now = new Date();
  await db.batch([
    db.update(commissionStatements).set({ status: "paid", paidAt: now, paidBy: actor, paymentReference: reference || null }).where(and(eq(commissionStatements.id, id), eq(commissionStatements.status, "approved"))),
    db.update(commissionEntries).set({ status: "paid" }).where(and(eq(commissionEntries.statementId, id), eq(commissionEntries.status, "approved"))),
    eventInsert({ workspaceId, actorId: actor, verb: "statement.paid", subjectType: "statement", subjectId: id, payload: { totalCents: found.statement.totalCents, reference, rep: found.name } }),
  ]);
  await sendEmail([found.email], {
    subject: `Commission sent: ${formatMoney(found.statement.totalCents)}`,
    preheader: `Your ${periodLabel(found.statement.periodStart)} commission is on its way.`,
    heading: "Payment sent",
    paragraphs: [
      `We've sent ${formatMoney(found.statement.totalCents)} for your ${periodLabel(found.statement.periodStart)} commission.`,
      ...(reference ? [`Reference: ${reference}`] : []),
    ],
    cta: { label: "View statement", href: statementHref(found) },
  });
  return { ok: true, message: `Marked ${formatMoney(found.statement.totalCents)} paid to ${found.name}.` };
}

/** Throws away a draft: its lines go back to pending for the next close. */
export async function discardStatement(id: string, workspaceId: string, actor: string): Promise<Result> {
  const db = getDb();
  const found = await statementWithRep(id, workspaceId);
  if (!found || found.statement.status !== "draft") return { ok: false, message: "Only a draft can be discarded." };
  await db.batch([
    db.update(commissionEntries).set({ statementId: null }).where(and(eq(commissionEntries.statementId, id), eq(commissionEntries.status, "pending"))),
    db.delete(commissionStatements).where(and(eq(commissionStatements.id, id), eq(commissionStatements.status, "draft"))),
    eventInsert({ workspaceId, actorId: actor, verb: "statement.discarded", subjectType: "statement", subjectId: id, payload: { period: found.statement.periodStart, rep: found.name } }),
  ]);
  return { ok: true, message: `Discarded the draft for ${found.name}. Its lines will be on the next statement.` };
}
