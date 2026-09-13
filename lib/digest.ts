import { and, desc, eq, gt, inArray, isNull, ne } from "drizzle-orm";
import { summarizeSince } from "@/lib/activity";
import { getDb } from "@/lib/db";
import { clients, documents, documentSigners, events, invoices, memberships, projects, tasks } from "@/lib/db/schema";
import { sendEmail } from "@/lib/email";
import { describeDaysUntil, daysUntil, formatDate } from "@/lib/format";
import { portalLink } from "@/lib/notify";

const WEEK = 7 * 86_400_000;

/**
 * The Friday recap: for every client person who wants updates, one email per
 * active project with what happened this week and what still needs them.
 * Skips projects with nothing new and nothing waiting, so it never feels spammy.
 */
export async function sendWeeklyDigests(now = new Date()) {
  const db = getDb();
  const since = new Date(now.getTime() - WEEK);
  const active = await db
    .select({ project: projects, clientName: clients.name })
    .from(projects)
    .innerJoin(clients, eq(clients.id, projects.clientId))
    .where(ne(projects.status, "paused"));
  let sent = 0;

  for (const { project, clientName } of active) {
    const [recent, people, openTasks, openInvoices] = await Promise.all([
      db.select().from(events).where(and(eq(events.projectId, project.id), gt(events.createdAt, since))).orderBy(desc(events.createdAt)).limit(60),
      db.select().from(memberships).where(and(eq(memberships.clientId, project.clientId), eq(memberships.emailUpdates, true))),
      db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.projectId, project.id), eq(tasks.side, "client"), isNull(tasks.doneAt))),
      db.select({ id: invoices.id }).from(invoices).where(and(eq(invoices.projectId, project.id), eq(invoices.status, "open"))),
    ]);
    if (people.length === 0) continue;
    const lines = summarizeSince(recent, 6).map((l) => `• ${l.text}`);

    for (const person of people) {
      const unsigned = await db
        .select({ id: documentSigners.id })
        .from(documentSigners)
        .innerJoin(documents, eq(documents.id, documentSigners.documentId))
        .where(
          and(
            eq(documents.projectId, project.id),
            eq(documents.status, "out_for_signature"),
            eq(documentSigners.email, person.email),
            inArray(documentSigners.status, ["pending", "viewed"]),
          ),
        );
      const waiting = openTasks.length + openInvoices.length + unsigned.length;
      if (lines.length === 0 && waiting === 0) continue;

      const launched = project.status === "launched";
      await sendEmail(person.email, {
        subject: `Your week with SKOX: ${project.name}`,
        preheader: waiting ? `${waiting} thing${waiting === 1 ? "" : "s"} waiting on you` : "Here's what moved this week.",
        heading: `${project.name}: this week`,
        paragraphs: [
          launched
            ? `${clientName}, here's your weekly recap.`
            : `Delivery ${formatDate(project.deliveryDate)} (${describeDaysUntil(daysUntil(project.deliveryDate)).toLowerCase()}).`,
          lines.length ? lines.join("\n") : "A quiet week on our side.",
          waiting
            ? `${waiting} thing${waiting === 1 ? " is" : "s are"} waiting on you in the portal.`
            : "Nothing is waiting on you. Enjoy the weekend.",
        ],
        cta: { label: waiting ? "See your to-do" : "Open your portal", href: portalLink(`/projects/${project.id}`) },
        footnote: "Change what we email you any time under Email preferences in the portal.",
      });
      sent++;
    }
  }
  return sent;
}
