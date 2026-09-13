import { and, count, eq, inArray, isNull, ne } from "drizzle-orm";
import { requireProjectAccess } from "@/lib/access";
import { getDb } from "@/lib/db";
import {
  approvals,
  documents,
  documentSigners,
  ideas,
  invoices,
  supportRequests,
  tasks,
} from "@/lib/db/schema";
import type { ProjectTab } from "@/components/ProjectNav";

/**
 * Everything a project page needs before its own content: access, plus the
 * "needs you" counts shown on the tabs. Counts are for the client's eyes;
 * staff see the same numbers so "what the client sees" stays honest.
 */
export async function loadProjectShell(projectId: string) {
  const ctx = await requireProjectAccess(projectId);
  const { project, viewer } = ctx;
  const db = getDb();

  const [[clientTasks], [toSign], [openInvoices], [waitingRequests], [pendingApprovals], [newIdeas]] =
    await Promise.all([
      db
        .select({ n: count() })
        .from(tasks)
        .where(and(eq(tasks.projectId, project.id), eq(tasks.side, "client"), isNull(tasks.doneAt))),
      db
        .select({ n: count() })
        .from(documentSigners)
        .innerJoin(documents, eq(documents.id, documentSigners.documentId))
        .where(
          and(
            eq(documents.projectId, project.id),
            eq(documents.status, "out_for_signature"),
            eq(documentSigners.email, viewer.email),
            ne(documentSigners.status, "signed"),
          ),
        ),
      db
        .select({ n: count() })
        .from(invoices)
        .where(and(eq(invoices.projectId, project.id), eq(invoices.status, "open"))),
      db
        .select({ n: count() })
        .from(supportRequests)
        .where(and(eq(supportRequests.projectId, project.id), eq(supportRequests.status, "waiting_on_client"))),
      db
        .select({ n: count() })
        .from(approvals)
        .where(and(eq(approvals.projectId, project.id), eq(approvals.state, "requested"))),
      db
        .select({ n: count() })
        .from(ideas)
        .where(and(eq(ideas.projectId, project.id), inArray(ideas.status, ["proposed"]))),
    ]);

  const counts: Partial<Record<ProjectTab, number>> = {
    home: Number(clientTasks?.n ?? 0),
    documents: Number(toSign?.n ?? 0),
    billing: Number(openInvoices?.n ?? 0),
    support: Number(waitingRequests?.n ?? 0),
    review: ctx.access.clientRole === "client_approver" || ctx.access.isStaff ? Number(pendingApprovals?.n ?? 0) : 0,
    results: Number(newIdeas?.n ?? 0),
  };

  return { ...ctx, counts };
}

export type ProjectShell = Awaited<ReturnType<typeof loadProjectShell>>;
