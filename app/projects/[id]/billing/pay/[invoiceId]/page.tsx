import { and, eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ProjectHeader } from "@/components/ProjectHeader";
import { getDb } from "@/lib/db";
import { documents, invoices } from "@/lib/db/schema";
import { formatDate, formatMoney } from "@/lib/format";
import { invoiceLocked } from "@/lib/onboarding";
import { loadProjectShell } from "@/lib/project-shell";
import { stripeEnabled } from "@/lib/stripe";
import { EmbeddedPay } from "./EmbeddedPay";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Pay invoice" };

/** Paying one invoice, without leaving the portal. */
export default async function PayInvoicePage({
  params,
}: {
  params: Promise<{ id: string; invoiceId: string }>;
}) {
  const { id, invoiceId } = await params;
  const shell = await loadProjectShell(id);
  const { project, access } = shell;
  const back = `/projects/${project.id}/billing`;
  // Staff never pay a client's invoice, and without keys there's nothing to mount.
  if (!stripeEnabled() || access.isStaff) redirect(back);

  const db = getDb();
  const [invoice] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.projectId, project.id)))
    .limit(1);
  if (!invoice) notFound();
  if (invoice.status !== "open") redirect(back);

  if (invoice.documentId) {
    const [doc] = await db
      .select({ status: documents.status })
      .from(documents)
      .where(eq(documents.id, invoice.documentId))
      .limit(1);
    if (invoiceLocked(invoice, doc?.status)) redirect(`/projects/${project.id}/documents/${invoice.documentId}`);
  }

  return (
    <>
      <ProjectHeader
        shell={shell}
        tab="billing"
        title={`Pay invoice ${invoice.number}`}
        intro={`${invoice.title} · ${formatMoney(invoice.amountCents, invoice.currency)} · due ${formatDate(invoice.dueOn)}`}
      />
      <main className="shell page page-after-band">
        <p className="small" style={{ marginBottom: 14 }}>
          <Link href={back}>← Back to billing</Link>
        </p>
        <section className="card" aria-label="Payment">
          <EmbeddedPay projectId={project.id} invoiceId={invoice.id} />
        </section>
        <p className="small muted" style={{ marginTop: 12 }}>
          Payments are handled by Stripe. Your card details go straight to them and never touch our servers.
        </p>
      </main>
    </>
  );
}
