import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { invoices, projects } from "@/lib/db/schema";
import { sendEmail } from "@/lib/email";
import { formatMoney } from "@/lib/format";
import { afterInvoicePaid } from "@/lib/kickoff";
import { clientRecipients, portalLink, staffRecipients } from "@/lib/notify";
import { verifyStripeSignature } from "@/lib/stripe";

/** Marks an invoice paid when Stripe confirms the checkout payment. */
export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return new Response("Stripe not configured", { status: 404 });
  const payload = await request.text();
  if (!verifyStripeSignature(payload, request.headers.get("stripe-signature"), secret)) {
    return new Response("Bad signature", { status: 400 });
  }

  const event = JSON.parse(payload) as {
    type: string;
    data: { object: { metadata?: { invoice_id?: string }; payment_status?: string; amount_total?: number } };
  };
  const paidTypes = ["checkout.session.completed", "checkout.session.async_payment_succeeded"];
  if (!paidTypes.includes(event.type)) return Response.json({ received: true });
  const session = event.data.object;
  const invoiceId = session.metadata?.invoice_id;
  if (!invoiceId || session.payment_status !== "paid") return Response.json({ received: true });

  const db = getDb();
  const [row] = await db
    .update(invoices)
    .set({ status: "paid", paidAt: new Date() })
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
      // A retry after a partial failure: finish the kickoff step (it's guarded, so this is safe).
      await afterInvoicePaid(existing);
      return Response.json({ received: true });
    }
    // Paid again, paid after being voided, or a different amount: a person should look.
    const [p] = await db.select().from(projects).where(eq(projects.id, existing.projectId)).limit(1);
    if (p) {
      await sendEmail(await staffRecipients(p.workspaceId), {
        subject: `Check this payment: invoice ${existing.number}`,
        preheader: "Stripe reported a payment the portal didn't expect.",
        heading: "A payment needs a look",
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
    const amount = formatMoney(row.amountCents, row.currency);
    const link = portalLink(`/projects/${project.id}/billing`);
    // Kickoff first: if emails fail, the retry path above still has nothing left to do but notify.
    await afterInvoicePaid(row);
    await Promise.allSettled([
      clientRecipients(project.clientId, { approversOnly: true, actionRequired: true }).then((to) =>
        sendEmail(to, {
          subject: `Payment received: invoice ${row.number}`,
          preheader: "Thank you. Your receipt is in the portal.",
          heading: "Thank you, payment received",
          paragraphs: [`We've received ${amount} for invoice ${row.number} (${row.title}).`],
          cta: { label: "See billing", href: link },
        }),
      ),
      staffRecipients(project.workspaceId).then((to) =>
        sendEmail(to, {
          subject: `Paid: ${amount} for invoice ${row.number}`,
          preheader: `${project.name} paid through Stripe`,
          heading: `${amount} received`,
          paragraphs: [`Invoice ${row.number} (${row.title}) for ${project.name} was paid through Stripe.`],
          cta: { label: "Open billing", href: link },
        }),
      ),
    ]);
  }
  return Response.json({ received: true });
}
