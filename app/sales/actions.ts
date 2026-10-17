"use server";
import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSalesTeam } from "@/lib/sales-access";
import { getDb } from "@/lib/db";
import { deals } from "@/lib/db/schema";
import { canChangeSalesDeal } from "@/lib/sales-permissions";
import { OUTCOMES, type Outcome, stageAfterCall } from "@/lib/follow-up";
import { backWith } from "@/lib/http";
const stages = z.enum(["lead", "initial_outreach", "follow_up_2", "follow_up_3", "persistent_follow_up", "proposal_sent", "negotiation", "won", "lost"]);
export async function updateSalesDeal(form: FormData) {
  const { viewer, member } = await requireSalesTeam();
  const parsed = z.object({ id: z.uuid(), stage: stages, outcome: z.union([z.literal(""), z.enum(OUTCOMES.map(o => o.value) as [Outcome, ...Outcome[]])]), note: z.string().trim().max(1000), nextStep: z.string().trim().max(200), nextStepOn: z.union([z.literal(""), z.iso.date()]) }).safeParse(Object.fromEntries(form));
  if (!parsed.success) backWith("/sales", "error", "Check the stage, note and follow-up date.");
  const data = parsed.data;
  const db = getDb();
  const [deal] = await db.select().from(deals).where(and(eq(deals.id, data.id), eq(deals.workspaceId, member.workspaceId))).limit(1);
  if (!deal || !canChangeSalesDeal(member, deal)) backWith("/sales", "error", "This lead is unavailable or has been handed to the build team.");
  const stage = data.outcome ? stageAfterCall(data.stage, data.outcome) : data.stage;
  // Re-check assignment and handoff in the update itself, not only the earlier read.
  const changed = await db.execute(sql`
    WITH changed AS (
      UPDATE deals SET stage = ${stage}::deal_stage,
        stage_changed_at = CASE WHEN stage <> ${stage}::deal_stage THEN now() ELSE stage_changed_at END,
        won_at = CASE WHEN ${stage} = 'won' THEN coalesce(won_at, now()) ELSE won_at END,
        last_contacted_at = CASE WHEN ${Boolean(data.outcome)} THEN now() ELSE last_contacted_at END,
        next_step = ${["won", "lost"].includes(stage) ? null : data.nextStep || null},
        next_step_on = ${["won", "lost"].includes(stage) ? null : data.nextStepOn || null}::date
      WHERE id = ${deal.id}::uuid AND workspace_id = ${member.workspaceId}::uuid AND project_id IS NULL
        AND (${member.role === "staff_owner"} OR (owner_email = ${member.email} AND stage <> 'won'))
      RETURNING id
    )
    INSERT INTO events (workspace_id, actor_id, verb, subject_type, subject_id, payload)
    SELECT ${member.workspaceId}::uuid, ${viewer.userId}, ${data.outcome ? "deal.call_logged" : "deal.stage_changed"},
      'deal', id::text, ${JSON.stringify({ company: deal.company, from: deal.stage, to: stage, outcome: data.outcome || undefined, note: data.note || undefined, handoff: stage === "won" })}::jsonb
    FROM changed RETURNING id
  `);
  if (!changed.rows.length) backWith("/sales", "error", "The lead changed ownership or was closed. Refresh your pipeline.");
  revalidatePath("/sales"); revalidatePath("/admin/pipeline"); revalidatePath("/admin/team"); revalidatePath("/admin");
  backWith("/sales", "notice", stage === "won" ? "Won — handed to Reiss and Josh for onboarding and build." : "Lead updated.");
}
