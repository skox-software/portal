import { and, eq, gte, inArray, isNull, lt, lte, ne, or } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { documents, documentSigners, invoices, projects } from "@/lib/db/schema";
import { sendWeeklyDigests } from "@/lib/digest";
import { sendEmail } from "@/lib/email";
import { formatDate, formatMoney, todayIso } from "@/lib/format";
import { clientRecipients, portalLink } from "@/lib/notify";

/**
 * Daily nudges, so nothing sits waiting: unsigned documents (every 3 days)
 * and invoices due soon or overdue (every 4 days). Vercel Cron calls this
 * with the CRON_SECRET bearer token.
 */
export const maxDuration = 60;

const DAY = 86_400_000;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const db = getDb();
  const now = new Date();
  let sent = 0;

  const signerDue = new Date(now.getTime() - 3 * DAY);
  const pendingSigners = await db
    .select({ signer: documentSigners, doc: documents })
    .from(documentSigners)
    .innerJoin(documents, eq(documents.id, documentSigners.documentId))
    .where(
      and(
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
    .where(
      and(
        eq(invoices.status, "open"),
        lte(invoices.dueOn, soon),
        or(isNull(invoices.lastRemindedAt), lt(invoices.lastRemindedAt, invoiceDue)),
      ),
    )
    .limit(200);
  const today = todayIso(now);
  for (const { invoice, project } of dueInvoices) {
    const overdue = invoice.dueOn < today;
    const to = await clientRecipients(project.clientId, { approversOnly: true });
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

  // Fridays (UTC): the weekly recap. Hobby cron runs once a day, so it rides along here.
  const digests = now.getUTCDay() === 5 || new URL(request.url).searchParams.get("digest") === "force" ? await sendWeeklyDigests(now) : 0;

  void gte;
  void inArray;
  return Response.json({ ok: true, sent, digests });
}
