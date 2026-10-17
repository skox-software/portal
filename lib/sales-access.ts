import { and, eq, isNull } from "drizzle-orm";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireViewer } from "@/lib/access";
import { getDb } from "@/lib/db";
import { deals, memberships } from "@/lib/db/schema";
import { staffMembershipIn } from "@/lib/permissions";
export async function requireSalesTeam() {
  const viewer = await requireViewer();
  const member = staffMembershipIn(viewer.memberships);
  if (!member) notFound();
  return { viewer, member };
}
export async function salesContext(memberId?: string) {
  const context = await requireSalesTeam();
  let selected = context.member;
  if (memberId) {
    if (context.member.role !== "staff_owner" || !z.uuid().safeParse(memberId).success) notFound();
    const [row] = await getDb().select().from(memberships).where(and(eq(memberships.id, memberId), eq(memberships.workspaceId, context.member.workspaceId), isNull(memberships.clientId), isNull(memberships.revokedAt))).limit(1);
    if (!row || !["staff", "staff_owner"].includes(row.role)) notFound();
    selected = row;
  }
  return { ...context, selected };
}
export function assignedDeals(workspaceId: string, email: string) {
  return and(eq(deals.workspaceId, workspaceId), eq(deals.ownerEmail, email));
}
