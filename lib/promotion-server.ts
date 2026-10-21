import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { deals, type Deal } from "@/lib/db/schema";
import { eventInsert } from "@/lib/events";
import { promotionTarget, type DealStage, type PromotionSignal } from "@/lib/pipeline";

type Write = Parameters<ReturnType<typeof getDb>["batch"]>[0][number];

/**
 * The writes that promote a deal on a signal: the new stage, when and why,
 * and a `deal.promoted` event. Empty when the signal changes nothing (already
 * in the Pipeline, won or lost), so callers can always spread it into their
 * batch. A booked call also moves an Interested deal on to Scope call.
 */
export function promotionWrites(
  deal: Pick<Deal, "id" | "workspaceId" | "company" | "stage" | "projectId">,
  signal: PromotionSignal,
  actorId: string,
  at: Date,
  extra: Record<string, unknown> = {},
): { stage: DealStage; writes: Write[] } {
  const to = deal.projectId ? null : promotionTarget(deal.stage, signal);
  if (!to) return { stage: deal.stage, writes: [] };
  const fromOutreach = deal.stage.startsWith("outreach_");
  return {
    stage: to,
    writes: [
      getDb()
        .update(deals)
        .set({ stage: to, stageChangedAt: at, ...(fromOutreach ? { promotedAt: at, promotedSignal: signal, closeReason: null, closeDetail: null } : {}) })
        .where(eq(deals.id, deal.id)),
      eventInsert({
        workspaceId: deal.workspaceId,
        projectId: deal.projectId,
        actorId,
        verb: fromOutreach ? "deal.promoted" : "deal.stage_changed",
        subjectType: "deal",
        subjectId: deal.id,
        payload: { company: deal.company, from: deal.stage, to, signal, ...extra },
      }),
    ],
  };
}
