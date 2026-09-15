import { desc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { InvoiceOwnerActions } from "@/components/InvoiceOwnerActions";
import { Notice, readMessage } from "@/components/Notice";
import { TopBar } from "@/components/TopBar";
import { requireStaff } from "@/lib/access";
import { getDb } from "@/lib/db";
import { clients, documents, invoices, projects } from "@/lib/db/schema";
import { formatDate, formatMoney } from "@/lib/format";
import { invoiceLocked } from "@/lib/onboarding";
import { stripeEnabled, stripeSandbox } from "@/lib/stripe";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Billing · Mission control" };

export default async function AdminBillingPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { viewer, staff } = await requireStaff();
  const sp = await searchParams;
  const db = getDb();
  const [list, projectList] = await Promise.all([
    db.select({ invoice: invoices, project: projects, client: clients, documentStatus: documents.status })
      .from(invoices).innerJoin(projects, eq(projects.id, invoices.projectId))
      .innerJoin(clients, eq(clients.id, projects.clientId))
      .leftJoin(documents, eq(documents.id, invoices.documentId))
      .where(eq(invoices.workspaceId, staff.workspaceId)).orderBy(desc(invoices.createdAt)),
    db.select({ project: projects, client: clients }).from(projects)
      .innerJoin(clients, eq(clients.id, projects.clientId))
      .where(eq(projects.workspaceId, staff.workspaceId)).orderBy(desc(projects.createdAt)),
  ]);
  const stripe = stripeEnabled();
  const sandbox = stripeSandbox();
  return (
    <>
      <TopBar viewer={viewer} />
      <main className="shell page">
        <div className="page-head">
          <div><p className="eyebrow">Mission control</p><h1>Billing</h1>
            <p className="muted">Create and send invoices. Share payment links. Track every client payment.</p>
          </div>
          <Link className="btn btn-primary" href="#create-invoice">Create invoice</Link>
        </div>
        <Notice error={readMessage(sp.error)} notice={readMessage(sp.notice)} />
        {sandbox && <section className="card" aria-label="Payment mode">
          <strong>Stripe sandbox is on — no real charges.</strong>
          <p className="small muted">Use Test checkout to try an open invoice as the owner. A successful test updates that invoice, so use a test project. Email invoice sends a real email. Portal payment links require client sign-in.</p>
        </section>}
        <section className="card" aria-labelledby="all-invoices">
          <div className="card-head"><h2 id="all-invoices">All invoices</h2><span className="chip">{list.length}</span></div>
          {!list.length ? <p className="empty">No invoices yet. Choose a project below to create one.</p> : (
            <ul className="invoice-list">
              {list.map(({ invoice, project, client, documentStatus }) => (
                <li key={invoice.id} className="invoice" data-status={invoice.status}>
                  <div className="invoice-main">
                    <p className="invoice-number">{invoice.number} · {client.name}</p>
                    <p className="doc-title">{invoice.title}</p>
                    <p className="small muted">{project.name} · Due {formatDate(invoice.dueOn)}</p>
                    {invoice.status === "open" && invoiceLocked(invoice, documentStatus ?? undefined) && <p className="small">Waiting for the agreement to be signed.</p>}
                  </div>
                  <p className="invoice-amount">{formatMoney(invoice.amountCents, invoice.currency)}</p>
                  <div className="invoice-actions">
                    <span className={`chip ${invoice.status === "paid" ? "chip-ok" : invoice.status === "open" ? "chip-amber" : ""}`}>{invoice.status === "paid" ? "Paid" : invoice.status === "open" ? "Due" : "Cancelled"}</span>
                    <InvoiceOwnerActions invoice={invoice} stripe={stripe} sandbox={sandbox} locked={invoiceLocked(invoice, documentStatus ?? undefined)} central />
                    <Link className="btn btn-ghost btn-small" href={`/projects/${project.id}/billing#invoice-${invoice.id}`}>Manage invoice</Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card" aria-labelledby="create-invoice">
          <div className="card-head"><h2 id="create-invoice">Create an invoice</h2></div>
          <p className="small muted">Choose the client project, then enter the amount, due date, and payment terms.</p>
          <div className="stack" style={{ marginTop: 16 }}>
            {projectList.map(({ project, client }) => (
              <div className="row" key={project.id}>
                <Link className="btn btn-ghost" href={`/projects/${project.id}/billing?new=1#new-invoice`}>{client.name} · {project.name}</Link>
              </div>
            ))}
            {!projectList.length && <Link href="/admin/onboard">Onboard your first client →</Link>}
          </div>
        </section>
      </main>
    </>
  );
}
