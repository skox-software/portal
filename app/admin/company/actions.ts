"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaff } from "@/lib/access";
import { getDb } from "@/lib/db";
import { companyProposals } from "@/lib/db/schema";
import { eventInsert } from "@/lib/events";
import { ownerDecision, type ProposalStatus } from "@/lib/company";

export type DecideResult = { ok: true; status: ProposalStatus } | { ok: false; error: string };

const input = z.object({
  id: z.uuid(),
  decision: z.enum(["approve", "deny", "revise"]),
  note: z.string().trim().max(1000).optional(),
  /** The draft as Josh left it; only kept on approve, and only if he changed it. */
  body: z.string().max(20_000).optional(),
});

/**
 * Josh's approve or deny on a card. Only staff can call it, only a pending
 * card can be decided, and the update is guarded on "still pending" so two
 * open tabs can't decide the same card twice. Approving changes nothing in
 * the world by itself: the seat carries it out on its next run and marks it done.
 */
export async function decideProposal(raw: z.input<typeof input>): Promise<DecideResult> {
  const { viewer, staff } = await requireStaff();
  const parsed = input.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "That card couldn't be read." };
  const { id, decision, note, body } = parsed.data;
  if (decision === "deny" && !note) return { ok: false, error: "Say why in a few words, so the seat learns." };
  if (decision === "revise" && !note) return { ok: false, error: "Say what to change, so the seat can redo it." };
  const db = getDb();
  const [card] = await db.select().from(companyProposals).where(and(eq(companyProposals.id, id), eq(companyProposals.workspaceId, staff.workspaceId)));
  if (!card) return { ok: false, error: "That card is gone." };
  const next = ownerDecision(card.status as ProposalStatus, decision);
  if (typeof next === "object") return { ok: false, error: next.error };
  const edited = decision === "approve" && body !== undefined && body.trim() !== (card.body ?? "").trim();
  const [saved] = await db
    .update(companyProposals)
    .set({
      status: next,
      decidedBy: viewer.email,
      decidedAt: new Date(),
      decisionNote: note || null,
      ...(edited ? { body, edited: true } : {}),
    })
    .where(and(eq(companyProposals.id, id), eq(companyProposals.status, "pending")))
    .returning({ status: companyProposals.status });
  if (!saved) return { ok: false, error: "Someone decided this card a moment ago." };
  await eventInsert({
    workspaceId: staff.workspaceId,
    actorId: viewer.userId,
    verb: decision === "approve" ? "company.approved" : decision === "deny" ? "company.denied" : "company.revise",
    subjectType: "company_proposal",
    subjectId: id,
    payload: { seat: card.seat, title: card.title, edited },
  });
  revalidatePath("/admin/company");
  return { ok: true, status: saved.status as ProposalStatus };
}
