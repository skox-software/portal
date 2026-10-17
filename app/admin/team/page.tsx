import { eq, desc } from "drizzle-orm";
import Link from "next/link";
import { Notice, readMessage } from "@/components/Notice";
import { requireStaff } from "@/lib/access";
import { getDb } from "@/lib/db";
import { clients, deals, events, memberships } from "@/lib/db/schema";
import { formatDate, formatMoney } from "@/lib/format";
import { inviteEmployee, setMemberAccess } from "./actions";
export const metadata = { title: "People & access" };
export default async function TeamPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { staff } = await requireStaff();
  const sp = await searchParams;
  const db = getDb();
  const [people, leads, activity] = await Promise.all([
    db.select({ member: memberships, client: clients.name }).from(memberships).leftJoin(clients, eq(clients.id, memberships.clientId)).where(eq(memberships.workspaceId, staff.workspaceId)).orderBy(memberships.createdAt),
    db.select().from(deals).where(eq(deals.workspaceId, staff.workspaceId)),
    db.select().from(events).where(eq(events.workspaceId, staff.workspaceId)).orderBy(desc(events.createdAt)).limit(1000),
  ]);
  return <main className="shell page">
    <div className="page-head"><div><p className="eyebrow">Admin Portal</p><h1>People & access</h1><p className="muted">Manage your team and clients. Employees see only the leads assigned to them.</p></div><Link href="/admin/pipeline?import=1" className="btn btn-primary">Import & assign leads</Link></div>
    <Notice error={readMessage(sp.error)} notice={readMessage(sp.notice)} />
    <section className="card stack"><h2>Invite an employee</h2><p className="muted">Approve their email first, then share the sign-in link. Employees cannot invite themselves or access business administration.</p><form action={inviteEmployee} className="form-row"><label>Email address<input name="email" type="email" required placeholder="employee@example.com" /></label><button className="btn btn-primary" type="submit">Grant employee access</button></form></section>
    <section className="card table-wrap" style={{ marginTop: 24 }}><table><thead><tr><th>Account / email</th><th>Portal</th><th>Access</th><th>Signed up</th><th>Pipeline / activity</th><th>Controls</th></tr></thead><tbody>{people.map(({ member: m, client }) => {
      const own = leads.filter(d => d.ownerEmail === m.email && !["won", "lost"].includes(d.stage));
      const calls = activity.filter(e => e.actorId === m.userId && e.verb === "deal.call_logged");
      const connections = calls.filter(e => (e.payload as { outcome?: string })?.outcome === "spoke");
      return <tr key={m.id}><td><strong>{m.email}</strong><div className="muted small">{client || "SKOX team"}</div></td><td>{m.role === "staff_owner" ? "Admin" : m.role === "staff" ? "Employee" : "Client"}</td><td><span className="chip">{m.revokedAt ? "Revoked" : m.acceptedAt ? "Active" : "Invited"}</span></td><td>{m.acceptedAt ? formatDate(m.acceptedAt.toISOString().slice(0, 10)) : "Not yet"}</td><td>{!m.clientId && <><strong>{formatMoney(own.reduce((sum, d) => sum + (d.valueCents ?? 0), 0))}</strong><div className="small muted">{own.length} open leads · {calls.length} calls · {connections.length} connections</div><small>From the latest 1,000 workspace events</small></>}</td><td><div className="stack">{!m.revokedAt && !m.clientId && <Link href={`/sales?member=${m.id}`}>View pipeline →</Link>}{m.clientId && <Link href={`/admin/clients/${m.clientId}`}>View client →</Link>}{m.role !== "staff_owner" && <form action={setMemberAccess}><input type="hidden" name="membershipId" value={m.id} /><input type="hidden" name="action" value={m.revokedAt ? "restore" : "revoke"} /><button className="btn btn-ghost btn-small">{m.revokedAt ? "Restore access" : "Revoke access"}</button></form>}</div></td></tr>;
    })}</tbody></table></section>
  </main>;
}
