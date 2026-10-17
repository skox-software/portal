import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { clients, milestones, projects } from "@/lib/db/schema";
import { sendEmail, type EmailContent } from "@/lib/email";
import { eventInsert } from "@/lib/events";
import { clientRecipients, portalLink, staffRecipients } from "@/lib/notify";

/**
 * When a deposit tied to an agreement is paid, the project is officially
 * under way: status moves from Kickoff to Building and the kickoff milestone
 * is ticked. Used by staff "mark paid" and by the Stripe webhook.
 */
export async function afterInvoicePaid(invoice: {
  id: string;
  projectId: string;
  documentId: string | null;
  number: string;
}, paymentDetails?: EmailContent["details"]) {
  if (!invoice.documentId) return false;
  const db = getDb();
  const [project] = await db.select().from(projects).where(eq(projects.id, invoice.projectId)).limit(1);
  if (!project || project.status !== "kickoff") return false;

  // Claim the transition first so a webhook and a staff click can't both announce it.
  const [moved] = await db
    .update(projects)
    .set({ status: "building" })
    .where(and(eq(projects.id, project.id), eq(projects.status, "kickoff")))
    .returning({ id: projects.id });
  if (!moved) return false;
  await db.batch([
    db
      .update(milestones)
      .set({ state: "done" })
      .where(and(eq(milestones.projectId, project.id), eq(milestones.kind, "kickoff"))),
    eventInsert({
      workspaceId: project.workspaceId,
      projectId: project.id,
      actorId: "system",
      verb: "project.status_changed",
      subjectType: "project",
      subjectId: project.id,
      payload: { from: "kickoff", to: "building", reason: `deposit ${invoice.number} paid` },
    }),
  ]);

  const [company] = await db.select({ name: clients.name }).from(clients).where(eq(clients.id, project.clientId)).limit(1);
  const companyName = company?.name ?? "Company unavailable";
  const link = portalLink(`/projects/${project.id}`);
  const [clientsTo, staffTo] = await Promise.all([
    clientRecipients(project.clientId, { actionRequired: true }),
    staffRecipients(project.workspaceId),
  ]);
  await Promise.allSettled([
    sendEmail(clientsTo, {
      subject: `We're building ${project.name}`,
      preheader: "Agreement signed, deposit received. Here's what happens next.",
      heading: "Your project is underway",
      paragraphs: [
        `Thank you. We have received your signed agreement and deposit, and work on ${project.name} is now underway.`,
        "You will receive a weekly progress update covering completed work, next steps and any information we need from you. Your first update will arrive within one week.",
      ],
      cta: { label: "Open your project", href: link },
    }),
    sendEmail(staffTo, {
      subject: `Project underway: ${companyName} · ${project.name}`,
      details: paymentDetails ?? [{ label: "Company", value: companyName }, { label: "Project", value: project.name }],
      preheader: `Invoice ${invoice.number} paid; project moved to Building.`,
      heading: `${project.name} is ready for delivery work`,
      paragraphs: [`Deposit invoice ${invoice.number} is paid. The project status has changed from Kickoff to Building.`],
      cta: { label: "Manage the project", href: portalLink(`/admin/projects/${project.id}`) },
    }),
  ]);
  return true;
}
