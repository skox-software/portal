import { and, desc, eq, gt, inArray, isNull, ne } from "drizzle-orm";
import { summarizeSince } from "@/lib/activity";
import { getDb } from "@/lib/db";
import { clients, documents, documentSigners, events, invoices, memberships, onboardings, projects, tasks } from "@/lib/db/schema";
import { sendEmail } from "@/lib/email";
import { describeDaysUntil, daysUntil, formatDate } from "@/lib/format";
import { portalLink } from "@/lib/notify";

const WEEK = 7 * 86_400_000;

/**
 * The Friday recap: for every client person who wants updates, one email per
 * active project with what happened this week and what still needs them.
 * Skips projects with nothing new and nothing waiting, so it never feels spammy.
 * Safe to run twice in a week: each send is recorded as a digest.sent event.
 */
export async function sendWeeklyDigests(now = new Date()) {
  const db = getDb();
  const since = new Date(now.getTime() - WEEK);
  const [active, unwelcomedRows, sentRows] = await Promise.all([
    db
      .select({ project: projects, clientName: clients.name })
      .from(projects)
      .innerJoin(clients, eq(clients.id, projects.clientId))
      .where(ne(projects.status, "paused")),
    // Nobody hears from us about a project before its welcome goes out.
    db.select({ projectId: onboardings.projectId }).from(onboardings).where(isNull(onboardings.welcomeSentAt)),
    db
      .select({ projectId: events.projectId, subjectId: events.subjectId })
      .from(events)
      .where(and(eq(events.verb, "digest.sent"), gt(events.createdAt, new Date(now.getTime() - 6 * 86_400_000)))),
  ]);
  const unwelcomed = new Set(unwelcomedRows.map((r) => r.projectId));
  const alreadySent = new Set(sentRows.map((r) => `${r.projectId}:${r.subjectId}`));
  let sent = 0;

  for (const { project, clientName } of active) {
    if (unwelcomed.has(project.id)) continue;
    const [recent, people, openTasks, openInvoices] = await Promise.all([
      db.select().from(events).where(and(eq(events.projectId, project.id), gt(events.createdAt, since))).orderBy(desc(events.createdAt)).limit(60),
      db.select().from(memberships).where(and(eq(memberships.clientId, project.clientId), eq(memberships.emailUpdates, true))),
      db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.projectId, project.id), eq(tasks.side, "client"), isNull(tasks.doneAt))),
      db.select({ id: invoices.id }).from(invoices).where(and(eq(invoices.projectId, project.id), eq(invoices.status, "open"))),
    ]);
    if (people.length === 0) continue;
    const lines = summarizeSince(recent.filter((e) => e.verb !== "digest.sent"), 6).map((l) => `• ${l.text}`);

    for (const person of people) {
      if (alreadySent.has(`${project.id}:${person.id}`)) continue;
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
      const days = daysUntil(project.deliveryDate);
      const opener =
        launched || project.dateTentative || days < 0
          ? `${clientName}, here's your weekly recap.`
          : `Launch date ${formatDate(project.deliveryDate)} (${describeDaysUntil(days).toLowerCase()}).`;
      await sendEmail(person.email, {
        subject: `Your week with SKOX: ${project.name}`,
        preheader: waiting ? `${waiting} thing${waiting === 1 ? "" : "s"} waiting on you` : "Here's what moved this week.",
        heading: `${project.name}: this week`,
        paragraphs: [
          opener,
          lines.length ? lines.join("\n") : "Here's where things stand.",
          waiting
            ? `${waiting} thing${waiting === 1 ? " is" : "s are"} waiting on you in the portal.`
            : "Nothing is waiting on you. Enjoy the weekend.",
        ],
        cta: { label: waiting ? "See your to-do" : "Open your portal", href: portalLink(`/projects/${project.id}`) },
        footnote: "Change what we email you any time under Email preferences in the portal.",
      });
      await db.insert(events).values({
        workspaceId: project.workspaceId,
        projectId: project.id,
        actorId: "system",
        verb: "digest.sent",
        subjectType: "membership",
        subjectId: person.id,
        payload: {},
      });
      sent++;
    }
  }
  return sent;
}
