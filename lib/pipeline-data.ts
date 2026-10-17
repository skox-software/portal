import { and, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { clients, deals, invoices, memberships, milestones, onboardings, projects, referrals } from "@/lib/db/schema";
import { buildBoard } from "@/lib/pipeline";

/**
 * Everything the Pipeline and the Clients list are built from, read once:
 * deals, projects with their invoices and milestones, referrals and the team.
 */
export async function loadPipeline(workspaceId: string) {
  const db = getDb();
  const ws = workspaceId;
  const [dealRows, projectRows, billing, progress, contacts, referralRows, staffRows, clientRows] = await Promise.all([
    db.select().from(deals).where(eq(deals.workspaceId, ws)).orderBy(desc(deals.stageChangedAt)),
    db
      .select({ project: projects, clientName: clients.name, onboardingContact: onboardings.contact, invitedEmail: onboardings.invitedEmail })
      .from(projects)
      .innerJoin(clients, eq(clients.id, projects.clientId))
      .leftJoin(onboardings, eq(onboardings.projectId, projects.id))
      .where(eq(projects.workspaceId, ws)),
    db
      .select({
        projectId: invoices.projectId,
        billed: sql<number>`coalesce(sum(${invoices.amountCents}), 0)::int`,
        count: sql<number>`count(*)::int`,
        unpaid: sql<number>`count(*) filter (where ${invoices.status} = 'open')::int`,
        openCents: sql<number>`coalesce(sum(${invoices.amountCents}) filter (where ${invoices.status} = 'open'), 0)::int`,
      })
      .from(invoices)
      .where(and(eq(invoices.workspaceId, ws), ne(invoices.status, "void")))
      .groupBy(invoices.projectId),
    db
      .select({
        projectId: milestones.projectId,
        done: sql<number>`count(*) filter (where ${milestones.state} = 'done')::int`,
        total: sql<number>`count(*)::int`,
      })
      .from(milestones)
      .where(eq(milestones.workspaceId, ws))
      .groupBy(milestones.projectId),
    db
      .select({ id: memberships.id, clientId: memberships.clientId, email: memberships.email, role: memberships.role })
      .from(memberships)
      .where(eq(memberships.workspaceId, ws))
      .orderBy(memberships.createdAt),
    db.select().from(referrals).where(eq(referrals.workspaceId, ws)),
    db
      .select({ email: memberships.email })
      .from(memberships)
      .where(and(eq(memberships.workspaceId, ws), isNull(memberships.clientId)))
      .orderBy(memberships.createdAt),
    db.select().from(clients).where(eq(clients.workspaceId, ws)),
  ]);

  const billingBy = new Map(billing.map((b) => [b.projectId, b]));
  const progressBy = new Map(progress.map((p) => [p.projectId, p]));
  const clientName = new Map(clientRows.map((c) => [c.id, c.name]));
  // The first approver is the main contact; members only when there's no approver.
  const contactBy = new Map<string, string>();
  for (const c of contacts) if (c.clientId && c.role === "client_approver" && !contactBy.has(c.clientId)) contactBy.set(c.clientId, c.email);
  for (const c of contacts) if (c.clientId && !contactBy.has(c.clientId)) contactBy.set(c.clientId, c.email);
  const membershipClient = new Map(contacts.map((c) => [c.id, c.clientId]));

  const { columns, lost } = buildBoard({
    deals: dealRows,
    projects: projectRows.map(({ project, clientName: name, onboardingContact, invitedEmail }) => {
      const email = contactBy.get(project.clientId) || invitedEmail || null;
      return {
        id: project.id,
        name: project.name,
        kind: project.kind,
        status: project.status,
        clientId: project.clientId,
        clientName: name,
        contact: onboardingContact?.name || email,
        contactName: onboardingContact?.name || null,
        contactEmail: email,
        deliveryDate: project.deliveryDate,
        dateTentative: project.dateTentative,
        launchedOn: project.launchedOn,
        createdAt: project.createdAt,
        billedCents: billingBy.get(project.id)?.billed ?? 0,
        invoiceCount: billingBy.get(project.id)?.count ?? 0,
        unpaidCount: billingBy.get(project.id)?.unpaid ?? 0,
        milestonesDone: progressBy.get(project.id)?.done ?? 0,
        milestonesTotal: progressBy.get(project.id)?.total ?? 0,
      };
    }),
    referrals: referralRows.map((r) => {
      const fromClient = r.referrerMembershipId ? membershipClient.get(r.referrerMembershipId) : null;
      return { ...r, referrerLabel: (fromClient && clientName.get(fromClient)) || r.referrerEmail?.split("@")[0] || null };
    }),
  });

  return {
    dealRows,
    projectRows,
    billing,
    clientRows,
    columns,
    lost,
    owners: staffRows.map((s) => s.email),
  };
}
