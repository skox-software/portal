import { and, asc, desc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { InvoiceOwnerActions } from "@/components/InvoiceOwnerActions";
import { BillingContacts } from "@/components/BillingContacts";
import { readMessage } from "@/components/Notice";
import { ProjectHeader } from "@/components/ProjectHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { canCheckout } from "@/lib/billing-access";
import { getDb } from "@/lib/db";
import { documents, events, invoices, memberships } from "@/lib/db/schema";
import { formatDate, formatDateTime, formatMoney, todayIso } from "@/lib/format";
import { invoiceLocked } from "@/lib/onboarding";
import { loadProjectShell } from "@/lib/project-shell";
import { stripeEnabled, stripeSandbox } from "@/lib/stripe";
import { payInvoice, recordInvoiceRefund, setInvoiceStatus } from "./actions";
import { CreateInvoiceForm } from "./CreateInvoiceForm";
import "./billing.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Billing" };

export default async function BillingPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const shell = await loadProjectShell(id);
  const { project, client, access } = shell;
  const db = getDb();
  const [list, docs, sentEvents, contacts] = await Promise.all([
    db.select().from(invoices).where(eq(invoices.projectId, project.id)).orderBy(asc(invoices.dueOn), asc(invoices.createdAt)),
    db.select({ id: documents.id, title: documents.title, status: documents.status }).from(documents).where(eq(documents.projectId, project.id)).orderBy(desc(documents.createdAt)),
    access.isStaff ? db.select({ invoiceId: events.subjectId, at: events.createdAt }).from(events)
      .where(and(eq(events.projectId, project.id), eq(events.verb, "invoice.emailed"))).orderBy(desc(events.createdAt)) : Promise.resolve([]),
    access.isStaff ? db.select({ email: memberships.email }).from(memberships).where(eq(memberships.clientId, client.id)) : Promise.resolve([]),
  ]);
  const docById = new Map(docs.map((d) => [d.id, d]));
  const locked = (inv: typeof invoices.$inferSelect) => invoiceLocked(inv, inv.documentId ? docById.get(inv.documentId)?.status : undefined);
  const today = todayIso();
  const open = list.filter((i) => i.status === "open");
  const paid = list.filter((i) => i.status === "paid").sort((a, b) => (b.paidAt?.getTime() ?? 0) - (a.paidAt?.getTime() ?? 0));
  const cancelled = list.filter((i) => i.status === "void");
  const outstanding = open.reduce((sum, i) => sum + i.amountCents, 0);
  const paidTotal = paid.reduce((sum, i) => sum + i.amountCents, 0);
  const total = outstanding + paidTotal;
  const next = open.find((i) => !locked(i)) ?? open[0];
  const stripe = stripeEnabled();
  const sandbox = stripeSandbox();
  const nextNumber = `SKX-${new Date().getFullYear()}-${String(list.length + 1).padStart(3, "0")}`;
  const mayPay = canCheckout(access, sandbox);

  function paymentButton(inv: typeof invoices.$inferSelect) {
    if (inv.status !== "open") return null;
    if (locked(inv)) return <Link className="btn btn-primary" href={`/projects/${project.id}/documents/${inv.documentId}`}>{access.isStaff ? "View agreement" : "Sign agreement first"}</Link>;
    if (access.isStaff) return sandbox && stripe ? <Link className="btn btn-primary" href={`/projects/${project.id}/billing/pay/${inv.id}`}>Test checkout →</Link> : <Link className="btn btn-primary" href={`#invoice-${inv.id}`}>Manage payment request →</Link>;
    if (!mayPay) return <p className="small muted">Your project approver can make this payment.</p>;
    if (!stripe && !inv.payUrl) return <p className="small muted">Payment details are being arranged. Ask us below if you need help.</p>;
    return <form action={payInvoice}><input type="hidden" name="projectId" value={project.id} /><input type="hidden" name="invoiceId" value={inv.id} /><SubmitButton className="btn btn-primary" pendingLabel="Opening secure checkout…">Pay {formatMoney(inv.amountCents, inv.currency)} →</SubmitButton></form>;
  }

  function invoiceCard(inv: typeof invoices.$inferSelect) {
    const isPaid = inv.status === "paid";
    const isLocked = inv.status === "open" && locked(inv);
    const overdue = inv.status === "open" && !isLocked && inv.dueOn < today;
    const sent = sentEvents.find((event) => event.invoiceId === inv.id);
    const status = isPaid ? "Paid" : inv.status === "void" ? "Cancelled" : isLocked ? "Awaiting signature" : overdue ? "Overdue" : "Ready to pay";
    const detail = `/projects/${project.id}/billing/invoices/${inv.id}`;
    return <article className="billing-invoice" id={`invoice-${inv.id}`} key={inv.id} data-state={isPaid ? "paid" : overdue ? "overdue" : inv.status}>
      <div className="billing-invoice-top">
        <div className="billing-invoice-label"><span className="billing-invoice-icon" aria-hidden="true">{isPaid ? "✓" : "↗"}</span><div><p className="eyebrow">{inv.number}</p><h3><Link href={detail}>{inv.title}</Link></h3></div></div>
        <div className="billing-invoice-value"><p>{formatMoney(inv.amountCents, inv.currency)}</p><span className={`chip ${isPaid ? "chip-ok" : overdue ? "chip-danger" : "chip-amber"}`}>{status}</span></div>
      </div>
      <div className="billing-invoice-meta"><span>{isPaid && inv.paidAt ? `Paid ${formatDateTime(inv.paidAt)}` : `Due ${formatDate(inv.dueOn)}`}</span>{access.isStaff && <span>{sent ? `Last emailed ${formatDateTime(sent.at)}` : "No email recorded"}</span>}</div>
      {inv.notes && <p className="billing-invoice-notes">{inv.notes}</p>}
      {access.isStaff && inv.status === "open" && <BillingContacts clientId={client.id} emails={contacts.map(c=>c.email)} />}
      {isLocked && inv.documentId && <p className="billing-invoice-note">This payment unlocks after <Link href={`/projects/${project.id}/documents/${inv.documentId}`}>the agreement is signed</Link>.</p>}
      <div className="billing-invoice-footer">
        <Link className="billing-text-link" href={detail}>{isPaid ? "View receipt" : "View invoice"} ↗</Link>
        <div className="row">{access.isStaff ? <InvoiceOwnerActions invoice={inv} stripe={stripe} sandbox={sandbox} locked={isLocked} /> : inv.status === "open" && paymentButton(inv)}</div>
      </div>
      {access.isStaff && <details className="billing-status-control"><summary>Update invoice status</summary><p className="small muted">Card payments update automatically. Record payment here only if it was received another way.</p><form action={setInvoiceStatus} className="row"><input type="hidden" name="projectId" value={project.id} /><input type="hidden" name="invoiceId" value={inv.id} /><select name="status" defaultValue={inv.status} aria-label={`Status for ${inv.number}`}><option value="open">Open</option><option value="paid">Paid outside checkout</option><option value="void">Cancelled</option></select><SubmitButton className="btn btn-ghost btn-small" pendingLabel="Saving…">Save status</SubmitButton></form></details>}
      {access.isStaff && isPaid && !inv.stripePaymentIntentId && <details className="billing-status-control"><summary>Record a refund</summary><p className="small muted">For payments received outside Stripe. Stripe refunds record themselves. A sales rep&apos;s commission on this invoice is clawed back at the same rate.</p><form action={recordInvoiceRefund} className="row"><input type="hidden" name="projectId" value={project.id} /><input type="hidden" name="invoiceId" value={inv.id} /><label className="sr-only" htmlFor={`refund-${inv.id}`}>Amount refunded</label><input id={`refund-${inv.id}`} name="amount" inputMode="decimal" placeholder="Amount, e.g. 1250.00" required style={{ maxWidth: 180 }} /><label className="sr-only" htmlFor={`refund-reason-${inv.id}`}>Reason</label><input id={`refund-reason-${inv.id}`} name="reason" maxLength={300} placeholder="Reason (optional)" /><SubmitButton className="btn btn-ghost btn-small" pendingLabel="Saving…">Record refund</SubmitButton></form></details>}
    </article>;
  }

  return <>
    <ProjectHeader shell={shell} tab="billing" title="Billing" intro={access.isStaff ? `Payments, invoices, and receipts for ${client.name}.` : "Your payments, clearly laid out. Everything you need, right here."} error={readMessage(sp.error)} notice={readMessage(sp.notice)} />
    <main className="shell page page-after-band billing-hub">
      <div className="billing-toolbar">
        {access.isStaff ? <Link href="/admin/billing">← All client billing</Link> : <p className="eyebrow">{project.name}</p>}
        {access.isStaff && <Link className="btn btn-primary" href={`/projects/${project.id}/billing?new=1#new-invoice`}>+ Create invoice</Link>}
      </div>
      {sandbox && <div className="billing-sandbox"><span className="chip">Sandbox</span><p>No real money is charged. {access.isStaff ? "Use Test checkout with a test card. Test payments update invoices; emails still reach their recipients." : "This checkout is in test mode. Use only a Stripe test card."}</p></div>}
      {sp.from === "welcome" && <p className="small"><Link href={`/projects/${project.id}/welcome?step=agreement`}>← Back to your setup</Link></p>}
      <div className="billing-overview">
        <section className="billing-next" aria-labelledby="next-payment">
          <div className="billing-next-heading"><p className="eyebrow">{next ? locked(next) ? "Before we begin" : "Next payment" : list.length ? "Up to date" : "Your project billing"}</p><span className="billing-secure">{stripe ? "Secure checkout" : "Project payments"}</span></div>
          <h2 id="next-payment">{next ? formatMoney(next.amountCents, next.currency) : list.length ? "All settled." : "Ready when you are."}</h2>
          <p className="billing-next-description">{next ? next.title : list.length ? "There are no outstanding invoices for this project." : access.isStaff ? "Create your first invoice to request a deposit or project payment." : "Your invoices will appear here when a payment is ready."}</p>
          {next && <p className="small muted">{locked(next) ? "Your agreement needs a signature first." : `Due ${formatDate(next.dueOn)} · ${next.number}`}</p>}
          <div className="billing-next-action">{next ? paymentButton(next) : access.isStaff ? <Link className="btn btn-primary" href={`/projects/${project.id}/billing?new=1#new-invoice`}>Create first invoice →</Link> : <Link className="btn btn-ghost" href={`/projects/${project.id}`}>Back to your project</Link>}</div>
        </section>
        <section className="billing-summary" aria-labelledby="billing-summary">
          <p className="eyebrow" id="billing-summary">At a glance</p>
          <dl><div><dt>Invoiced to date</dt><dd>{formatMoney(total)}</dd></div><div><dt>Paid</dt><dd className="billing-paid-value">{formatMoney(paidTotal)}</dd></div><div className="billing-summary-balance"><dt>Remaining balance</dt><dd>{formatMoney(outstanding)}</dd></div></dl>
          {total > 0 && <><progress max={total} value={paidTotal} aria-label="Invoiced amount paid" /><p className="small muted">{paid.length} of {open.length + paid.length} invoices paid</p></>}
          <p className="billing-summary-footnote">Based on invoices issued for this project.</p>
        </section>
      </div>
      {access.isStaff && <details className="billing-composer" open={sp.new === "1" || list.length === 0} id="new-invoice"><summary><div><span className="eyebrow">SKOX only</span><h2>Create an invoice</h2></div><span aria-hidden="true">＋</span></summary><div className="billing-composer-body"><CreateInvoiceForm projectId={project.id} nextNumber={nextNumber} docs={docs} stripe={stripe} /></div></details>}
      <div className="billing-content">
        <div className="billing-ledger">
          <section aria-labelledby="open-invoices"><div className="billing-section-head"><h2 id="open-invoices">Upcoming &amp; unpaid</h2><span className="chip">{open.length}</span></div>
            {open.length ? open.map(invoiceCard) : <div className="billing-empty"><span aria-hidden="true">✓</span><h3>{paid.length ? "You're all caught up" : "No payment requests yet"}</h3><p>{paid.length ? "Every issued invoice has been settled or cancelled." : "New invoices will appear here with their amount, due date, and payment link."}</p></div>}
          </section>
          <section aria-labelledby="payment-history"><div className="billing-section-head"><h2 id="payment-history">Payment history</h2><span className="chip">{paid.length}</span></div>{paid.length ? paid.map(invoiceCard) : <p className="billing-history-empty">Once a payment is received, its receipt will be saved here.</p>}</section>
          {cancelled.length > 0 && <details className="billing-cancelled"><summary>Cancelled invoices ({cancelled.length})</summary>{cancelled.map(invoiceCard)}</details>}
        </div>
        <aside className="billing-aside">
          <section className="billing-help"><span className="eyebrow">We&apos;re here to help</span><h2>A question about billing?</h2><p>Keep the conversation with your project. Ask about an invoice, payment timing, or anything that needs clearing up.</p><Link className="billing-text-link" href={`/projects/${project.id}/support?topic=billing`}>{access.isStaff ? "Open project requests" : "Ask a billing question"} →</Link></section>
          <section className="billing-how"><h3>{access.isStaff ? "Send it your way" : "Simple, secure payments"}</h3><p>{access.isStaff ? "Email an invoice from here, or copy its payment link to share yourself. Clients sign in and pay inside this portal." : "Your payment is processed securely by Stripe. When it clears, your balance updates and your receipt stays here."}</p><Link href={`/projects/${project.id}/documents`}>View project agreements ↗</Link></section>
        </aside>
      </div>
    </main>
  </>;
}
