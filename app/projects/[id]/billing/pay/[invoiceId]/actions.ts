"use server";

import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { documents, invoices } from "@/lib/db/schema";
import { eventInsert } from "@/lib/events";
import { portalLink } from "@/lib/notify";
import { invoiceLocked } from "@/lib/onboarding";
import { projectForAction } from "@/lib/project-access";
import { createEmbeddedCheckout } from "@/lib/stripe";

/**
 * The secret the embedded payment form mounts with.
 *
 * Called from the browser, so it re-checks everything the page checked: who's
 * asking, that the invoice is theirs, still open, and not waiting on a
 * signature. The amount comes from the database, never from the client.
 */
export async function checkoutClientSecret(projectId: string, invoiceId: string) {
  const ctx = await projectForAction(projectId);
  if (!ctx.ok) throw new Error("You don't have access to this invoice.");
  const { project, viewer } = ctx;
  if (!z.uuid().safeParse(invoiceId).success) throw new Error("Unknown invoice.");

  const db = getDb();
  const [invoice] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.projectId, project.id), eq(invoices.status, "open")))
    .limit(1);
  if (!invoice) throw new Error("That invoice is already settled.");

  if (invoice.documentId) {
    const [doc] = await db
      .select({ status: documents.status })
      .from(documents)
      .where(eq(documents.id, invoice.documentId))
      .limit(1);
    if (invoiceLocked(invoice, doc?.status)) throw new Error("Sign the agreement first, then the deposit unlocks.");
  }

  const secret = await createEmbeddedCheckout({
    invoiceId: invoice.id,
    number: invoice.number,
    title: invoice.title,
    amountCents: invoice.amountCents,
    currency: invoice.currency,
    customerEmail: viewer.email,
    returnUrl: portalLink(`/projects/${project.id}/billing/paid?session_id={CHECKOUT_SESSION_ID}`),
  });

  await eventInsert({
    workspaceId: project.workspaceId,
    projectId: project.id,
    actorId: viewer.userId,
    verb: "invoice.pay_started",
    subjectType: "invoice",
    subjectId: invoice.id,
    payload: { number: invoice.number },
  });

  return secret;
}
