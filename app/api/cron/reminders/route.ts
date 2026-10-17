import { and, eq, isNotNull, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { clients, documents, documentSigners, invoices, onboardings, projects } from "@/lib/db/schema";
import { nextStep, progress, shouldRemind, stepsFor } from "@/lib/onboarding-flow";
import { agreementState, welcomeLink } from "@/lib/onboarding-server";
import { timingSafeEqual } from "node:crypto";
import { sendWeeklyDigests } from "@/lib/digest";
import { previousMonth, periodLabel } from "@/lib/commission-math";
import { describeFollowUp, remindersByPerson, salesToday } from "@/lib/follow-up";
import { dueFollowUps } from "@/lib/follow-up-data";
import { staffOf } from "@/lib/staff-filter";
import { eventInsert } from "@/lib/events";
import { events, memberships, workspaces } from "@/lib/db/schema";
import { draftStatements } from "@/lib/statements";
import { repProfiles } from "@/lib/db/schema";
import { pruneRateEvents } from "@/lib/rate-limit";
import { sendEmail } from "@/lib/email";
import { formatDate, formatMoney, todayIso } from "@/lib/format";
import { clientRecipients, ownerRecipients, portalLink, staffRecipients } from "@/lib/notify";

/**
 * Daily nudges, so nothing sits waiting: unsigned documents (every 3 days)
 * and invoices due soon or overdue (every 4 days). Vercel Cron calls this
 * with the CRON_SECRET bearer token.
 */
export const maxDuration = 60;

const DAY = 86_400_000;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret ?? ""}`);
  if (!secret || given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return new Response("Unauthorized", { status: 401 });
  }
  await pruneRateEvents().catch(() => {});
  const db = getDb();
  const now = new Date();
  let sent = 0;

  const signerDue = new Date(now.getTime() - 3 * DAY);
  // Onboarding attaches the agreement and deposit quietly; nothing nudges anyone until the welcome is out.
  const welcomed = or(isNull(onboardings.id), isNotNull(onboardings.welcomeSentAt));
  const pendingSigners = await db
    .select({ signer: documentSigners, doc: documents })
    .from(documentSigners)
    .innerJoin(documents, eq(documents.id, documentSigners.documentId))
    .leftJoin(onboardings, eq(onboardings.projectId, documents.projectId))
    .where(
      and(
        welcomed,
        eq(documents.status, "out_for_signature"),
        ne(documentSigners.status, "signed"),
        lt(documentSigners.createdAt, signerDue),
        or(isNull(documentSigners.lastRemindedAt), lt(documentSigners.lastRemindedAt, signerDue)),
      ),
    )
    .limit(200);
  for (const { signer, doc } of pendingSigners) {
    await sendEmail(signer.email, {
      subject: `Reminder: please sign ${doc.title}`,
      preheader: "Please review and sign your document in the client portal.",
      heading: `${doc.title} is waiting for your signature`,
      paragraphs: ["This is a reminder that your document is ready for review and signature. Please contact us if you have any questions before signing."],
      cta: { label: "Review and sign", href: portalLink(`/projects/${doc.projectId}/documents/${doc.id}`) },
    });
    await db.update(documentSigners).set({ lastRemindedAt: now }).where(eq(documentSigners.id, signer.id));
    sent++;
  }

  const soon = new Date(now.getTime() + 3 * DAY).toISOString().slice(0, 10);
  const invoiceDue = new Date(now.getTime() - 4 * DAY);
  const dueInvoices = await db
    .select({ invoice: invoices, project: projects })
    .from(invoices)
    .innerJoin(projects, eq(projects.id, invoices.projectId))
    .leftJoin(onboardings, eq(onboardings.projectId, invoices.projectId))
    .leftJoin(documents, eq(documents.id, invoices.documentId))
    .where(
      and(
        welcomed,
        // A deposit stays locked (and unmentioned) until its agreement is signed.
        or(isNull(invoices.documentId), eq(documents.status, "completed")),
        eq(invoices.status, "open"),
        lte(invoices.dueOn, soon),
        or(isNull(invoices.lastRemindedAt), lt(invoices.lastRemindedAt, invoiceDue)),
      ),
    )
    .limit(200);
  const today = todayIso(now);
  for (const { invoice, project } of dueInvoices) {
    const overdue = invoice.dueOn < today;
    const to = await clientRecipients(project.clientId, { approversOnly: true, actionRequired: true });
    await sendEmail(to, {
      subject: `${overdue ? "Overdue" : "Due soon"}: invoice ${invoice.number} (${formatMoney(invoice.amountCents, invoice.currency)})`,
      preheader: `${invoice.title} · due ${formatDate(invoice.dueOn)}`,
      heading: overdue ? `Invoice ${invoice.number} is overdue` : `Invoice ${invoice.number} is due ${formatDate(invoice.dueOn)}`,
      paragraphs: [`${invoice.title} for ${project.name}: ${formatMoney(invoice.amountCents, invoice.currency)}.`],
      cta: { label: invoice.payUrl ? "Pay now" : "View invoice", href: portalLink(`/projects/${project.id}/billing`) },
    });
    await db.update(invoices).set({ lastRemindedAt: now }).where(eq(invoices.id, invoice.id));
    sent++;
  }

  // Onboarding: a gentle nudge toward the next step (never "are you still interested?"),
  // and a heads-up to SKOX when someone has been paused for five days.
  const openOnboardings = await db
    .select({ onboarding: onboardings, project: projects, client: clients })
    .from(onboardings)
    .innerJoin(projects, eq(projects.id, onboardings.projectId))
    .innerJoin(clients, eq(clients.id, projects.clientId))
    .where(and(ne(onboardings.status, "completed"), isNotNull(onboardings.welcomeSentAt)))
    .limit(200);
  for (const { onboarding: o, project, client } of openOnboardings) {
    const since = o.lastActivityAt ?? o.welcomeSentAt ?? o.createdAt;
    if (shouldRemind({ ...o, lastActivityAt: since }, now)) {
      const agreement = await agreementState(project.id, project.status);
      const flow = stepsFor({ hasAgreement: agreement.hasAgreement });
      const next = nextStep(o.steps, flow);
      const nextTitle = flow.find((s) => s.key === next)?.title ?? "your setup";
      const left = progress(o.steps, flow).minutesLeft;
      await sendEmail(o.invitedEmail, {
        subject: o.status === "invited" ? `Your SKOX portal is ready for ${project.name}` : `Complete your project setup: ${project.name}`,
        preheader: `Approximately ${left} minutes remain. Your previous progress has been saved.`,
        heading: o.status === "invited" ? "Your portal is ready when you are" : `Next up: ${nextTitle}`,
        paragraphs: [
          o.status === "invited"
            ? `Everything for ${project.name} is set up and waiting in your portal.`
            : `You're making great progress on your setup for ${project.name}.`,
          `The next step takes about ${flow.find((s) => s.key === next)?.minutes ?? 2} minutes, and it saves as you go.`,
        ],
        cta: { label: o.status === "invited" ? "Open your portal" : "Continue project setup", href: welcomeLink(o.invitedEmail) },
      });
      await db
        .update(onboardings)
        .set({ lastRemindedAt: now, remindersSent: o.remindersSent + 1 })
        .where(eq(onboardings.id, o.id));
      sent++;
    }
    const idle = Math.floor((now.getTime() - since.getTime()) / DAY);
    if (idle >= 5 && !o.staffAlertedAt) {
      const staff = await staffRecipients(o.workspaceId);
      await sendEmail(staff, {
        subject: `${client.name} paused onboarding ${idle} days ago`,
        preheader: "A personal note or quick call usually gets things moving.",
        heading: `${client.name} could use a personal nudge`,
        paragraphs: [
          `${o.invitedEmail} hasn't touched their setup for ${project.name} in ${idle} days (${o.remindersSent} automatic reminder(s) sent).`,
          "A short personal message or a quick call works better than another automated email.",
        ],
        cta: { label: "Open onboarding", href: portalLink("/admin/onboard") },
      });
      await db.update(onboardings).set({ staffAlertedAt: now }).where(eq(onboardings.id, o.id));
      sent++;
    }
  }

  // Fridays (UTC): the weekly recap. Hobby cron runs once a day, so it rides along here.
  const digests = now.getUTCDay() === 5 || new URL(request.url).searchParams.get("digest") === "force" ? await sendWeeklyDigests(now) : 0;

  // Commission statements for last month. Runs every day but only drafts what's missing,
  // so a skipped cron on the 1st catches up the next day.
  let statements = 0;
  const period = previousMonth(salesToday(now));
  const repWorkspaces = await db.selectDistinct({ ws: repProfiles.workspaceId }).from(repProfiles);
  for (const { ws } of repWorkspaces) {
    try {
      const drafted = await draftStatements(ws, period);
      statements += drafted.length;
      if (drafted.length) {
        await sendEmail(await ownerRecipients(ws), {
          subject: `${drafted.length} commission statement${drafted.length === 1 ? "" : "s"} to approve`,
          preheader: `${periodLabel(period.start)} closed.`,
          heading: `${periodLabel(period.start)} is ready to approve`,
          paragraphs: [`${drafted.length} sales rep statement${drafted.length === 1 ? " is" : "s are"} waiting for your approval. Check the lines, approve, pay, then mark each one paid.`],
          cta: { label: "Review statements", href: portalLink("/admin/commissions") },
        });
      }
    } catch (error) {
      console.error("[cron] statements failed", { ws, error });
    }
  }

  // Follow-ups due today or overdue: one email per person, once a day.
  let followUps = 0;
  try {
    followUps = await sendFollowUpReminders(now);
  } catch (error) {
    console.error("[cron] follow-up reminders failed", error);
  }

  return Response.json({ ok: true, sent, digests, statements, followUps });
}

/**
 * The morning reminder: each person gets one email listing the leads and
 * clients they said they'd get back to, due today or overdue. Unowned ones go
 * to the whole team. A `follow_up.reminded` event per person per day stops a
 * second email if the cron runs twice.
 */
async function sendFollowUpReminders(now: Date) {
  const db = getDb();
  const today = salesToday(now);
  let sent = 0;
  for (const { id: ws } of await db.select({ id: workspaces.id }).from(workspaces)) {
    const due = await dueFollowUps(ws, today);
    if (!due.length) continue;
    const team = (await db.select({ email: memberships.email }).from(memberships).where(staffOf(ws))).map((m) => m.email.toLowerCase());
    const already = new Set(
      (
        await db
          .select({ who: events.subjectId })
          .from(events)
          .where(and(eq(events.workspaceId, ws), eq(events.verb, "follow_up.reminded"), sql`${events.payload}->>'date' = ${today}`))
      ).map((e) => e.who),
    );
    for (const [email, items] of remindersByPerson(due, team)) {
      if (already.has(email)) continue;
      const overdue = items.filter((i) => i.dueOn < today).length;
      const shown = items.slice(0, 25);
      await sendEmail(email, {
        subject: `${items.length} follow-up${items.length === 1 ? "" : "s"} today${overdue ? ` (${overdue} overdue)` : ""}`,
        preheader: shown.slice(0, 3).map((i) => i.name).join(", ") + (items.length > 3 ? "…" : ""),
        heading: items.length === 1 ? `Reach back out to ${items[0].name}` : `${items.length} people to reach back out to`,
        paragraphs: [
          "These are the leads and clients you set a reminder for. Open one to call or email, then mark it done or move it to another day.",
          ...(items.length > shown.length ? [`Showing the first ${shown.length}; the rest are on the Clients page under Due today.`] : []),
        ],
        details: shown.map((i) => ({ label: i.name, value: [describeFollowUp(i.dueOn, today), i.note].filter(Boolean).join(" · ") })),
        cta: { label: "Open today's follow-ups", href: portalLink("/admin/clients?view=due") },
      });
      await eventInsert({ workspaceId: ws, actorId: "system", verb: "follow_up.reminded", subjectType: "membership", subjectId: email, payload: { date: today, count: items.length } });
      sent++;
    }
  }
  return sent;
}
