import { and, eq } from "drizzle-orm";
import type Stripe from "stripe";
import { getDb } from "@/lib/db";
import { clients, invoices, projects } from "@/lib/db/schema";
import { sendEmail } from "@/lib/email";
import { formatMoney } from "@/lib/format";
import { flagCommissionAttention, recordEarning, recordRefund, refundedCents } from "@/lib/commissions";
import { eventInsert } from "@/lib/events";
import { afterInvoicePaid } from "@/lib/kickoff";
import { clientRecipients, portalLink, staffRecipients } from "@/lib/notify";
import { paymentEmailDetails } from "@/lib/payment-email";
import { stripeEvent } from "@/lib/stripe";

/**
 * Marks an invoice paid when Stripe confirms the checkout payment.
 *
 * This, not the return page, is what settles an invoice: a client can close
 * the tab before ever landing back on the portal, and bank-transfer payments
 * confirm hours or days later.
 */
export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return new Response("Stripe not configured", { status: 404 });
  const payload = await request.text();
  const event = stripeEvent(payload, request.headers.get("stripe-signature"), secret);
  if (!event) return new Response("Bad signature", { status: 400 });

  if (event.type === "charge.refunded") {
    await settleRefund(event.data.object as Stripe.Charge);
    return Response.json({ received: true });
  }

  const handled = [
    "checkout.session.completed",
    "checkout.session.async_payment_succeeded",
    "checkout.session.async_payment_failed",
  ];
  if (!handled.includes(event.type)) return Response.json({ received: true });
  const session = event.data.object as Stripe.Checkout.Session;
  const invoiceId = session.metadata?.invoice_id;
  if (!invoiceId) return Response.json({ received: true });

  if (event.type === "checkout.session.async_payment_failed") {
    await reportFailedPayment(invoiceId, session);
    return Response.json({ received: true });
  }
  // A delayed payment method (e.g. bank transfer) completes the session while
  // it's still unpaid. Only money that actually arrived settles an invoice.
  if (session.payment_status === "unpaid") return Response.json({ received: true });

  const db = getDb();
  const [row] = await db
    .update(invoices)
    .set({
      status: "paid",
      paidAt: new Date(),
      stripeSessionId: session.id,
      stripePaymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : (session.payment_intent?.id ?? null),
    })
    .where(
      and(
        eq(invoices.id, invoiceId),
        eq(invoices.status, "open"),
        // Only the exact invoice amount settles it.
        ...(typeof session.amount_total === "number" ? [eq(invoices.amountCents, session.amount_total)] : []),
      ),
    )
    .returning();
  if (!row) {
    const [existing] = await db.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
    if (!existing) return Response.json({ received: true });
    if (existing.status === "paid" && typeof session.amount_total === "number" && session.amount_total === existing.amountCents) {
      // A retry after a partial failure: finish the kickoff step and the rep's
      // commission (both are guarded, so this is safe).
      await afterInvoicePaid(existing);
      await safeRecordEarning(existing);
      return Response.json({ received: true });
    }
    // Paid again, paid after being voided, or a different amount: a person should look.
    const [p] = await db.select().from(projects).where(eq(projects.id, existing.projectId)).limit(1);
    if (p) {
      const [company] = await db.select({ name: clients.name }).from(clients).where(eq(clients.id, p.clientId)).limit(1);
      await sendEmail(await staffRecipients(p.workspaceId), {
        subject: `Check this payment: invoice ${existing.number}`,
        preheader: "A payment could not be matched to the expected invoice status or amount.",
        heading: "Payment review required",
        details: paymentEmailDetails(session, company?.name ?? "Company unavailable", p.name),
        paragraphs: [
          `Stripe reported a payment of ${formatMoney(session.amount_total ?? 0, existing.currency)} for invoice ${existing.number} (${existing.title}) on ${p.name}.`,
          `The invoice is ${existing.status} for ${formatMoney(existing.amountCents, existing.currency)}, so nothing was changed. It may be a duplicate that needs a refund.`,
        ],
        cta: { label: "Open billing", href: portalLink(`/projects/${p.id}/billing`) },
      });
    }
    return Response.json({ received: true });
  }

  const [project] = await db.select().from(projects).where(eq(projects.id, row.projectId)).limit(1);
  if (project) {
    const [company] = await db.select({ name: clients.name }).from(clients).where(eq(clients.id, project.clientId)).limit(1);
    const companyName = company?.name ?? "Company unavailable";
    const amount = formatMoney(row.amountCents, row.currency);
    const link = portalLink(`/projects/${project.id}/billing`);
    // Kickoff first: if emails fail, the retry path above still has nothing left to do but notify.
    await afterInvoicePaid(row, paymentEmailDetails(session, companyName, project.name));
    // Commission never blocks the payment: a failure is flagged for a person.
    await safeRecordEarning(row);
    await eventInsert({ workspaceId: row.workspaceId, projectId: row.projectId, actorId: "stripe", verb: "invoice.paid", subjectType: "invoice", subjectId: row.id, payload: { title: row.title, amountCents: row.amountCents } });
    await Promise.allSettled([
      clientRecipients(project.clientId, { approversOnly: true, actionRequired: true }).then((to) =>
        sendEmail(to, {
          subject: `Payment received: invoice ${row.number}`,
          preheader: "Thank you. Your receipt is in the portal.",
          heading: "Payment received",
          paragraphs: [`We've received ${amount} for invoice ${row.number} (${row.title}).`],
          cta: { label: "View receipt", href: portalLink(`/projects/${project.id}/billing/invoices/${row.id}`) },
        }),
      ),
      staffRecipients(project.workspaceId).then((to) =>
        sendEmail(to, {
          subject: `${session.livemode ? "" : "[Sandbox] "}Payment received: ${companyName} · ${amount}`,
          preheader: `${session.customer_details?.individual_name || session.customer_details?.name || session.customer_details?.email || session.customer_email || "Payer"} · Invoice ${row.number}`,
          heading: `${amount} received`,
          paragraphs: [`Payment of ${amount} has been received for invoice ${row.number} (${row.title}).`],
          details: paymentEmailDetails(session, companyName, project.name),
          cta: { label: "Open billing", href: link },
        }),
      ),
    ]);
  }
  return Response.json({ received: true });
}

/** Records commission, but a ledger failure must never stop the receipt, emails or kickoff. */
async function safeRecordEarning(invoice: typeof invoices.$inferSelect) {
  try {
    await recordEarning(invoice, "stripe");
  } catch (error) {
    console.error("[stripe] commission could not be recorded", { invoiceId: invoice.id, error });
    await flagCommissionAttention(invoice, `Recording commission failed: ${(error as Error)?.message ?? String(error)}`, "stripe");
  }
}

/**
 * A delayed payment that failed after checkout. The invoice stays open — the
 * client saw a "payment started" screen, so someone has to chase it.
 */
async function reportFailedPayment(invoiceId: string, session: Stripe.Checkout.Session) {
  const db = getDb();
  const [invoice] = await db.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
  if (!invoice) return;
  const [project] = await db.select().from(projects).where(eq(projects.id, invoice.projectId)).limit(1);
  if (!project) return;
  const [company] = await db.select({ name: clients.name }).from(clients).where(eq(clients.id, project.clientId)).limit(1);
  await sendEmail(await staffRecipients(project.workspaceId), {
    subject: `Payment failed: invoice ${invoice.number}`,
    preheader: `Payment for invoice ${invoice.number} was unsuccessful.`,
    heading: "Payment unsuccessful",
    details: paymentEmailDetails(session, company?.name ?? "Company unavailable", project.name).map(detail => detail.label === "Paid by" ? { ...detail, label: "Payer" } : detail),
    paragraphs: [
      `${project.name} started paying invoice ${invoice.number} (${invoice.title}) for ${formatMoney(invoice.amountCents, invoice.currency)}, and Stripe reports the payment failed.`,
      `This happens with bank transfers that are confirmed later. The invoice is still open${session.customer_email ? `, and the payer was ${session.customer_email}` : ""}.`,
    ],
    cta: { label: "Open billing", href: portalLink(`/projects/${project.id}/billing`) },
  });
}

/**
 * A refund issued in Stripe. `amount_refunded` is cumulative, so the new
 * refund is the difference from what's already recorded; keying it on the
 * charge and that total makes a retried event a no-op.
 */
async function settleRefund(charge: Stripe.Charge) {
  const intent = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
  if (!intent) return;
  const db = getDb();
  const [invoice] = await db.select().from(invoices).where(eq(invoices.stripePaymentIntentId, intent)).limit(1);
  if (!invoice) return;
  const delta = charge.amount_refunded - (await refundedCents(invoice.id));
  if (delta <= 0) return;
  const result = await recordRefund(invoice, {
    amountCents: delta,
    reason: "Refunded in Stripe",
    actor: "stripe",
    stripeRefundId: `${charge.id}:${charge.amount_refunded}`,
  });
  const [project] = await db.select().from(projects).where(eq(projects.id, invoice.projectId)).limit(1);
  if (!project) return;
  await sendEmail(await staffRecipients(project.workspaceId), {
    subject: `Refund recorded: invoice ${invoice.number}`,
    preheader: `${formatMoney(delta, invoice.currency)} refunded in Stripe.`,
    heading: "Refund recorded",
    paragraphs: [
      `Stripe refunded ${formatMoney(delta, invoice.currency)} on invoice ${invoice.number} (${invoice.title}) for ${project.name}.`,
      result.ok
        ? "If a sales rep earned commission on this invoice, a matching clawback is on their next statement."
        : `The refund could not be recorded: ${result.message} Check it in the portal.`,
    ],
    cta: { label: "Open billing", href: portalLink(`/projects/${project.id}/billing`) },
  });
}
