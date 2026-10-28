import { and, eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { InvoiceOwnerActions } from "@/components/InvoiceOwnerActions";
import { ProjectHeader } from "@/components/ProjectHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { canCheckout } from "@/lib/billing-access";
import { SUPPORT_EMAIL } from "@/lib/brand";
import { getDb } from "@/lib/db";
import { documents, invoices } from "@/lib/db/schema";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { invoiceLocked } from "@/lib/onboarding";
import { loadProjectShell } from "@/lib/project-shell";
import { stripeEnabled, stripeSandbox } from "@/lib/stripe";
import { payInvoice } from "../../actions";
import { PrintInvoice } from "../../PrintInvoice";
import "../../billing.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Invoice" };

export default async function InvoicePage({ params }: { params: Promise<{ id: string; invoiceId: string }> }) {
  const { id, invoiceId } = await params;
  if (!z.uuid().safeParse(invoiceId).success) notFound();
  const shell = await loadProjectShell(id);
  const { project, client, access } = shell;
  const [row] = await getDb().select({ invoice: invoices, documentStatus: documents.status }).from(invoices)
    .leftJoin(documents, eq(documents.id, invoices.documentId))
    .where(and(eq(invoices.id, invoiceId), eq(invoices.projectId, project.id))).limit(1);
  if (!row) notFound();
  const { invoice, documentStatus } = row;
  const locked = invoiceLocked(invoice, documentStatus ?? undefined);
  const paid = invoice.status === "paid";
  const stripe = stripeEnabled();
  const sandbox = stripeSandbox();
  return <>
    <div className="billing-no-print"><ProjectHeader shell={shell} tab="billing" title={paid ? "Payment receipt" : "Invoice"} intro={invoice.title} /></div>
    <main className="shell page page-after-band billing-hub">
      <div className="billing-toolbar billing-no-print">
        <Link href={`/projects/${project.id}/billing`}>← Back to billing</Link>
        <PrintInvoice />
      </div>
      <article className="billing-document">
        <div className="billing-document-head"><div><p className="eyebrow">UnBusy</p><h1>{paid ? "Payment receipt" : "Invoice"}</h1></div><div><p className="label">{invoice.number}</p><span className={`chip ${paid ? "chip-ok" : "chip-amber"}`}>{paid ? "Paid" : invoice.status === "void" ? "Cancelled" : "Payment due"}</span></div></div>
        <div className="billing-document-meta">
          <div><p className="label">Bill to</p><strong>{client.name}</strong><p className="small muted">{project.name}</p></div>
          <div><p className="label">Issued</p><p>{formatDate(invoice.createdAt.toISOString().slice(0, 10))}</p><p className="label" style={{ marginTop: 12 }}>Due</p><p>{formatDate(invoice.dueOn)}</p></div>
        </div>
        <table className="billing-line-items"><thead><tr><th>Description</th><th>Amount</th></tr></thead><tbody><tr><td>{invoice.title}</td><td>{formatMoney(invoice.amountCents, invoice.currency)}</td></tr></tbody></table>
        <div className="billing-document-total"><span>{paid ? "Amount paid" : "Invoice total"}</span><strong>{formatMoney(invoice.amountCents, invoice.currency)}</strong></div>
        {paid && invoice.paidAt && <p className="small muted">Payment recorded {formatDateTime(invoice.paidAt)}.</p>}
        {invoice.notes && <section className="billing-document-notes"><h3>Notes &amp; payment terms</h3><p style={{ whiteSpace: "pre-line" }}>{invoice.notes}</p></section>}
        {locked && invoice.documentId && <p className="billing-no-print small">Please <Link href={`/projects/${project.id}/documents/${invoice.documentId}`}>sign your agreement</Link> to unlock this payment.</p>}
        <div className="row billing-no-print" style={{ marginTop: 24 }}>
          {access.isStaff && <InvoiceOwnerActions invoice={invoice} stripe={stripe} sandbox={sandbox} locked={locked} />}
          {!access.isStaff && canCheckout(access, sandbox) && invoice.status === "open" && !locked && (stripe || invoice.payUrl) && <form action={payInvoice}><input type="hidden" name="projectId" value={project.id} /><input type="hidden" name="invoiceId" value={invoice.id} /><SubmitButton className="btn btn-primary" pendingLabel="Opening…">Pay {formatMoney(invoice.amountCents, invoice.currency)}</SubmitButton></form>}
        </div>
        <footer className="billing-document-footer"><p>UnBusy · {SUPPORT_EMAIL}</p><p className="small">Thank you for building with us.</p></footer>
      </article>
    </main>
  </>;
}
