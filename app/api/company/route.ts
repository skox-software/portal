import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { companyProposals, companyRuns } from "@/lib/db/schema";
import { SEATS } from "@/lib/company";
import { companyServiceAuthorized, companyWorkspaceId } from "@/lib/company-service";

/**
 * What a seat reads before it works: every seat's job, the cards Josh has
 * approved that are waiting to be carried out, the cards still waiting on
 * him (so nobody proposes the same thing twice), cards he sent back with what
 * to change, and his recent denials with reasons (so seats learn). `?seat=` narrows the cards to one seat.
 */
export async function GET(request: Request) {
  if (!companyServiceAuthorized(request)) return new Response("Unauthorized", { status: 401 });
  const ws = await companyWorkspaceId();
  if (!ws) return Response.json({ error: "No workspace." }, { status: 500 });
  const seat = new URL(request.url).searchParams.get("seat");
  const db = getDb();
  const bySeat = seat ? eq(companyProposals.seat, seat) : undefined;
  const cards = await db
    .select()
    .from(companyProposals)
    .where(and(eq(companyProposals.workspaceId, ws), inArray(companyProposals.status, ["pending", "approved", "denied", "revise"]), bySeat))
    .orderBy(desc(companyProposals.createdAt))
    .limit(200);
  const runs = await db.select().from(companyRuns).where(eq(companyRuns.workspaceId, ws)).orderBy(desc(companyRuns.createdAt)).limit(30);
  const shape = (c: typeof cards[number]) => ({
    id: c.id, seat: c.seat, kind: c.kind, title: c.title, why: c.why, body: c.body, impact: c.impact, confidence: c.confidence,
    status: c.status, decisionNote: c.decisionNote, decidedAt: c.decidedAt?.toISOString() ?? null, createdAt: c.createdAt.toISOString(),
  });
  return Response.json(
    {
      seats: SEATS,
      approved: cards.filter((c) => c.status === "approved").map(shape),
      pending: cards.filter((c) => c.status === "pending").map(shape),
      /** Sent back by Josh with what to change: redo it as a new card, then withdraw this one. */
      revise: cards.filter((c) => c.status === "revise").map(shape),
      denied: cards.filter((c) => c.status === "denied").slice(0, 30).map(shape),
      recentRuns: runs.map((r) => ({ seat: r.seat, summary: r.summary, outcome: r.outcome, at: r.createdAt.toISOString() })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
