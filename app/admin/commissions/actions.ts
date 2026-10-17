"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaff } from "@/lib/access";
import { monthPeriod, previousMonth } from "@/lib/commission-math";
import { getDb } from "@/lib/db";
import { commissionEntries, repProfiles } from "@/lib/db/schema";
import { eventInsert } from "@/lib/events";
import { salesToday } from "@/lib/follow-up";
import { backWith } from "@/lib/http";
import { canApproveCommissions } from "@/lib/permissions";
import { approveStatement, discardStatement, draftStatements, markStatementPaid } from "@/lib/statements";

const BACK = "/admin/commissions";

async function requireOwner() {
  const ctx = await requireStaff();
  if (!canApproveCommissions(ctx.staff.role)) backWith(BACK, "error", "Only the workspace owner can approve, pay or adjust commissions.");
  return ctx;
}

function done(result: { ok: boolean; message: string }) {
  revalidatePath(BACK);
  revalidatePath("/admin/reps");
  backWith(BACK, result.ok ? "notice" : "error", result.message);
}

/** Drafts statements for a closed month. Safe to run any time; it only adds what's missing. */
export async function closeMonth(formData: FormData) {
  const { viewer, staff } = await requireStaff();
  const month = String(formData.get("month") ?? "");
  const period = /^\d{4}-\d{2}$/.test(month) ? monthPeriod(Number(month.slice(0, 4)), Number(month.slice(5, 7))) : previousMonth(salesToday());
  if (period.end >= salesToday()) backWith(BACK, "error", "That month hasn't ended yet.");
  const drafted = await draftStatements(staff.workspaceId, period, viewer.userId);
  done({ ok: true, message: drafted.length ? `Drafted ${drafted.length} statement${drafted.length === 1 ? "" : "s"}.` : "Nothing new to draft for that month." });
}

const idOf = (formData: FormData) => {
  const id = String(formData.get("statementId") ?? "");
  if (!z.uuid().safeParse(id).success) backWith(BACK, "error", "Unknown statement.");
  return id;
};

export async function approve(formData: FormData) {
  const { viewer, staff } = await requireOwner();
  done(await approveStatement(idOf(formData), staff.workspaceId, viewer.userId));
}

export async function markPaid(formData: FormData) {
  const { viewer, staff } = await requireOwner();
  const reference = String(formData.get("reference") ?? "").trim().slice(0, 200);
  done(await markStatementPaid(idOf(formData), staff.workspaceId, viewer.userId, reference));
}

export async function discard(formData: FormData) {
  const { viewer, staff } = await requireOwner();
  done(await discardStatement(idOf(formData), staff.workspaceId, viewer.userId));
}

/** A manual correction: a bonus, a missed payment, a fix. Always needs a reason. */
export async function addAdjustment(formData: FormData) {
  const { viewer, staff } = await requireOwner();
  const parsed = z
    .object({
      membershipId: z.uuid(),
      amount: z.string().trim().regex(/^-?\d+(\.\d{1,2})?$/),
      note: z.string().trim().min(3).max(300),
    })
    .safeParse({
      membershipId: String(formData.get("membershipId") ?? ""),
      amount: String(formData.get("amount") ?? "").replace(/[$,\s]/g, ""),
      note: String(formData.get("note") ?? ""),
    });
  if (!parsed.success) backWith(BACK, "error", "Pick a rep, an amount (negative to deduct) and a reason.");
  const amountCents = Math.round(Number(parsed.data.amount) * 100);
  if (amountCents === 0) backWith(BACK, "error", "The amount can't be zero.");
  const db = getDb();
  const [rep] = await db.select({ rateBps: repProfiles.rateBps, name: repProfiles.displayName }).from(repProfiles).where(and(eq(repProfiles.membershipId, parsed.data.membershipId), eq(repProfiles.workspaceId, staff.workspaceId))).limit(1);
  if (!rep) backWith(BACK, "error", "Unknown rep.");
  const id = crypto.randomUUID();
  await db.batch([
    db.insert(commissionEntries).values({
      id,
      workspaceId: staff.workspaceId,
      repMembershipId: parsed.data.membershipId,
      kind: "adjustment",
      baseCents: 0,
      rateBps: rep.rateBps,
      amountCents,
      earnedAt: new Date(),
      note: parsed.data.note,
      createdBy: viewer.userId,
    }),
    eventInsert({ workspaceId: staff.workspaceId, actorId: viewer.userId, verb: "commission.adjusted", subjectType: "commission", subjectId: id, payload: { rep: rep.name, amountCents, note: parsed.data.note } }),
  ]);
  done({ ok: true, message: `Adjustment added for ${rep.name}. It goes on their next statement.` });
}
