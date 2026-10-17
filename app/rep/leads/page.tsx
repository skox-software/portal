import Link from "next/link";
import { Notice, readMessage } from "@/components/Notice";
import { LeadRow } from "@/components/rep/LeadRow";
import { requireRep } from "@/lib/access";
import { followUpState, salesToday } from "@/lib/follow-up";
import { myLeads, type RepLead } from "@/lib/rep-data";
import { REP_STATUSES, repCanWork } from "@/lib/rep-status";

export const metadata = { title: "Leads" };

export default async function RepLeads({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const { rep } = await requireRep();
  const leads = await myLeads(rep);
  const today = salesToday();
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const view = ["due", "mine"].includes(str("view")) ? str("view") : "all";
  const status = REP_STATUSES.some((s) => s.value === str("status")) ? str("status") : "";
  const q = str("q").trim().toLowerCase();

  const isDue = (l: RepLead) => repCanWork(l.status) && ["overdue", "today"].includes(followUpState(l.nextStepOn, today));
  const inView = (l: RepLead) => (view === "due" ? isDue(l) : view === "mine" ? l.repSource === "self" : true);
  const matches = (l: RepLead) => !q || [l.company, l.contactName, l.contactEmail, l.phone, l.industry, l.location].some((v) => v?.toLowerCase().includes(q));
  const shown = leads.filter((l) => inView(l) && matches(l) && (!status || l.status === status));
  const groups = REP_STATUSES.map((s) => ({ ...s, rows: shown.filter((l) => l.status === s.value) })).filter((g) => g.rows.length);
  const link = (next: Record<string, string>) => {
    const p = new URLSearchParams({ ...(view !== "all" ? { view } : {}), ...(status ? { status } : {}), ...(q ? { q } : {}), ...next });
    for (const [k, v] of [...p.entries()]) if (!v) p.delete(k);
    const s = p.toString();
    return `/rep/leads${s ? `?${s}` : ""}`;
  };

  return (
    <>
      <p className="rp-kicker">Your pipeline</p>
      <h1 className="rp-title">Leads</h1>
      <p className="rp-lede">Every business SKOX handed you and every one you brought. Tap a name to log a call or book the scope call.</p>
      <Notice error={readMessage(sp.error)} notice={readMessage(sp.notice)} />

      <div className="rp-tools">
        <nav className="rp-views" aria-label="Views">
          <Link href={link({ view: "", status: "" })} aria-current={view === "all" && !status ? "page" : undefined}>All<span>{leads.length}</span></Link>
          <Link href={link({ view: "due", status: "" })} aria-current={view === "due" ? "page" : undefined}>Due<span>{leads.filter(isDue).length}</span></Link>
          <Link href={link({ view: "mine", status: "" })} aria-current={view === "mine" ? "page" : undefined}>I brought<span>{leads.filter((l) => l.repSource === "self").length}</span></Link>
          {REP_STATUSES.map((s) => (
            <Link key={s.value} href={link({ view: "", status: s.value })} aria-current={status === s.value ? "page" : undefined}>
              {s.label}<span>{leads.filter((l) => l.status === s.value).length}</span>
            </Link>
          ))}
        </nav>
        <form className="rp-search" role="search">
          {view !== "all" && <input type="hidden" name="view" value={view} />}
          {status && <input type="hidden" name="status" value={status} />}
          <label className="sr-only" htmlFor="rp-q">Search leads</label>
          <input id="rp-q" name="q" defaultValue={q} placeholder="Search business, contact, phone or city" />
        </form>
      </div>

      {groups.length === 0 ? (
        <p className="rp-empty">
          {leads.length === 0 ? <>No leads yet. <Link href="/rep/leads/new">Add one you know</Link>, or watch for new ones from SKOX.</> : "Nothing matches that."}
        </p>
      ) : (
        groups.map((g) => (
          <section key={g.value} className="rp-group" data-status={g.value} aria-label={g.label}>
            <h3><span><i />{g.label}</span><span>{g.rows.length}</span></h3>
            <ul className="rp-leads">{g.rows.map((l) => <LeadRow key={l.id} lead={l} today={today} />)}</ul>
          </section>
        ))
      )}
    </>
  );
}
