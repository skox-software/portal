import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { companyProposals, companyRuns } from "@/lib/db/schema";
import { runInput } from "@/lib/company";
import { companyServiceAuthorized, companyWorkspaceId } from "@/lib/company-service";

/** A seat logs one pass of work and sends up its cards. Cards always arrive pending. */
export async function POST(request: Request) {
  if (!companyServiceAuthorized(request)) return new Response("Unauthorized", { status: 401 });
  const ws = await companyWorkspaceId();
  if (!ws) return Response.json({ error: "No workspace." }, { status: 500 });
  const body = runInput.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: body.error.issues[0]?.message ?? "Invalid run." }, { status: 400 });
  const { seat, summary, outcome, proposals } = body.data;
  const db = getDb();
  const [run] = await db
    .insert(companyRuns)
    .values({ workspaceId: ws, seat, summary, outcome, proposalCount: proposals.length })
    .returning({ id: companyRuns.id });
  const created = proposals.length
    ? await db
        .insert(companyProposals)
        .values(proposals.map((p) => ({
          workspaceId: ws, seat, runId: run.id, kind: p.kind, title: p.title, why: p.why, body: p.body ?? null,
          impact: p.impact, confidence: p.confidence, wrongIf: p.wrongIf ?? null, links: p.links ?? null,
        })))
        .returning({ id: companyProposals.id })
    : [];
  revalidatePath("/admin/company");
  return Response.json({ runId: run.id, proposalIds: created.map((c) => c.id) }, { status: 201 });
}
