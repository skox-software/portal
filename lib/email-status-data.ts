import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { events } from "@/lib/db/schema";
import { latestStatus, type StatusReport } from "@/lib/resend-events";

/**
 * Each lead's outreach delivery status (lib/resend-events.ts), from its
 * `deal.email_status` events. Pass a deal id to load just that lead.
 */
export async function loadEmailStatuses(workspaceId: string, dealId?: string) {
  const rows = await getDb()
    .select({ dealId: events.subjectId, payload: events.payload })
    .from(events)
    .where(and(eq(events.workspaceId, workspaceId), eq(events.verb, "deal.email_status"), ...(dealId ? [eq(events.subjectId, dealId)] : [])));
  const byDeal = new Map<string, StatusReport[]>();
  for (const r of rows) {
    if (!r.dealId) continue;
    const list = byDeal.get(r.dealId) ?? [];
    list.push(r.payload as StatusReport);
    byDeal.set(r.dealId, list);
  }
  const statuses = new Map<string, StatusReport>();
  for (const [id, list] of byDeal) {
    const best = latestStatus(list);
    if (best) statuses.set(id, best);
  }
  return statuses;
}
