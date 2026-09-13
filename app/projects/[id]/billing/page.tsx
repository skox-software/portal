import { desc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { readMessage } from "@/components/Notice";
import { ProjectHeader } from "@/components/ProjectHeader";
import { getDb } from "@/lib/db";
import { invoices } from "@/lib/db/schema";
import { formatDate, formatDateTime, formatMoney, todayIso } from "@/lib/format";
import { loadProjectShell } from "@/lib/project-shell";
import { stripeEnabled } from "@/lib/stripe";
import { createInvoice, payInvoice, setInvoiceStatus } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Billing" };

export default async function BillingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const shell = await loadProjectShell(id);
  const { project, access } = shell;
  const list = await getDb().select().from(invoices).where(eq(invoices.projectId, project.id)).orderBy(desc(invoices.createdAt));
  const today = todayIso();
  const open = list.filter((i) => i.status === "open");
  const paid = list.filter((i) => i.status === "paid");
  const outstanding = open.reduce((sum, i) => sum + i.amountCents, 0);
  const paidTotal = paid.reduce((sum, i) => sum + i.amountCents, 0);
  const stripe = stripeEnabled();
  const nextNumber = `SKX-${new Date().getFullYear()}-${String(list.length + 1).padStart(3, "0")}`;
  const thanks = sp.paid === "1";

  return (
    <>
      <ProjectHeader
        shell={shell}
        tab="billing"
        title="Billing"
        intro="Every invoice for this project, what's paid and what's due. Pay securely in a couple of clicks."
        error={readMessage(sp.error)}
        notice={thanks ? "Thank you! Your payment is processing. It shows as paid here within a minute." : readMessage(sp.notice)}
      />
      <main className="shell page page-after-band">
        <section className="stat-row" aria-label="Billing summary">
          <div className="stat">
            <p className="label">Outstanding</p>
            <p className="stat-value">{formatMoney(outstanding)}</p>
            <p className="small muted">{open.length} open {open.length === 1 ? "invoice" : "invoices"}</p>
          </div>
          <div className="stat">
            <p className="label">Paid to date</p>
            <p className="stat-value">{formatMoney(paidTotal)}</p>
            <p className="small muted">{paid.length} paid</p>
          </div>
        </section>

        {access.isStaff && (
          <section className="card staff-card" aria-labelledby="new-invoice">
            <div className="card-head">
              <h2 id="new-invoice">New invoice</h2>
              <span className="chip chip-skox">SKOX only</span>
            </div>
            <form action={createInvoice} className="stack">
              <input type="hidden" name="projectId" value={project.id} />
              <div className="form-grid">
                <div className="field">
                  <label htmlFor="i-number">Invoice number</label>
                  <input id="i-number" name="number" required defaultValue={nextNumber} maxLength={40} />
                </div>
                <div className="field">
                  <label htmlFor="i-title">What it&apos;s for</label>
                  <input id="i-title" name="title" required maxLength={160} placeholder="e.g. 50% deposit" />
                </div>
                <div className="field">
                  <label htmlFor="i-amount">Amount (USD)</label>
                  <input id="i-amount" name="amount" type="number" min="1" step="0.01" required placeholder="2500" />
                </div>
                <div className="field">
                  <label htmlFor="i-due">Due</label>
                  <input id="i-due" name="dueOn" type="date" required />
                </div>
              </div>
              <div className="field">
                <label htmlFor="i-pay">Pay link {stripe ? "(optional: Stripe checkout is on)" : "(Stripe Payment Link, Square, PayPal…)"}</label>
                <input id="i-pay" name="payUrl" type="url" placeholder="https://buy.stripe.com/…" />
              </div>
              <div className="field">
                <label htmlFor="i-notes">Notes</label>
                <textarea id="i-notes" name="notes" maxLength={2000} placeholder="Payment terms, what's included…" />
              </div>
              <div>
                <button className="btn btn-primary" type="submit">
                  Add and email the approvers
                </button>
              </div>
            </form>
          </section>
        )}

        <section className="card" aria-labelledby="invoices-title">
          <div className="card-head">
            <h2 id="invoices-title">Invoices</h2>
          </div>
          {list.length === 0 ? (
            <p className="empty">No invoices yet.</p>
          ) : (
            <ul className="invoice-list">
              {list.map((inv) => {
                const overdue = inv.status === "open" && inv.dueOn < today;
                const canPay = inv.status === "open" && (stripe || inv.payUrl);
                return (
                  <li key={inv.id} className="invoice" data-status={overdue ? "overdue" : inv.status}>
                    <div className="invoice-main">
                      <p className="invoice-number">{inv.number}</p>
                      <p className="doc-title">{inv.title}</p>
                      <p className="small muted">
                        {inv.status === "paid" && inv.paidAt
                          ? `Paid ${formatDateTime(inv.paidAt)}`
                          : inv.status === "void"
                            ? "Cancelled"
                            : `${overdue ? "Overdue · was due" : "Due"} ${formatDate(inv.dueOn)}`}
                      </p>
                      {inv.notes && <p className="small muted" style={{ whiteSpace: "pre-line", marginTop: 4 }}>{inv.notes}</p>}
                    </div>
                    <p className="invoice-amount">{formatMoney(inv.amountCents, inv.currency)}</p>
                    <div className="invoice-actions">
                      <span className={inv.status === "paid" ? "chip chip-ok" : overdue ? "chip chip-danger" : inv.status === "void" ? "chip" : "chip chip-amber"}>
                        {inv.status === "paid" ? "Paid" : overdue ? "Overdue" : inv.status === "void" ? "Cancelled" : "Due"}
                      </span>
                      {canPay && !access.isStaff && (
                        <form action={payInvoice}>
                          <input type="hidden" name="projectId" value={project.id} />
                          <input type="hidden" name="invoiceId" value={inv.id} />
                          <button className="btn btn-primary btn-small" type="submit">
                            Pay now
                          </button>
                        </form>
                      )}
                      {access.isStaff && (
                        <form action={setInvoiceStatus} className="inline-form">
                          <input type="hidden" name="projectId" value={project.id} />
                          <input type="hidden" name="invoiceId" value={inv.id} />
                          <select name="status" defaultValue={inv.status} aria-label="Invoice status">
                            <option value="open">Open</option>
                            <option value="paid">Paid</option>
                            <option value="void">Cancelled</option>
                          </select>
                          <button className="btn btn-ghost btn-small" type="submit">
                            Save
                          </button>
                        </form>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {!access.isStaff && open.length > 0 && !stripe && open.every((i) => !i.payUrl) && (
            <p className="small muted" style={{ marginTop: 12 }}>
              Payment details are in the invoice email. Questions? Reply to it or email founders@skoxsoftware.com.
            </p>
          )}
        </section>
      </main>
    </>
  );
}
