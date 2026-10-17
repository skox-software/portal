"use server";
import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaff } from "@/lib/access";
import { getDb } from "@/lib/db";
import { memberships } from "@/lib/db/schema";
import { eventInsert } from "@/lib/events";
import { backWith } from "@/lib/http";
import { normalizeEmail } from "@/lib/permissions";
const path = "/admin/team";
export async function inviteEmployee(form: FormData) {
  const { viewer, staff } = await requireStaff();
  const parsed = z.email().max(254).safeParse(normalizeEmail(String(form.get("email") ?? "")));
  if (!parsed.success) backWith(path, "error", "Enter a valid employee email.");
  const email = parsed.data;
  const db = getDb();
  const [existing] = await db.select().from(memberships).where(and(eq(memberships.workspaceId, staff.workspaceId), isNull(memberships.clientId), eq(memberships.email, email))).limit(1);
  if (existing) backWith(path, "error", "This email is already listed. Restore its access if needed.");
  const id = crypto.randomUUID();
  await db.batch([
    db.insert(memberships).values({ id, workspaceId: staff.workspaceId, email, role: "staff", invitedBy: viewer.userId }),
    eventInsert({ workspaceId: staff.workspaceId, actorId: viewer.userId, verb: "employee.invited", subjectType: "membership", subjectId: id, payload: { email } }),
  ]);
  revalidatePath(path);
  backWith(path, "notice", `${email} can now sign in. Share the portal sign-in link with them.`);
}
export async function setMemberAccess(form: FormData) {
  const { viewer, staff } = await requireStaff();
  const parsed = z.object({ membershipId: z.uuid(), action: z.enum(["revoke", "restore"]) }).safeParse(Object.fromEntries(form));
  if (!parsed.success) backWith(path, "error", "Unknown account.");
  const db = getDb();
  const [member] = await db.select().from(memberships).where(and(eq(memberships.id, parsed.data.membershipId), eq(memberships.workspaceId, staff.workspaceId))).limit(1);
  if (!member || member.role === "staff_owner") backWith(path, "error", "Admin access cannot be changed here.");
  await db.batch([
    db.update(memberships).set({ revokedAt: parsed.data.action === "revoke" ? new Date() : null }).where(eq(memberships.id, member.id)),
    eventInsert({ workspaceId: staff.workspaceId, actorId: viewer.userId, verb: `membership.${parsed.data.action}`, subjectType: "membership", subjectId: member.id, payload: { email: member.email, role: member.role } }),
  ]);
  revalidatePath(path);
  backWith(path, "notice", parsed.data.action === "revoke" ? "Access revoked, including existing sessions." : "Access restored.");
}
