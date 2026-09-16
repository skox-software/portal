import { desc, eq } from "drizzle-orm";
import { BillingContacts } from "@/components/BillingContacts";
import type { Metadata } from "next";
import Link from "next/link";
import { InvoiceOwnerActions } from "@/components/InvoiceOwnerActions";
import { Notice, readMessage } from "@/components/Notice";
import { TopBar } from "@/components/TopBar";
import { requireStaff } from "@/lib/access";
import { getDb } from "@/lib/db";
import { clients, documents, invoices, memberships, projects } from "@/lib/db/schema";
import { formatDate, formatMoney, todayIso } from "@/lib/format";
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
  const [list, projectList, people] = await Promise.all([
    db.select({ invoice: invoices, project: projects, client: clients, documentStatus: documents.status })
      .from(invoices).innerJoin(projects, eq(projects.id, invoices.projectId))
      .innerJoin(clients, eq(clients.id, projects.clientId))
      .leftJoin(documents, eq(documents.id, invoices.documentId))
      .where(eq(invoices.workspaceId, staff.workspaceId)).orderBy(desc(invoices.createdAt)),
    db.select({ project: projects, client: clients }).from(projects)
      .innerJoin(clients, eq(clients.id, projects.clientId))
      .where(eq(projects.workspaceId, staff.workspaceId)).orderBy(desc(projects.createdAt)),
    db.select({ email: memberships.email, clientId: memberships.clientId }).from(memberships).where(eq(memberships.workspaceId, staff.workspaceId)),
  ]);
  const stripe = stripeEnabled();
  const sandbox = stripeSandbox();
  const filter = typeof sp.status === "string" ? sp.status : "all";
  const q = typeof sp.q === "string" ? sp.q.toLowerCase().trim() : "";
  const visible = list.filter(({invoice,client,project}) => (filter === "all" || (filter === "overdue" ? invoice.status === "open" && invoice.dueOn < todayIso() : invoice.status === filter)) && `${invoice.number} ${client.name} ${project.name}`.toLowerCase().includes(q));
  const open = list.filter(({invoice}) => invoice.status === "open");
  const overdue = open.filter(({invoice}) => invoice.dueOn < todayIso());
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
        <section className="admin-metrics" aria-label="Billing summary">
          <Link className="admin-metric" href="/admin/billing?status=open"><span>Outstanding</span><strong>{formatMoney(open.reduce((n,{invoice})=>n+invoice.amountCents,0))}</strong><small>{open.length} unpaid invoices</small></Link>
          <Link className="admin-metric" href="/admin/billing?status=overdue"><span>Overdue</span><strong>{formatMoney(overdue.reduce((n,{invoice})=>n+invoice.amountCents,0))}</strong><small>{overdue.length} need follow-up</small></Link>
          <Link className="admin-metric" href="/admin/billing?status=paid"><span>Recorded as paid</span><strong>{formatMoney(list.filter(({invoice})=>invoice.status === "paid").reduce((n,{invoice})=>n+invoice.amountCents,0))}</strong><small>All paid portal invoices, including tests</small></Link>
          <Link className="admin-metric" href="/admin/clients"><span>Missing contacts</span><strong>{new Set(open.filter(({client})=>!people.some(p=>p.clientId===client.id)).map(({client})=>client.id)).size}</strong><small>Clients with unpaid invoices</small></Link>
        </section>
        <form className="admin-filter" action="/portal/admin/billing"><label className="sr-only" htmlFor="billing-search">Search invoices</label><input id="billing-search" name="q" defaultValue={q} placeholder="Search invoice, company, or project…" /><label className="sr-only" htmlFor="billing-filter">Invoice status</label><select id="billing-filter" name="status" defaultValue={filter}><option value="all">All invoices</option><option value="open">Unpaid</option><option value="overdue">Overdue</option><option value="paid">Paid</option><option value="void">Cancelled</option></select><button className="btn btn-primary">Search</button>{(q || filter !== "all") && <Link className="btn btn-ghost" href="/admin/billing">Clear</Link>}</form>
        {sandbox && <section className="card" aria-label="Payment mode">
          <strong>Stripe sandbox is on — no real charges.</strong>
          <p className="small muted">Use Test checkout to try an open invoice as the owner. A successful test updates that invoice, so use a test project. Email invoice sends a real email. Portal payment links require client sign-in.</p>
        </section>}
        <section className="card" aria-labelledby="all-invoices">
          <div className="card-head"><h2 id="all-invoices">Invoices</h2><span className="chip">{visible.length}</span></div>
          {!visible.length ? <p className="empty">{list.length ? "No invoices match these filters." : "No invoices yet. Choose a project below to create one."}</p> : (
            <ul className="invoice-list">
              {visible.map(({ invoice, project, client, documentStatus }) => (
                <li key={invoice.id} className="invoice" data-status={invoice.status}>
                  <div className="invoice-main">
                    <p className="invoice-number">{invoice.number} · {client.name}</p>
                    <p className="doc-title">{invoice.title}</p>
                    <p className="small muted">{project.name} · Due {formatDate(invoice.dueOn)}</p>
                    {invoice.status === "open" && <BillingContacts clientId={client.id} emails={people.filter(p=>p.clientId===client.id).map(p=>p.email)} />}
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
