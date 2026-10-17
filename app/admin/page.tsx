import { and, asc, count, desc, eq, inArray, isNotNull, isNull, lt, max, ne } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { Notice, readMessage } from "@/components/Notice";
import { requireStaff } from "@/lib/access";
import { getDb } from "@/lib/db";
import {
  approvals,
  clients,
  documents,
  documentSigners,
  feedback,
  ideas,
  invoices,
  memberships,
  onboardings,
  projects,
  referrals,
  supportRequests,
  tasks,
  updates,
} from "@/lib/db/schema";
import { daysUntil, describeDaysUntil, formatDate, formatDateTime, formatMoney, nowMs, STATUS_LABEL, todayIso } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Overview · SKOX" };

const STALE_UPDATE_DAYS = 7;
const DAY = 86_400_000;

type Attention = { key: string; level: "high" | "normal"; text: string; href: string; when?: Date };

export default async function MissionControl({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const { staff } = await requireStaff();
  const db = getDb();
  const ws = staff.workspaceId;
  const now = nowMs();
  const today = todayIso();
  const threeDaysAgo = new Date(now - 3 * DAY);

  const [rows, waiting, lastUpdates, clientVisits, openInvoices, unsigned, newRequests, pendingApprovals, openMustFix, warmIdeas, referralList] =
    await Promise.all([
      db
        .select({ client: clients, project: projects })
        .from(clients)
        .leftJoin(projects, eq(projects.clientId, clients.id))
        .where(eq(clients.workspaceId, ws))
        .orderBy(asc(clients.name), asc(projects.deliveryDate)),
      db
        .select({ projectId: tasks.projectId, n: count() })
        .from(tasks)
        .where(and(eq(tasks.workspaceId, ws), eq(tasks.side, "client"), isNull(tasks.doneAt)))
        .groupBy(tasks.projectId),
      db.select({ projectId: updates.projectId, last: max(updates.createdAt) }).from(updates).where(eq(updates.workspaceId, ws)).groupBy(updates.projectId),
      db
        .select({ clientId: memberships.clientId, last: max(memberships.lastSeenAt), people: count() })
        .from(memberships)
        .where(and(eq(memberships.workspaceId, ws), isNotNull(memberships.clientId)))
        .groupBy(memberships.clientId),
      db.select({ invoice: invoices, project: projects }).from(invoices).innerJoin(projects, eq(projects.id, invoices.projectId)).where(and(eq(invoices.workspaceId, ws), eq(invoices.status, "open"))),
      db
        .select({ doc: documents, pending: count(documentSigners.id) })
        .from(documents)
        .innerJoin(documentSigners, and(eq(documentSigners.documentId, documents.id), ne(documentSigners.status, "signed")))
        .where(and(eq(documents.workspaceId, ws), eq(documents.status, "out_for_signature"), lt(documents.createdAt, threeDaysAgo)))
        .groupBy(documents.id),
      db.select({ request: supportRequests, project: projects }).from(supportRequests).innerJoin(projects, eq(projects.id, supportRequests.projectId)).where(and(eq(supportRequests.workspaceId, ws), eq(supportRequests.status, "new"))),
      db.select({ approval: approvals, project: projects }).from(approvals).innerJoin(projects, eq(projects.id, approvals.projectId)).where(and(eq(approvals.workspaceId, ws), eq(approvals.state, "changes_requested"), lt(approvals.createdAt, new Date()))),
      db.select({ projectId: feedback.projectId, n: count() }).from(feedback).where(and(eq(feedback.workspaceId, ws), eq(feedback.tag, "must_fix"), inArray(feedback.status, ["open", "in_progress"]))).groupBy(feedback.projectId),
      db.select({ idea: ideas, project: projects }).from(ideas).innerJoin(projects, eq(projects.id, ideas.projectId)).where(and(eq(ideas.workspaceId, ws), eq(ideas.status, "interested"))),
      db.select().from(referrals).where(eq(referrals.workspaceId, ws)).orderBy(desc(referrals.createdAt)).limit(20),
    ]);

  const onboardingRows = await db
    .select({ onboarding: onboardings, client: clients })
    .from(onboardings)
    .innerJoin(projects, eq(projects.id, onboardings.projectId))
    .innerJoin(clients, eq(clients.id, projects.clientId))
    .where(eq(onboardings.workspaceId, ws));
  const waitingBy = new Map(waiting.map((w) => [w.projectId, Number(w.n)]));
  const lastBy = new Map(lastUpdates.map((u) => [u.projectId, u.last]));
  const visitBy = new Map(clientVisits.map((v) => [v.clientId, v]));
  const mustFixBy = new Map(openMustFix.map((f) => [f.projectId, Number(f.n)]));
  const projectById = new Map(rows.flatMap((r) => (r.project ? [[r.project.id, r.project] as const] : [])));

  const grouped = new Map<string, { client: (typeof rows)[number]["client"]; projects: NonNullable<(typeof rows)[number]["project"]>[] }>();
  for (const { client, project } of rows) {
    const entry = grouped.get(client.id) ?? { client, projects: [] };
    if (project) entry.projects.push(project);
    grouped.set(client.id, entry);
  }

  const attention: Attention[] = [
    ...newRequests.map(({ request, project }) => ({
      key: `req-${request.id}`,
      level: request.priority === "urgent" ? ("high" as const) : ("normal" as const),
      text: `${request.priority === "urgent" ? "URGENT request" : "New request"}: ${request.title} (${project.name})`,
      href: `/projects/${project.id}/support#r-${request.id}`,
      when: request.createdAt,
    })),
    ...pendingApprovals.map(({ approval, project }) => ({
      key: `ap-${approval.id}`,
      level: "high" as const,
      text: `Changes requested on ${project.name}${approval.note ? `: “${approval.note.slice(0, 60)}”` : ""}`,
      href: `/projects/${project.id}/review`,
      when: approval.decidedAt ?? approval.createdAt,
    })),
    ...openInvoices
      .filter(({ invoice }) => invoice.dueOn < today)
      .map(({ invoice, project }) => ({
        key: `inv-${invoice.id}`,
        level: "high" as const,
        text: `Overdue: invoice ${invoice.number} ${formatMoney(invoice.amountCents, invoice.currency)} (${project.name})`,
        href: `/projects/${project.id}/billing`,
      })),
    ...unsigned.map(({ doc, pending }) => ({
      key: `doc-${doc.id}`,
      level: "normal" as const,
      text: `${doc.title}: ${pending} signature${Number(pending) === 1 ? "" : "s"} outstanding for 3+ days`,
      href: `/projects/${doc.projectId}/documents/${doc.id}`,
      when: doc.createdAt,
    })),
    ...warmIdeas.map(({ idea, project }) => ({
      key: `idea-${idea.id}`,
      level: "high" as const,
      text: `Warm lead: ${project.name} is interested in “${idea.title}”`,
      href: `/projects/${project.id}/results#ideas`,
      when: idea.respondedAt ?? idea.createdAt,
    })),
    ...[...mustFixBy.entries()].map(([projectId, n]) => ({
      key: `fix-${projectId}`,
      level: "normal" as const,
      text: `${n} must-fix comment${n === 1 ? "" : "s"} open on ${projectById.get(projectId)?.name ?? "a project"}`,
      href: `/projects/${projectId}/review`,
    })),
    ...onboardingRows.flatMap(({ onboarding: o, client }) => {
      const items: Attention[] = [];
      const idle = Math.floor((now - (o.lastActivityAt ?? o.welcomeSentAt ?? o.createdAt).getTime()) / DAY);
      if (!o.welcomeSentAt) {
        items.push({ key: `ob-draft-${o.id}`, level: "high", text: `Welcome not sent yet: ${client.name}`, href: `/admin/onboard/${o.projectId}`, when: o.createdAt });
      } else if (o.status === "completed" && o.completedAt && now - o.completedAt.getTime() < 7 * DAY) {
        items.push({ key: `ob-done-${o.id}`, level: "normal", text: `Brief ready: ${client.name} finished onboarding`, href: `/admin/projects/${o.projectId}/brief`, when: o.completedAt });
      } else if (o.status !== "completed" && idle >= 3) {
        items.push({ key: `ob-idle-${o.id}`, level: idle >= 5 ? "high" : "normal", text: `${client.name} paused onboarding ${idle} days ago`, href: `/admin/onboard`, when: o.lastActivityAt ?? o.createdAt });
      }
      if (o.recapConfirmed === false && o.status !== "completed") {
        items.push({ key: `ob-recap-${o.id}`, level: "high", text: `${client.name} added to the call recap`, href: `/admin/projects/${o.projectId}/brief` });
      }
      return items;
    }),
    ...referralList
      .filter((r) => r.status === "new")
      .map((r) => ({ key: `ref-${r.id}`, level: "high" as const, text: `New referral: ${r.name} (${r.email})`, href: "#referrals", when: r.createdAt })),
  ];

  const outstanding = openInvoices.reduce((s, { invoice }) => s + invoice.amountCents, 0);
  const activeProjects = [...projectById.values()].filter((p) => p.status !== "launched" && p.status !== "paused").length;


  const sortedAttention = [...attention].sort((a,b) => Number(b.level === "high") - Number(a.level === "high"));
  const upcoming = [...projectById.values()].filter(p => p.status !== "launched" && p.status !== "paused").sort((a,b) => a.deliveryDate.localeCompare(b.deliveryDate));
  const overdue = openInvoices.filter(({invoice}) => invoice.dueOn < today);
  const noContacts = [...grouped.values()].filter(({client}) => !visitBy.get(client.id)?.people);
  return <main className="shell page">
    <div className="page-head"><div><p className="eyebrow">YOUR BUSINESS, AT A GLANCE</p><h1>Overview</h1><p className="muted">What needs you, what’s moving, and what’s next.</p></div><Link className="btn btn-ghost" href="/admin/billing#create-invoice">Create invoice ↗</Link></div>
    <Notice error={readMessage(sp.error)} notice={readMessage(sp.notice)} />
    <section className="admin-metrics" aria-label="Business overview">
      <Link className="admin-metric" href="#attention"><span>Needs your attention ↗</span><strong>{attention.length + noContacts.length}</strong><small>Requests, payments & client setup</small></Link>
      <Link className="admin-metric" href="/admin/projects?status=active"><span>Active projects ↗</span><strong>{activeProjects}</strong><small>{upcoming.filter(p => daysUntil(p.deliveryDate) <= 7 && daysUntil(p.deliveryDate) >= 0).length} due in the next 7 days</small></Link>
      <Link className="admin-metric" href="/admin/billing"><span>Outstanding invoices ↗</span><strong>{formatMoney(outstanding)}</strong><small>{overdue.length} overdue · {openInvoices.length} unpaid</small></Link>
      <Link className="admin-metric" href="/admin/clients"><span>Clients ↗</span><strong>{grouped.size}</strong><small>{noContacts.length ? `${noContacts.length} need a contact added` : "Client contacts & projects"}</small></Link>
    </section>
    <div className="admin-dashboard-grid"><div>
      <section className="admin-panel" id="attention"><div className="admin-panel-head"><div><h2>Needs attention</h2><p>Your next actions, with urgent items first.</p></div><span className="chip">{attention.length + noContacts.length}</span></div>
        <ul className="admin-action-list">
          {noContacts.map(({client}) => <li key={client.id}><Link className="admin-action" data-priority="high" href={`/admin/clients/${client.id}#invite-title`}><span className="admin-action-icon" aria-hidden="true">◎</span><div><strong>Add a contact for {client.name}</strong><small>No invoice recipient is linked to this client.</small></div><span aria-hidden="true">↗</span></Link></li>)}
          {sortedAttention.slice(0,8).map(a => <li key={a.key}><Link className="admin-action" data-priority={a.level} href={a.href === "#referrals" ? "/admin/settings#referrals" : a.href}><span className="admin-action-icon" aria-hidden="true">{a.level === "high" ? "!" : "→"}</span><div><strong>{a.text}</strong><small>{a.when ? formatDateTime(a.when) : "Open to review and take action"}</small></div><span aria-hidden="true">↗</span></Link></li>)}
        </ul>
        {!attention.length && !noContacts.length && <p className="admin-empty">You’re up to date. No outstanding actions need your attention.</p>}
        {sortedAttention.length > 8 && <details><summary className="admin-empty">Show {sortedAttention.length - 8} more actions</summary><ul className="admin-action-list">{sortedAttention.slice(8).map(a => <li key={a.key}><Link className="admin-action" href={a.href === "#referrals" ? "/admin/settings#referrals" : a.href}><div><strong>{a.text}</strong></div><span aria-hidden="true">↗</span></Link></li>)}</ul></details>}
      </section>
      <section className="admin-panel admin-section-space"><div className="admin-panel-head"><div><h2>Projects in motion</h2><p>Delivery dates and the next thing to do.</p></div><Link href="/admin/projects">All projects →</Link></div>
       <div className="table-wrap"><table className="admin-projects-table"><thead><tr><th>Project / client</th><th>Stage</th><th>Delivery</th><th>Next action</th></tr></thead><tbody>{upcoming.slice(0,6).map(p => {
         const stale = !lastBy.get(p.id) || now - new Date(lastBy.get(p.id)!).getTime() > STALE_UPDATE_DAYS * DAY;
         const invoice = openInvoices.find(row => row.project.id === p.id);
         const next = invoice ? {label:"Review invoice",url:`/projects/${p.id}/billing`} : stale ? {label:"Post an update",url:`/projects/${p.id}`} : {label:waitingBy.get(p.id) ? "Review client tasks" : "Open project",url:`/projects/${p.id}`};
         return <tr key={p.id}><td><Link href={`/admin/projects/${p.id}`}>{p.name}</Link><small>{grouped.get(p.clientId)?.client.name}</small></td><td><span className="chip">{STATUS_LABEL[p.status]}</span></td><td>{formatDate(p.deliveryDate)}<small>{describeDaysUntil(daysUntil(p.deliveryDate))}</small></td><td><Link href={next.url}>{next.label} ↗</Link></td></tr>;
       })}</tbody></table></div>{!upcoming.length && <p className="admin-empty">No active projects. Add a client to get started.</p>}
      </section>
    </div><aside className="admin-side-stack">
      <section className="admin-panel"><div className="admin-panel-head"><div><h2>Payments to follow up</h2><p>Oldest due dates first.</p></div><Link href="/admin/billing">Billing →</Link></div>
       <ul className="admin-action-list">{[...openInvoices].sort((a,b)=>a.invoice.dueOn.localeCompare(b.invoice.dueOn)).slice(0,5).map(({invoice, project}) => <li key={invoice.id}><Link className="admin-action" href={`/projects/${project.id}/billing/invoices/${invoice.id}`}><div><strong>{grouped.get(project.clientId)?.client.name}</strong><small>{invoice.number} · {invoice.dueOn < today ? "Overdue" : "Due"} {formatDate(invoice.dueOn)}</small></div><strong>{formatMoney(invoice.amountCents, invoice.currency)}</strong></Link></li>)}</ul>
       {!openInvoices.length && <p className="admin-empty">No outstanding invoices.</p>}
      </section>
      <section className="admin-panel"><div className="admin-panel-head"><h2>Quick actions</h2></div><div className="admin-quick-links"><Link href="/admin/onboard">+ Onboard a client</Link><Link href="/admin/billing#create-invoice">↗ Create invoice</Link><Link href="/admin/clients">◎ Manage contacts</Link><Link href="/admin/requests">↗ Review requests</Link></div></section>
      <section className="admin-panel"><div className="admin-panel-head"><h2>Client setup</h2><Link href="/admin/onboard">Manage →</Link></div><ul className="admin-action-list">{onboardingRows.filter(({onboarding:o})=>o.status !== "completed").slice(0,4).map(({onboarding:o,client})=><li key={o.id}><Link className="admin-action" href={`/admin/onboard/${o.projectId}`}><div><strong>{client.name}</strong><small>{!o.welcomeSentAt ? "Welcome ready to send" : "Setup in progress"}</small></div><span aria-hidden="true">↗</span></Link></li>)}</ul>{!onboardingRows.some(({onboarding:o})=>o.status !== "completed") && <p className="admin-empty">No client setups in progress.</p>}</section>
    </aside></div>
  </main>;
}
