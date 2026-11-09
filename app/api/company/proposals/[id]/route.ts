import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { companyProposals } from "@/lib/db/schema";
import { serviceProposalTransition, type ProposalStatus } from "@/lib/company";
import { companyServiceAuthorized, companyWorkspaceId } from "@/lib/company-service";

const update = z.object({ status: z.enum(["done", "withdrawn"]), note: z.string().trim().max(1000).optional() }).strict();

/** A seat reports an approved card carried out, or withdraws one still pending. It can't approve or deny. */
export async function PATCH(request: Request, ctx: RouteContext<"/api/company/proposals/[id]">) {
  if (!companyServiceAuthorized(request)) return new Response("Unauthorized", { status: 401 });
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return Response.json({ error: "Unknown card." }, { status: 404 });
  const body = update.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: body.error.issues[0]?.message ?? "Invalid update." }, { status: 400 });
  const ws = await companyWorkspaceId();
  if (!ws) return Response.json({ error: "No workspace." }, { status: 500 });
  const db = getDb();
  const [card] = await db.select().from(companyProposals).where(and(eq(companyProposals.id, id), eq(companyProposals.workspaceId, ws)));
  if (!card) return Response.json({ error: "Unknown card." }, { status: 404 });
  const next = serviceProposalTransition(card.status as ProposalStatus, body.data.status);
  if (typeof next === "object") return Response.json(next, { status: 409 });
  // Guard on the status we read, so a decision Josh makes meanwhile isn't overwritten.
  const [saved] = await db
    .update(companyProposals)
    .set(next === "done" ? { status: next, doneAt: new Date(), doneNote: body.data.note ?? null } : { status: next, doneNote: body.data.note ?? null })
    .where(and(eq(companyProposals.id, id), eq(companyProposals.status, card.status)))
    .returning({ status: companyProposals.status });
  if (!saved) return Response.json({ error: "The card changed; read it again." }, { status: 409 });
  revalidatePath("/admin/company");
  return Response.json({ status: saved.status });
}
