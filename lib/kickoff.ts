import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { milestones, projects } from "@/lib/db/schema";
import { sendEmail } from "@/lib/email";
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
}) {
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

  const link = portalLink(`/projects/${project.id}`);
  const [clientsTo, staffTo] = await Promise.all([
    clientRecipients(project.clientId, { actionRequired: true }),
    staffRecipients(project.workspaceId),
  ]);
  await Promise.allSettled([
    sendEmail(clientsTo, {
      subject: `We're building ${project.name}`,
      preheader: "Agreement signed, deposit received. Here's what happens next.",
      heading: "It's official. We're building.",
      paragraphs: [
        `Thank you. Your agreement is signed and your deposit is in, so ${project.name} is now in build.`,
        "Every week you'll get an update with what shipped, what's next and anything we need from you. Your first one lands within a week.",
      ],
      cta: { label: "Open your project", href: link },
    }),
    sendEmail(staffTo, {
      subject: `Deposit paid: ${project.name} is in build`,
      preheader: `Invoice ${invoice.number} paid; project moved to Building.`,
      heading: `${project.name} is go`,
      paragraphs: [`Deposit ${invoice.number} is paid. The project moved from Kickoff to Building and the client was emailed.`],
      cta: { label: "Manage the project", href: portalLink(`/admin/projects/${project.id}`) },
    }),
  ]);
  return true;
}
