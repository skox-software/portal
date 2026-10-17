import { and, desc, eq, inArray } from "drizzle-orm";
import Link from "next/link";
import { Notice, readMessage } from "@/components/Notice";
import { salesContext, assignedDeals } from "@/lib/sales-access";
import { getDb } from "@/lib/db";
import { deals, events, projects } from "@/lib/db/schema";
import { COLUMNS, columnForProject } from "@/lib/pipeline";
import { OUTREACH_STAGES, OPPORTUNITY_STAGES } from "@/lib/sales-permissions";
import { OUTCOMES, outcomeLabel } from "@/lib/follow-up";
import { formatMoney, formatDateTime } from "@/lib/format";
import { updateSalesDeal } from "./actions";
export const metadata = { title: "Sales pipeline" };
const labels: Record<string, string> = { ...Object.fromEntries(COLUMNS.map(c => [c.key, c.label])), lost: "Closed lost" };
export default async function SalesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const { member, selected } = await salesContext(typeof sp.member === "string" ? sp.member : undefined);
  const db = getDb();
  const rows = await db.select({ deal: deals, projectStatus: projects.status }).from(deals).leftJoin(projects, and(eq(projects.id, deals.projectId), eq(projects.workspaceId, selected.workspaceId))).where(assignedDeals(selected.workspaceId, selected.email)).orderBy(desc(deals.stageChangedAt));
  const ids = rows.map(r => r.deal.id);
  const history = ids.length ? await db.select().from(events).where(and(eq(events.workspaceId, selected.workspaceId), eq(events.subjectType, "deal"), inArray(events.subjectId, ids))).orderBy(desc(events.createdAt)).limit(100) : [];
  const cards = rows.map(r => ({ ...r.deal, lane: r.projectStatus ? columnForProject(r.projectStatus) : r.deal.stage }));
  const calls = history.filter(e => e.verb === "deal.call_logged");
  return <main className="shell page"><div className="page-head"><div><p className="eyebrow">{selected.email}</p><h1>{member.id === selected.id ? "Your sales pipeline" : "Employee pipeline"}</h1><p className="muted">Follow up, send proposals, and close. Reiss and Josh take over the build after a win.</p></div>{member.role === "staff_owner" && <Link href="/admin/pipeline?import=1" className="btn btn-primary">Import & assign</Link>}</div><Notice error={readMessage(sp.error)} notice={readMessage(sp.notice)} />
    <div className="sales-stats"><div className="card">Assigned leads<strong>{cards.length}</strong></div><div className="card">Potential income<strong>{formatMoney(cards.filter(d => !["won", "lost", "in_build", "shipped"].includes(d.lane)).reduce((sum,d) => sum + (d.valueCents ?? 0),0))}</strong></div><div className="card">Calls logged<strong>{calls.length}</strong></div><div className="card">Connections<strong>{calls.filter(e => (e.payload as { outcome?: string }).outcome === "spoke").length}</strong></div></div>
    <p className="small muted">Activity totals reflect the latest 100 events on these assigned leads.</p>
    {[{ title: "Outreach", description: "Work through follow-ups. Interested leads can move to Proposal sent; proposals can return here for more follow-up.", lanes: OUTREACH_STAGES }, { title: "Opportunities & delivery", description: "Close the deal, then follow its progress as the admin team builds and ships.", lanes: OPPORTUNITY_STAGES }].map(section => <section className="sales-section" key={section.title}><h2>{section.title}</h2><p className="muted">{section.description}</p><div className="sales-lanes">{section.lanes.map(lane => <div className="sales-lane" key={lane}><h3>{labels[lane]} <span>{cards.filter(d=>d.lane===lane).length}</span></h3>{cards.filter(d=>d.lane===lane).map(d => {
      const handedOff = Boolean(d.projectId) || (member.role !== "staff_owner" && d.stage === "won");
      return <article className="sales-lead" key={d.id}><h4>{d.company}</h4><div className="small muted">{d.contactName || d.contactEmail || "No contact yet"}</div><p>{formatMoney(d.valueCents ?? 0)}</p>{d.phone && <a href={`tel:${d.phone}`}>{d.phone}</a>}{d.contactEmail && <div><a href={`mailto:${d.contactEmail}`}>{d.contactEmail}</a></div>}{d.nextStep && <p className="small">{d.nextStep}{d.nextStepOn ? ` · ${d.nextStepOn}` : ""}</p>}{handedOff ? <p className="small muted">With the admin build team</p> : <details><summary>Log a call / update lead</summary><form action={updateSalesDeal}><input type="hidden" name="id" value={d.id} /><label>Stage<select name="stage" defaultValue={d.stage}>{[...OUTREACH_STAGES,"proposal_sent","negotiation","won"].map(s=><option key={s} value={s}>{labels[s]}</option>)}</select></label><label>Call / connection<select name="outcome" defaultValue=""><option value="">No call to log</option>{OUTCOMES.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select></label><label>Notes<textarea name="note" maxLength={1000} /></label><label>Next action<input name="nextStep" defaultValue={d.nextStep ?? ""} maxLength={200}/></label><label>Follow-up date<input name="nextStepOn" type="date" defaultValue={d.nextStepOn ?? ""}/></label><button className="btn btn-primary btn-small">Save update</button></form></details>}</article>;
    })}</div>)}</div></section>)}
    <section className="card stack sales-section"><h2>Calls & activity</h2>{history.length === 0 ? <p className="muted">Your calls and lead updates will appear here.</p> : history.map(e => { const p = e.payload as { company?: string; outcome?: string; note?: string; to?: string }; return <div key={e.id}><strong>{p.company || "Lead update"}</strong> · {p.outcome ? outcomeLabel(p.outcome) : p.to ? labels[p.to] || p.to : e.verb}<div className="small muted">{formatDateTime(e.createdAt)}</div>{p.note && <p>{p.note}</p>}</div>; })}</section>
  </main>;
}
