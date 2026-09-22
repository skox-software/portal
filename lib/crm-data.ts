import { and, count, eq, inArray, isNull, max, sql } from "drizzle-orm";
import { daysInStage, isStalled, type DealStage } from "@/lib/crm";
import { getDb } from "@/lib/db";
import { clients, contacts, crmActivities, deals, emailThreads, invoices, memberships, milestones, projects } from "@/lib/db/schema";

/**
 * Everything a deal card or clients-table row shows, in a fixed number of
 * queries however many deals there are.
 */
export type DealRow = {
  id: string;
  title: string;
  kind: string | null;
  stage: DealStage;
  valueCents: number;
  days: number;
  stalled: boolean;
  ownerEmail: string | null;
  lostReason: string | null;
  client: { id: string; name: string; industry: string | null; location: string | null; source: string | null };
  contact: { name: string; email: string | null } | null;
  project: { id: string; deliveryDate: string; launchedOn: string | null } | null;
  milestones: { done: number; total: number };
  invoice: "paid" | "open" | null;
  shippedAt: Date | null;
  lastTouch: Date | null;
};

export async function loadDeals(workspaceId: string): Promise<DealRow[]> {
  const db = getDb();
  const rows = await db
    .select({ deal: deals, client: clients, project: projects })
    .from(deals)
    .innerJoin(clients, eq(clients.id, deals.clientId))
    .leftJoin(projects, eq(projects.id, deals.projectId))
    .where(eq(deals.workspaceId, workspaceId));
  if (rows.length === 0) return [];

  const projectIds = [...new Set(rows.flatMap((r) => (r.project ? [r.project.id] : [])))];
  const clientIds = [...new Set(rows.map((r) => r.client.id))];

  const [primaries, progress, bills, touches] = await Promise.all([
    db
      .select({ clientId: contacts.clientId, name: contacts.name, email: contacts.email })
      .from(contacts)
      .where(and(eq(contacts.workspaceId, workspaceId), eq(contacts.isPrimary, true))),
    projectIds.length
      ? db
          .select({
            projectId: milestones.projectId,
            total: count(),
            done: sql<number>`count(*) filter (where ${milestones.state} = 'done')`.mapWith(Number),
          })
          .from(milestones)
          .where(inArray(milestones.projectId, projectIds))
          .groupBy(milestones.projectId)
      : [],
    projectIds.length
      ? db
          .select({ projectId: invoices.projectId, status: invoices.status })
          .from(invoices)
          .where(and(inArray(invoices.projectId, projectIds), inArray(invoices.status, ["open", "paid"])))
      : [],
    db
      .select({ clientId: crmActivities.clientId, last: max(crmActivities.createdAt) })
      .from(crmActivities)
      .where(inArray(crmActivities.clientId, clientIds))
      .groupBy(crmActivities.clientId),
  ]);

  const primaryBy = new Map(primaries.map((c) => [c.clientId, c]));
  const progressBy = new Map(progress.map((p) => [p.projectId, p]));
  const touchBy = new Map(touches.map((t) => [t.clientId, t.last]));
  const billBy = new Map<string, "paid" | "open">();
  for (const b of bills) {
    // Anything still open wins: "paid" only once nothing is outstanding.
    if (b.status === "open" || !billBy.has(b.projectId)) billBy.set(b.projectId, b.status as "paid" | "open");
  }

  const now = Date.now();
  return rows.map(({ deal, client, project }) => {
    const days = daysInStage(deal.stageEnteredAt, now);
    const p = project ? progressBy.get(project.id) : undefined;
    const contact = primaryBy.get(client.id);
    return {
      id: deal.id,
      title: deal.title,
      kind: deal.kind,
      stage: deal.stage,
      valueCents: deal.valueCents,
      days,
      stalled: isStalled(deal.stage, days),
      ownerEmail: deal.ownerEmail,
      lostReason: deal.lostReason,
      client: { id: client.id, name: client.name, industry: client.industry, location: client.location, source: client.source },
      contact: contact ? { name: contact.name, email: contact.email } : null,
      project: project ? { id: project.id, deliveryDate: project.deliveryDate, launchedOn: project.launchedOn } : null,
      milestones: { done: p?.done ?? 0, total: Number(p?.total ?? 0) },
      invoice: project ? (billBy.get(project.id) ?? null) : null,
      shippedAt: deal.shippedAt,
      lastTouch: touchBy.get(client.id) ?? null,
    };
  });
}

/** Unassigned inbox threads: the queue the pipeline page nags about. */
export async function unassignedThreadCount(workspaceId: string) {
  const [row] = await getDb()
    .select({ n: count() })
    .from(emailThreads)
    .where(and(eq(emailThreads.workspaceId, workspaceId), isNull(emailThreads.clientId), eq(emailThreads.archived, false)));
  return Number(row?.n ?? 0);
}

/** SKOX team members who have signed in, for the deal owner menu. */
export async function staffList(workspaceId: string) {
  const rows = await getDb()
    .select({ userId: memberships.userId, email: memberships.email })
    .from(memberships)
    .where(and(eq(memberships.workspaceId, workspaceId), isNull(memberships.clientId)));
  return rows.filter((r): r is { userId: string; email: string } => Boolean(r.userId));
}

/** Clients for pickers, alphabetical. */
export async function clientOptions(workspaceId: string) {
  return getDb()
    .select({ id: clients.id, name: clients.name })
    .from(clients)
    .where(eq(clients.workspaceId, workspaceId))
    .orderBy(clients.name);
}
