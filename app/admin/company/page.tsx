import type { Metadata } from "next";
import { and, desc, eq, gte, inArray, or } from "drizzle-orm";
import { requireStaff } from "@/lib/access";
import { getDb } from "@/lib/db";
import { companyProposals, companyRuns } from "@/lib/db/schema";
import { SEATS, inboxOrder, medianHoursToDecide } from "@/lib/company";
import { CompanyBoard, type CardView } from "@/components/company/CompanyBoard";
import "./company.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Company" };

/**
 * The company: every seat, what it's doing, and the cards waiting for Josh's
 * yes or no. Seats are defined in lib/company.ts; this page reads their runs
 * and proposals.
 */
export default async function CompanyPage() {
  const { staff } = await requireStaff();
  const ws = staff.workspaceId;
  const db = getDb();
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
  const monthAgo = new Date(now.getTime() - 30 * 86_400_000);

  const [rows, runs] = await Promise.all([
    db
      .select()
      .from(companyProposals)
      .where(and(eq(companyProposals.workspaceId, ws), or(inArray(companyProposals.status, ["pending", "approved"]), gte(companyProposals.createdAt, monthAgo))))
      .orderBy(desc(companyProposals.createdAt))
      .limit(300),
    db.select().from(companyRuns).where(and(eq(companyRuns.workspaceId, ws), gte(companyRuns.createdAt, monthAgo))).orderBy(desc(companyRuns.createdAt)).limit(500),
  ]);

  const pending = inboxOrder(rows.filter((r) => r.status === "pending"));
  const rest = rows.filter((r) => r.status !== "pending").sort((a, b) => (b.decidedAt ?? b.createdAt).getTime() - (a.decidedAt ?? a.createdAt).getTime());
  const decidedMonth = rows.filter((r) => r.decidedAt && r.decidedAt >= monthAgo);
  const approvedMonth = decidedMonth.filter((r) => r.status === "approved" || r.status === "done");

  const cards: CardView[] = [...pending, ...rest].map((r) => ({
    id: r.id, seat: r.seat, kind: r.kind, title: r.title, why: r.why, body: r.body, impact: r.impact, confidence: r.confidence,
    wrongIf: r.wrongIf, links: r.links ?? null, status: r.status, createdAt: r.createdAt.toISOString(),
    decidedAt: r.decidedAt?.toISOString() ?? null, decisionNote: r.decisionNote, edited: r.edited,
  }));

  return (
    <main className="shell page">
      <div className="page-head">
        <div>
          <p className="eyebrow">The company</p>
          <h1>Who&rsquo;s working, and what needs your yes</h1>
          <p className="muted">Every seat works on its own inside its lane. Anything that leaves the building comes to you first.</p>
        </div>
      </div>
      <CompanyBoard
        now={now.toISOString()}
        cards={cards}
        runs={runs.map((r) => ({ seat: r.seat, at: r.createdAt.toISOString(), summary: r.summary, outcome: r.outcome }))}
        score={{
          waiting: pending.length,
          medianHours: medianHoursToDecide(decidedMonth),
          approvedWeek: rows.filter((r) => r.decidedAt && r.decidedAt >= weekAgo && (r.status === "approved" || r.status === "done")).length,
          deniedWeek: rows.filter((r) => r.decidedAt && r.decidedAt >= weekAgo && r.status === "denied").length,
          editRate: approvedMonth.length ? approvedMonth.filter((r) => r.edited).length / approvedMonth.length : null,
          runsWeek: runs.filter((r) => r.createdAt >= weekAgo).length,
          liveSeats: SEATS.filter((s) => s.status === "live" && s.title !== "Department" && s.key !== "josh").length,
        }}
      />
    </main>
  );
}
