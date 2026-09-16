"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { documents, invoices } from "@/lib/db/schema";
import { eventInsert } from "@/lib/events";
import { sendEmail } from "@/lib/email";
import { canCheckout } from "@/lib/billing-access";
import { formatDate, formatMoney } from "@/lib/format";
import { backWith } from "@/lib/http";
import { afterInvoicePaid } from "@/lib/kickoff";
import { clientRecipients, notifyLater, portalLink } from "@/lib/notify";
import { invoiceLocked } from "@/lib/onboarding";
import { projectForAction } from "@/lib/project-access";
import { stripeEnabled, stripeSandbox } from "@/lib/stripe";

export async function createInvoice(formData: FormData) {
  const ctx = await projectForAction(formData.get("projectId"));
  if (!ctx.ok || !ctx.access.isStaff) return;
  const { project, viewer } = ctx;
  const back = `/projects/${project.id}/billing`;

  const parsed = z
    .object({
      number: z.string().trim().min(1).max(40),
      title: z.string().trim().min(1).max(160),
      amount: z.coerce.number().positive().max(10_000_000),
      dueOn: z.iso.date(),
      payUrl: z.union([z.literal(""), z.url({ protocol: /^https$/ })]),
      notes: z.string().trim().max(2000),
      documentId: z.union([z.literal(""), z.uuid()]),
    })
    .safeParse({
      number: formData.get("number"),
      title: formData.get("title"),
      amount: formData.get("amount"),
      dueOn: formData.get("dueOn"),
      payUrl: formData.get("payUrl") ?? "",
      notes: formData.get("notes") ?? "",
      documentId: formData.get("documentId") ?? "",
    });
  if (!parsed.success) backWith(back, "error", "Add a number, title, amount and due date. Pay links must start with https://");
  const input = parsed.data;

  let linkedDoc: typeof documents.$inferSelect | undefined;
  if (input.documentId) {
    [linkedDoc] = await getDb()
      .select()
      .from(documents)
      .where(and(eq(documents.id, input.documentId), eq(documents.projectId, project.id)))
      .limit(1);
    if (!linkedDoc || linkedDoc.status === "void") backWith(back, "error", "That agreement isn't on this project.");
  }

  const amountCents = Math.round(input.amount * 100);
  const id = crypto.randomUUID();
  await getDb().batch([
    getDb().insert(invoices).values({
      id,
      workspaceId: project.workspaceId,
      projectId: project.id,
      number: input.number,
      title: input.title,
      amountCents,
      dueOn: input.dueOn,
      payUrl: input.payUrl || null,
      notes: input.notes || null,
      documentId: linkedDoc?.id ?? null,
      createdBy: viewer.userId,
    }),
    eventInsert({
      workspaceId: project.workspaceId,
      projectId: project.id,
      actorId: viewer.userId,
      verb: "invoice.created",
      subjectType: "invoice",
      subjectId: id,
      payload: { title: input.title, amountCents, documentId: linkedDoc?.id ?? null },
    }),
  ]);

  const sendNow = formData.get("delivery") === "email";
  revalidatePath(back);
  revalidatePath(`/projects/${project.id}`);
  revalidatePath("/admin/billing");
  if (sendNow && (!linkedDoc || linkedDoc.status === "completed")) {
    const request = new FormData();
    request.set("projectId", project.id);
    request.set("invoiceId", id);
    await emailInvoice(request);
  }
  backWith(
    back,
    "notice",
    linkedDoc && linkedDoc.status !== "completed"
      ? `Invoice ${input.number} added. It unlocks for payment as soon as “${linkedDoc.title}” is signed.`
      : sendNow ? `Invoice ${input.number} added. Email delivery queued for the approvers.` : `Invoice ${input.number} created. Copy its payment link or email it when you're ready.`,
  );
}

/** Client: open the portal's own checkout page when Stripe is on, else the manual pay link. */
export async function payInvoice(formData: FormData) {
  const ctx = await projectForAction(formData.get("projectId"));
  if (!ctx.ok) return;
  if (!canCheckout(ctx.access, stripeSandbox())) return;
  const { project, viewer } = ctx;
  const back = `/projects/${project.id}/billing`;
  const invoiceId = String(formData.get("invoiceId") ?? "");
  if (!z.uuid().safeParse(invoiceId).success) return;
  const db = getDb();
  const [invoice] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.projectId, project.id), eq(invoices.status, "open")))
    .limit(1);
  if (!invoice) backWith(back, "notice", "That invoice is already settled.");

  if (invoice.documentId) {
    const [doc] = await db.select({ status: documents.status, title: documents.title }).from(documents).where(eq(documents.id, invoice.documentId)).limit(1);
    if (invoiceLocked(invoice, doc?.status)) {
      backWith(`/projects/${project.id}/documents/${invoice.documentId}`, "error", `Sign “${doc?.title}” first, then the deposit unlocks.`);
    }
  }

  // The payment form itself is mounted on our own page, so this is just a
  // navigation: the Stripe session is created when that page asks for it.
  const destination = stripeEnabled() ? `${back}/pay/${invoice.id}` : invoice.payUrl;
  if (!destination) backWith(back, "error", "Online payment isn't set up for this invoice yet. Reply to the invoice email and we'll sort it.");
  await eventInsert({
    workspaceId: project.workspaceId,
    projectId: project.id,
    actorId: viewer.userId,
    verb: "invoice.pay_started",
    subjectType: "invoice",
    subjectId: invoice.id,
    payload: { number: invoice.number },
  });
  redirect(destination);
}

/** Owner sends an existing invoice without creating a second invoice. */
export async function emailInvoice(formData: FormData) {
  const ctx = await projectForAction(formData.get("projectId"));
  if (!ctx.ok || !ctx.access.isStaff) return;
  const { project, client, viewer } = ctx;
  const back = formData.get("returnTo") === "billing" ? "/admin/billing" : `/projects/${project.id}/billing`;
  const invoiceId = z.uuid().safeParse(formData.get("invoiceId"));
  if (!invoiceId.success) return;
  const [invoice] = await getDb().select().from(invoices)
    .where(and(eq(invoices.id, invoiceId.data), eq(invoices.projectId, project.id))).limit(1);
  if (!invoice || invoice.status !== "open") backWith(back, "error", "Only open invoices can be sent for payment.");
  const recipients = await clientRecipients(client.id, { approversOnly: true, actionRequired: true });
  if (!recipients.length) backWith(back, "error", "Add a client approver to this project before emailing an invoice.");
  const sandbox = stripeSandbox();
  const sent = await sendEmail(recipients, {
    subject: `${sandbox ? "[Sandbox] " : ""}Invoice ${invoice.number} from SKOX: ${formatMoney(invoice.amountCents, invoice.currency)}`,
    preheader: `${invoice.title} · due ${formatDate(invoice.dueOn)}`,
    heading: `Invoice ${invoice.number}: ${formatMoney(invoice.amountCents, invoice.currency)}`,
    paragraphs: [
      `Your invoice for ${invoice.title} on ${project.name} is ready. Please review the invoice details and complete payment securely in your client portal.`,
      ...(sandbox ? ["This is a sandbox payment request. Use a Stripe test card; no real money will be charged."] : []),
      ...(invoice.notes ? [invoice.notes] : []),
    ],
    cta: { label: "View invoice", href: portalLink(`/projects/${project.id}/billing/invoices/${invoice.id}`) },
    footnote: `Due ${formatDate(invoice.dueOn)}`,
  });
  if (!sent) backWith(back, "error", "Email delivery could not be confirmed. Copy the payment link or try again.");
  await eventInsert({ workspaceId: project.workspaceId, projectId: project.id, actorId: viewer.userId,
    verb: "invoice.emailed", subjectType: "invoice", subjectId: invoice.id, payload: { number: invoice.number } });
  backWith(back, "notice", `Invoice ${invoice.number} emailed to ${recipients.join(", ")}.`);
}

export async function setInvoiceStatus(formData: FormData) {
  const ctx = await projectForAction(formData.get("projectId"));
  if (!ctx.ok || !ctx.access.isStaff) return;
  const parsed = z
    .object({ invoiceId: z.uuid(), status: z.enum(["open", "paid", "void"]) })
    .safeParse({ invoiceId: formData.get("invoiceId"), status: formData.get("status") });
  if (!parsed.success) return;
  const { project, viewer, client } = ctx;
  const db = getDb();
  const [before] = await db
    .select({ status: invoices.status })
    .from(invoices)
    .where(and(eq(invoices.id, parsed.data.invoiceId), eq(invoices.projectId, project.id)))
    .limit(1);
  if (!before || before.status === parsed.data.status) return;
  const [invoice] = await db
    .update(invoices)
    .set({ status: parsed.data.status, paidAt: parsed.data.status === "paid" ? new Date() : null })
    // Only if nobody (e.g. the Stripe webhook) changed it in the meantime.
    .where(and(eq(invoices.id, parsed.data.invoiceId), eq(invoices.projectId, project.id), eq(invoices.status, before.status)))
    .returning();
  if (!invoice) return;
  await eventInsert({
    workspaceId: project.workspaceId,
    projectId: project.id,
    actorId: viewer.userId,
    verb: `invoice.${parsed.data.status}`,
    subjectType: "invoice",
    subjectId: invoice.id,
    payload: { title: invoice.title, amountCents: invoice.amountCents },
  });
  if (parsed.data.status === "paid") {
    notifyLater(() => clientRecipients(client.id, { approversOnly: true, actionRequired: true }), {
      subject: `Payment received: invoice ${invoice.number}`,
      preheader: "Thank you for your payment. Your receipt is available in the portal.",
      heading: "Payment received",
      paragraphs: [`We've received ${formatMoney(invoice.amountCents, invoice.currency)} for invoice ${invoice.number} (${invoice.title}).`],
      cta: { label: "See billing", href: portalLink(`/projects/${project.id}/billing`) },
    });
    after(async () => {
      try {
        await afterInvoicePaid(invoice);
      } catch (error) {
        console.error("[billing] kickoff step failed", { invoiceId: invoice.id, error });
      }
    });
  }
  revalidatePath(`/projects/${project.id}/billing`);
  revalidatePath(`/projects/${project.id}`);
}
