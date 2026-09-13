import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { invoices, projects } from "@/lib/db/schema";
import { sendEmail } from "@/lib/email";
import { formatMoney } from "@/lib/format";
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
    .where(and(eq(invoices.id, invoiceId), eq(invoices.status, "open")))
    .returning();
  if (!row) return Response.json({ received: true });

  const [project] = await db.select().from(projects).where(eq(projects.id, row.projectId)).limit(1);
  if (project) {
    const amount = formatMoney(row.amountCents, row.currency);
    const link = portalLink(`/projects/${project.id}/billing`);
    await Promise.all([
      clientRecipients(project.clientId, { approversOnly: true }).then((to) =>
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
