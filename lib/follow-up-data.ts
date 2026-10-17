import { and, asc, eq, isNotNull, lte } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { clients, deals } from "@/lib/db/schema";
import type { DueFollowUp } from "@/lib/follow-up";

export type { DueFollowUp };

/**
 * Follow-ups that are due (today or overdue) across a workspace: leads from
 * the pipeline and client accounts, in one list. Feeds the sidebar count and
 * the morning reminder email.
 */
export async function dueFollowUps(workspaceId: string, today: string): Promise<DueFollowUp[]> {
  const db = getDb();
  const [dealRows, clientRows] = await Promise.all([
    db
      .select({ id: deals.id, name: deals.company, dueOn: deals.nextStepOn, note: deals.nextStep, owner: deals.ownerEmail })
      .from(deals)
      .where(and(eq(deals.workspaceId, workspaceId), isNotNull(deals.nextStepOn), lte(deals.nextStepOn, today)))
      .orderBy(asc(deals.nextStepOn)),
    db
      .select({ id: clients.id, name: clients.name, dueOn: clients.nextStepOn, note: clients.nextStep, owner: clients.nextStepOwner })
      .from(clients)
      .where(and(eq(clients.workspaceId, workspaceId), isNotNull(clients.nextStepOn), lte(clients.nextStepOn, today)))
      .orderBy(asc(clients.nextStepOn)),
  ]);
  return [
    ...dealRows.map((d) => ({ kind: "deal" as const, id: d.id, name: d.name, dueOn: d.dueOn!, note: d.note, owner: d.owner?.toLowerCase() ?? null, href: `/admin/clients?deal=${d.id}` })),
    ...clientRows.map((c) => ({ kind: "client" as const, id: c.id, name: c.name, dueOn: c.dueOn!, note: c.note, owner: c.owner?.toLowerCase() ?? null, href: `/admin/clients/${c.id}` })),
  ].sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.name.localeCompare(b.name));
}
