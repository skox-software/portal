import { and, asc, desc, eq, inArray } from "drizzle-orm";
import Link from "next/link";
import { requireStaff } from "@/lib/access";
import { getDb } from "@/lib/db";
import { clients, events, invoices, memberships, projects, supportRequests } from "@/lib/db/schema";
import { formatDate, formatDateTime, formatMoney, STATUS_LABEL, todayIso } from "@/lib/format";
import { createClient } from "@/app/admin/actions";
import { Notice, readMessage } from "@/components/Notice";

type Section = "clients" | "projects" | "requests" | "activity";
type Params = Record<string, string | string[] | undefined>;
const descriptions = { clients: "Companies, contacts, and payment status in one place.", projects: "Track delivery, manage the work, and open any client project.", requests: "Client questions and changes across your workspace.", activity: "Recent actions across your client projects." };

export async function AdminDirectory({ section, searchParams }: { section: Section; searchParams: Promise<Params> }) {
  const { staff } = await requireStaff();
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim().toLowerCase().slice(0,200) : "";
  const status = typeof sp.status === "string" ? sp.status : "all";
  const db = getDb();
  const [companies, projectList, people, bills] = await Promise.all([
    db.select().from(clients).where(eq(clients.workspaceId, staff.workspaceId)).orderBy(asc(clients.name)),
    db.select().from(projects).where(eq(projects.workspaceId, staff.workspaceId)).orderBy(asc(projects.deliveryDate)),
    section === "clients" ? db.select().from(memberships).where(eq(memberships.workspaceId, staff.workspaceId)) : Promise.resolve([]),
    section === "clients" ? db.select().from(invoices).where(eq(invoices.workspaceId, staff.workspaceId)) : Promise.resolve([]),
  ]);
  const companyBy = new Map(companies.map(c => [c.id, c]));
  const projectBy = new Map(projectList.map(p => [p.id,p]));
  const requests = section === "requests" ? await db.select().from(supportRequests).where(eq(supportRequests.workspaceId, staff.workspaceId)).orderBy(desc(supportRequests.createdAt)) : [];
  const activity = section === "activity" ? await db.select().from(events).where(eq(events.workspaceId, staff.workspaceId)).orderBy(desc(events.createdAt)).limit(100) : [];
  const actorIds = [...new Set(activity.map(e => e.actorId).filter((id): id is string => !!id && id !== "system"))];
  const actors = actorIds.length ? await db.select({ userId: memberships.userId, email: memberships.email }).from(memberships).where(and(eq(memberships.workspaceId, staff.workspaceId), inArray(memberships.userId, actorIds))) : [];
  const actorBy = new Map(actors.map(a => [a.userId,a.email]));
  const matches = (...values: (string | undefined)[]) => values.some(v => v?.toLowerCase().includes(q));
  const filteredClients = companies.filter(c => matches(c.name,...people.filter(p=>p.clientId===c.id).map(p=>p.email)));
  const filteredProjects = projectList.filter(p => matches(p.name,companyBy.get(p.clientId)?.name) && (status === "all" || (status === "active" ? !["paused","launched"].includes(p.status) : p.status === status)));
  const filteredRequests = requests.filter(r => { const p=projectBy.get(r.projectId); return matches(r.title,p?.name,p && companyBy.get(p.clientId)?.name) && (status === "all" || (status === "open" ? r.status !== "done" : r.status === status)); });
  const title = section.charAt(0).toUpperCase()+section.slice(1);
  const options = section === "projects" ? [["all","All stages"],["active","Active projects"],...Object.entries(STATUS_LABEL)] : [["all","All requests"],["open","Open requests"],["new","New"],["done","Completed"]];
  return <main className="shell page"><div className="page-head"><div><p className="eyebrow">SKOX WORKSPACE</p><h1>{title}</h1><p className="muted">{descriptions[section]}</p></div>{section === "clients" && <Link className="btn btn-primary" href="#add-client">+ Add client</Link>}</div>
    <Notice error={readMessage(sp.error)} notice={readMessage(sp.notice)} />
    {section !== "activity" && <form className="admin-filter" action={`/portal/admin/${section}`}><label className="sr-only" htmlFor="directory-search">Search {section}</label><input id="directory-search" name="q" placeholder={`Search ${section}${section === "clients" ? " or email address" : " or company"}…`} defaultValue={q} />{section !== "clients" && <><label className="sr-only" htmlFor="directory-status">Filter by status</label><select id="directory-status" name="status" defaultValue={status}>{options.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></>}<button className="btn btn-primary">Search</button>{(q || status !== "all") && <Link href={`/admin/${section}`} className="btn btn-ghost">Clear</Link>}</form>}
    <section className="admin-panel admin-directory"><div className="table-wrap"><table className="admin-projects-table">
      {section === "clients" && <><thead><tr><th>Company</th><th>Invoice contacts</th><th>Projects</th><th>Outstanding</th><th>Manage</th></tr></thead><tbody>{filteredClients.map(c => {
        const contacts=people.filter(p=>p.clientId===c.id && ["client_member","client_approver"].includes(p.role));
        const ids=new Set(projectList.filter(p=>p.clientId===c.id).map(p=>p.id));
        const amount=bills.filter(i=>ids.has(i.projectId)&&i.status==="open").reduce((n,i)=>n+i.amountCents,0);
        return <tr key={c.id}><td><div className="admin-client-name"><span className="admin-avatar" aria-hidden="true">{c.name.slice(0,2).toUpperCase()}</span><Link href={`/admin/clients/${c.id}`}>{c.name}</Link></div></td><td>{contacts.length ? <><span>{contacts[0].email}</span><small>{contacts.length > 1 ? `+ ${contacts.length-1} more contacts` : "1 client contact"}</small></> : <Link href={`/admin/clients/${c.id}#invite-title`} className="chip chip-amber">+ Add a contact</Link>}</td><td>{ids.size}</td><td>{formatMoney(amount)}</td><td><Link href={`/admin/clients/${c.id}`}>Open client ↗</Link></td></tr>;
      })}</tbody></>}
      {section === "projects" && <><thead><tr><th>Project</th><th>Company</th><th>Stage</th><th>Delivery</th><th>Quick actions</th></tr></thead><tbody>{filteredProjects.map(p=><tr key={p.id}><td><Link href={`/admin/projects/${p.id}`}>{p.name}</Link></td><td><Link href={`/admin/clients/${p.clientId}`}>{companyBy.get(p.clientId)?.name}</Link></td><td><span className="chip">{STATUS_LABEL[p.status]}</span></td><td>{formatDate(p.deliveryDate)}{p.deliveryDate < todayIso() && !["launched","paused"].includes(p.status) && <small>Past delivery date</small>}</td><td><div className="row"><Link href={`/projects/${p.id}`}>Workspace ↗</Link><Link href={`/projects/${p.id}/billing`}>Billing</Link></div></td></tr>)}</tbody></>}
      {section === "requests" && <><thead><tr><th>Request / company</th><th>Project</th><th>Priority</th><th>Status</th><th>Received</th></tr></thead><tbody>{filteredRequests.map(r=>{ const p=projectBy.get(r.projectId); return <tr key={r.id}><td><Link href={`/projects/${r.projectId}/support#r-${r.id}`}>{r.title}</Link><small>{p && companyBy.get(p.clientId)?.name}</small></td><td>{p?.name}</td><td><span className={`chip ${r.priority === "urgent" ? "chip-danger" : ""}`}>{r.priority}</span></td><td>{r.status.replaceAll("_"," ")}</td><td>{formatDateTime(r.createdAt)}</td></tr>;})}</tbody></>}
      {section === "activity" && <><thead><tr><th>Action</th><th>Company / project</th><th>By</th><th>When</th></tr></thead><tbody>{activity.map(e=>{const p=e.projectId ? projectBy.get(e.projectId) : null; const payload=e.payload as Record<string,unknown>; return <tr key={e.id}><td>{e.verb.replaceAll("."," · ").replaceAll("_"," ")}<small>{typeof payload.title === "string" ? payload.title : typeof payload.number === "string" ? payload.number : ""}</small></td><td>{p ? <Link href={`/admin/projects/${p.id}`}>{companyBy.get(p.clientId)?.name}<small>{p.name}</small></Link> : "Workspace"}</td><td>{e.actorId === "system" ? "System" : actorBy.get(e.actorId) ?? "Account no longer linked"}</td><td>{formatDateTime(e.createdAt)}</td></tr>;})}</tbody></>}
    </table></div>{(section === "clients" ? !filteredClients.length : section === "projects" ? !filteredProjects.length : section === "requests" ? !filteredRequests.length : !activity.length) && <p className="admin-empty">{q || status !== "all" ? "No matches. Try another search or clear the filters." : `No ${section} to show yet.`}</p>}</section>
    {section === "activity" && <p className="small muted admin-section-space">Showing the latest 100 recorded workspace actions.</p>}
    {section === "clients" && <details className="card admin-section-space" id="add-client"><summary>Add a company</summary><form action={createClient} className="stack admin-section-space"><div className="field"><label htmlFor="new-company">Company name</label><input id="new-company" name="name" maxLength={120} required placeholder="Company name" /></div><div><button className="btn btn-primary">Add client</button></div></form></details>}
  </main>;
}
