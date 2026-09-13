import { and, eq, isNotNull, isNull, lt, lte, ne, or } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { clients, documents, documentSigners, invoices, onboardings, projects } from "@/lib/db/schema";
import { nextStep, progress, shouldRemind, stepsFor } from "@/lib/onboarding-flow";
import { agreementState, welcomeLink } from "@/lib/onboarding-server";
import { timingSafeEqual } from "node:crypto";
import { sendWeeklyDigests } from "@/lib/digest";
import { pruneRateEvents } from "@/lib/rate-limit";
import { sendEmail } from "@/lib/email";
import { formatDate, formatMoney, todayIso } from "@/lib/format";
import { clientRecipients, portalLink, staffRecipients } from "@/lib/notify";

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
      preheader: "It takes under a minute in your portal.",
      heading: `${doc.title} is waiting for your signature`,
      paragraphs: ["A friendly nudge from SKOX. It takes under a minute, right in your portal."],
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
        subject: o.status === "invited" ? `Your SKOX portal is ready for ${project.name}` : `Pick up your setup for ${project.name}`,
        preheader: `About ${left} minutes to go. It picks up right where you left off.`,
        heading: o.status === "invited" ? "Your portal is ready when you are" : `Next up: ${nextTitle}`,
        paragraphs: [
          o.status === "invited"
            ? `Everything for ${project.name} is set up and waiting in your portal.`
            : `You're making great progress on your setup for ${project.name}.`,
          `The next step takes about ${flow.find((s) => s.key === next)?.minutes ?? 2} minutes, and it saves as you go.`,
        ],
        cta: { label: o.status === "invited" ? "Open your portal" : "Pick up where you left off", href: welcomeLink(o.invitedEmail) },
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

  return Response.json({ ok: true, sent, digests });
}
