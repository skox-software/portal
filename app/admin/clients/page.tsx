import { and, eq, isNotNull, sql } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/app/admin/actions";
import { ClientsList, type ClientRow, type ClientGroup } from "@/components/ClientsList";
import { DealPanel } from "@/components/DealPanel";
import { Notice, readMessage } from "@/components/Notice";
import { requireStaff } from "@/lib/access";
import { getDb } from "@/lib/db";
import { emailThreads, events } from "@/lib/db/schema";
import { nowMs } from "@/lib/format";
import { loadEmailStatuses } from "@/lib/email-status-data";
import { describeFollowUp, followUpState, salesToday, untouchedFor } from "@/lib/follow-up";
import { daysSince, PRESALE, searchText, STALL_DAYS, type Card, type ColumnKey } from "@/lib/pipeline";
import { loadPipeline } from "@/lib/pipeline-data";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Clients · SKOX" };

type Stage = ColumnKey | "lost" | "none";

/** Saved views: the ways the team works the list. */
const VIEWS = [
  { key: "all", label: "All" },
  { key: "open", label: "Open deals" },
  { key: "mine", label: "My leads" },
  { key: "due", label: "Due today" },
  { key: "untouched", label: "Untouched 7+ days" },
] as const;
type View = (typeof VIEWS)[number]["key"];

/** The order status groups appear in. */
const GROUPS: { key: Stage; label: string }[] = [
  { key: "lead", label: "Lead" },
  { key: "initial_outreach", label: "Initial outreach" },
  { key: "proposal_sent", label: "Proposal sent" },
  { key: "negotiation", label: "Negotiation" },
  { key: "won", label: "Won" },
  { key: "in_build", label: "In build" },
  { key: "shipped", label: "Shipped" },
  { key: "none", label: "No project yet" },
  { key: "lost", label: "Lost" },
];
const OLD_STAGE_VIEWS = new Set(["lead", "initial_outreach", "shipped", "lost"]);

function sourceLabel(card: Card) {
  if (card.leadSource) return card.leadSource;
  if (card.type === "referral" || card.source === "referral") return "Referral";
  if (card.source === "import") return "Imported";
  return null;
}

export default async function ClientsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const { viewer, staff } = await requireStaff();
  const ws = staff.workspaceId;
  const db = getDb();
  const [{ columns, lost, clientRows, dealRows, projectRows, owners, reps }, projectTouches, dealTouches, clientMail, dealMail, emailStatuses] = await Promise.all([
    loadPipeline(ws),
    db
      .select({ id: events.projectId, at: sql<Date>`max(${events.createdAt})` })
      .from(events)
      .where(and(eq(events.workspaceId, ws), isNotNull(events.projectId)))
      .groupBy(events.projectId),
    db
      .select({ id: events.subjectId, at: sql<Date>`max(${events.createdAt})` })
      .from(events)
      .where(and(eq(events.workspaceId, ws), eq(events.subjectType, "deal")))
      .groupBy(events.subjectId),
    db
      .select({ id: emailThreads.clientId, at: sql<Date>`max(${emailThreads.lastMessageAt})` })
      .from(emailThreads)
      .where(and(eq(emailThreads.workspaceId, ws), isNotNull(emailThreads.clientId)))
      .groupBy(emailThreads.clientId),
    db
      .select({ id: emailThreads.dealId, at: sql<Date>`max(${emailThreads.lastMessageAt})` })
      .from(emailThreads)
      .where(and(eq(emailThreads.workspaceId, ws), isNotNull(emailThreads.dealId)))
      .groupBy(emailThreads.dealId),
    loadEmailStatuses(ws),
  ]);

  const toMap = (rows: { id: string | null; at: Date | string }[]) => new Map(rows.filter((r) => r.id).map((r) => [r.id!, new Date(r.at)]));
  const projectAt = toMap(projectTouches);
  const dealAt = toMap(dealTouches);
  const clientMailAt = toMap(clientMail);
  const dealMailAt = toMap(dealMail);
  const latest = (...dates: (Date | undefined | null)[]) =>
    dates.filter((d): d is Date => !!d && !Number.isNaN(d.getTime())).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  const now = new Date(nowMs());
  const today = salesToday(now);
  const dealById = new Map(dealRows.map((d) => [d.id, d]));
  const clientById = new Map(clientRows.map((c) => [c.id, c]));
  const repName = new Map(reps.map((r) => [r.id, r.name]));

  // ---- Filters, all in the URL so a lead's panel and every save keep them ----
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).trim().slice(0, 200) : "");
  const rawView = str("view");
  const view: View = VIEWS.some((v) => v.key === rawView) ? (rawView as View) : rawView === "active" ? "open" : "all";
  // Old links (?view=lead) become a status filter.
  const stage = (GROUPS.some((g) => g.key === str("stage")) ? str("stage") : OLD_STAGE_VIEWS.has(rawView) ? rawView : "") as Stage | "";
  const q = str("q").toLowerCase();
  const owner = str("owner");
  const listQuery = (extra: Record<string, string> = {}) => {
    const p = new URLSearchParams();
    if (view !== "all") p.set("view", view);
    if (stage) p.set("stage", stage);
    if (q) p.set("q", q);
    if (owner) p.set("owner", owner);
    for (const [k, v] of Object.entries(extra)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    const s = p.toString();
    return s ? `?${s}` : "";
  };

  const toRow = (card: Card, stage: Stage): ClientRow => {
    const deal = card.type === "deal" ? dealById.get(card.id) : card.dealId ? dealById.get(card.dealId) : undefined;
    const isDeal = card.type === "deal";
    const days = daysSince(card.since, now);
    const lastTouch = latest(
      card.type === "project" ? projectAt.get(card.id) : undefined,
      card.dealId ? dealAt.get(card.dealId) : undefined,
      card.dealId ? dealMailAt.get(card.dealId) : undefined,
      card.clientId ? clientMailAt.get(card.clientId) : undefined,
      deal?.lastContactedAt,
      card.since,
    );
    const working = isDeal && stage !== "won" && stage !== "lost";
    // A lead's reminder lives on the deal (lost ones too: "try again in 3 months"); a client's on the client.
    const client = !isDeal && card.clientId ? clientById.get(card.clientId) : undefined;
    const fuOn = isDeal ? deal?.nextStepOn ?? null : client?.nextStepOn ?? null;
    return {
      key: card.key,
      dealId: isDeal ? card.id : null,
      name: card.company,
      href: card.type === "project" && card.clientId ? `/admin/clients/${card.clientId}` : isDeal ? `/admin/clients${listQuery({ deal: card.id })}` : "/admin/pipeline",
      subtitle: [card.industry, card.location].filter(Boolean).join(" · ") || null,
      contactName: card.contactName,
      contactEmail: card.contactEmail,
      phone: deal?.phone ?? null,
      website: deal?.website ?? null,
      stage,
      valueCents: card.valueCents,
      days,
      slow: PRESALE.includes(stage as ColumnKey) && days > STALL_DAYS,
      source: sourceLabel(card),
      owner: card.ownerEmail,
      rep: deal?.repMembershipId ? repName.get(deal.repMembershipId) ?? null : null,
      followUp: describeFollowUp(fuOn, today),
      followUpState: followUpState(fuOn, today),
      followUpOn: fuOn,
      nextStep: isDeal ? deal?.nextStep ?? null : client?.nextStep ?? null,
      followUpKind: isDeal ? "deal" : client ? "client" : null,
      followUpId: isDeal ? card.id : client?.id ?? null,
      followUpOwner: isDeal ? card.ownerEmail : client?.nextStepOwner ?? null,
      lastTouch: lastTouch?.toISOString() ?? null,
      contacted: !!deal?.lastContactedAt,
      emailStatus: isDeal ? emailStatuses.get(card.id)?.status ?? null : null,
      untouched: working && PRESALE.includes(stage as ColumnKey) && untouchedFor(deal?.lastContactedAt ?? null, card.since, now, 7),
      search: searchText([card.company, card.contactName, card.contactEmail, deal?.phone, deal?.website, card.location, card.industry, card.leadSource, deal?.notes]),
    };
  };

  const cardRows = [...columns.flatMap((c) => c.cards.map((card) => toRow(card, c.key))), ...lost.map((card) => toRow(card, "lost"))];
  // Companies added by name only, with no project or deal yet.
  const shown = new Set(columns.flatMap((c) => c.cards).concat(lost).map((c) => c.clientId).filter(Boolean));
  const bare: ClientRow[] = clientRows
    .filter((c) => !shown.has(c.id))
    .map((c) => ({
      key: `client:${c.id}`,
      dealId: null,
      name: c.name,
      href: `/admin/clients/${c.id}`,
      subtitle: null,
      contactName: null,
      contactEmail: null,
      phone: null,
      website: null,
      stage: "none",
      valueCents: 0,
      days: null,
      slow: false,
      source: null,
      owner: null,
      rep: null,
      followUp: describeFollowUp(c.nextStepOn, today),
      followUpState: followUpState(c.nextStepOn, today),
      followUpOn: c.nextStepOn,
      nextStep: c.nextStep,
      followUpKind: "client",
      followUpId: c.id,
      followUpOwner: c.nextStepOwner,
      lastTouch: latest(clientMailAt.get(c.id), c.createdAt)?.toISOString() ?? null,
      contacted: false,
      emailStatus: null,
      untouched: false,
      search: c.name.toLowerCase(),
    }));
  const all = [...cardRows, ...bare];

  const inView = (r: ClientRow, v: View) =>
    v === "all" ||
    (v === "open" && !["shipped", "lost", "none"].includes(r.stage)) ||
    (v === "mine" && r.owner === viewer.email && r.stage !== "lost") ||
    (v === "due" && (r.followUpState === "overdue" || r.followUpState === "today")) ||
    (v === "untouched" && r.untouched);
  const matches = (r: ClientRow) =>
    (!q || q.split(/\s+/).every((w) => r.search.includes(w))) && (!owner || (owner === "none" ? !r.owner : r.owner === owner));
  const base = all.filter((r) => inView(r, view) && matches(r));
  const rows = base.filter((r) => !stage || r.stage === stage);

  // Within a status: follow-ups due first, then the soonest follow-up, then most recently touched.
  const rank = { overdue: 0, today: 1, upcoming: 2, none: 3 } as const;
  const order = (a: ClientRow, b: ClientRow) =>
    rank[a.followUpState] - rank[b.followUpState] ||
    (a.followUpOn ?? "9999").localeCompare(b.followUpOn ?? "9999") ||
    (b.lastTouch ?? "").localeCompare(a.lastTouch ?? "");
  const groups: ClientGroup[] = GROUPS.map((g) => ({ ...g, rows: rows.filter((r) => r.stage === g.key).sort(order) })).filter((g) => g.rows.length);

  // ---- The open lead, with next and previous inside its status ----
  const editing = str("deal") ? dealRows.find((d) => d.id === str("deal")) ?? null : null;
  const creating = sp.new === "1";
  const linked = editing?.projectId ? projectRows.find((p) => p.project.id === editing.projectId) : null;
  const group = editing ? groups.find((g) => g.rows.some((r) => r.dealId === editing.id)) : undefined;
  const workable = group ? group.rows.filter((r) => r.dealId) : [];
  const at = editing ? workable.findIndex((r) => r.dealId === editing.id) : -1;
  const next = at >= 0 ? workable[at + 1] : undefined;
  const prev = at > 0 ? workable[at - 1] : undefined;
  const closeHref = `/admin/clients${listQuery()}`;
  const panelOpen = Boolean(editing || creating);

  const viewHref = (v: View) => `/admin/clients${listQuery({ view: v === "all" ? "" : v, stage: "" }).replace(/^\?$/, "")}`;
  const stageHref = (s: Stage | "") => `/admin/clients${listQuery({ stage: s })}`;

  return (
    <main className="shell page crm-page">
      <div className="crm-head">
        <div>
          <p className="eyebrow">Sales</p>
          <h1>Clients</h1>
        </div>
        <nav className="crm-views" aria-label="Views">
          {VIEWS.map((v) => {
            const n = all.filter((r) => inView(r, v.key)).length;
            return (
              <Link key={v.key} href={viewHref(v.key)} aria-current={view === v.key ? "page" : undefined} data-alert={v.key === "due" && n ? "" : undefined}>
                {v.label}
                <span>{n}</span>
              </Link>
            );
          })}
        </nav>
      </div>
      {!panelOpen && <Notice error={readMessage(sp.error)} notice={readMessage(sp.notice)} />}

      <div className="crm-split" data-panel={panelOpen ? "" : undefined}>
        <div className="crm-split-list">
          <form className="admin-filter crm-filter" action="/portal/admin/clients">
            {view !== "all" && <input type="hidden" name="view" value={view} />}
            {stage && <input type="hidden" name="stage" value={stage} />}
            <label className="sr-only" htmlFor="crm-search">
              Search clients
            </label>
            <input id="crm-search" name="q" type="search" defaultValue={q} placeholder="Search company, contact, phone, city, notes…  ( / )" />
            <label className="sr-only" htmlFor="crm-owner">
              Owner
            </label>
            <select id="crm-owner" name="owner" defaultValue={owner} data-autosubmit="">
              <option value="">Everyone&apos;s</option>
              <option value={viewer.email}>Mine</option>
              {owners
                .filter((o) => o !== viewer.email)
                .map((o) => (
                  <option key={o} value={o}>
                    {o.split("@")[0]}&apos;s
                  </option>
                ))}
              <option value="none">Unassigned</option>
            </select>
            <button className="btn btn-ghost">Search</button>
            {(q || owner) && (
              <Link className="btn btn-ghost" href={`/admin/clients${listQuery({ q: "", owner: "" })}`}>
                Clear
              </Link>
            )}
            <Link className="btn btn-primary" href={`/admin/clients${listQuery({ new: "1" })}`} scroll={false}>
              + New deal
            </Link>
          </form>

          <nav className="crm-stages" aria-label="Status">
            <Link href={stageHref("")} aria-current={!stage ? "page" : undefined}>
              All statuses <span>{base.length}</span>
            </Link>
            {GROUPS.map((g) => {
              const n = base.filter((r) => r.stage === g.key).length;
              if (!n && stage !== g.key) return null;
              return (
                <Link key={g.key} href={stageHref(g.key)} aria-current={stage === g.key ? "page" : undefined} data-stage={g.key}>
                  <i aria-hidden="true" />
                  {g.label} <span>{n}</span>
                </Link>
              );
            })}
          </nav>

          <ClientsList
            groups={groups}
            openDealId={editing?.id ?? null}
            panelOpen={panelOpen}
            owners={owners}
            reps={reps}
            me={viewer.email}
            today={today}
            empty={
              view === "due" && !q && !owner && !stage
                ? "Nothing due. Set a reminder on any lead or client with + Remind and it shows up here on its day."
                : q || owner || view !== "all" || stage
                  ? "No matches. Try another search or view."
                  : "No clients or leads yet. Add a deal or onboard a client."
            }
          />

          <details className="card admin-section-space" id="add-client">
            <summary>Add a company by name only</summary>
            <form action={createClient} className="stack admin-section-space">
              <div className="field">
                <label htmlFor="new-company">Company name</label>
                <input id="new-company" name="name" maxLength={120} required placeholder="Company name" />
              </div>
              <div>
                <button className="btn btn-primary">Add company</button>
              </div>
            </form>
          </details>
        </div>

        {panelOpen && (
          <aside className="crm-split-panel" id="deal-form" aria-labelledby="deal-form-title">
            <DealPanel
              deal={editing}
              owners={owners}
              reps={reps}
              me={viewer.email}
              linkedProject={linked ? { id: linked.project.id, name: linked.project.name } : null}
              nav={{
                base: "/admin/clients",
                back: listQuery(),
                closeHref,
                nextId: next?.dealId ?? null,
                nextHref: next?.dealId ? `/admin/clients${listQuery({ deal: next.dealId })}` : null,
                prevHref: prev?.dealId ? `/admin/clients${listQuery({ deal: prev.dealId })}` : null,
                position: group && at >= 0 ? `${at + 1} of ${workable.length} in ${group.label}` : null,
              }}
              today={today}
              now={now}
              notice={readMessage(sp.notice)}
              error={readMessage(sp.error)}
            />
          </aside>
        )}
      </div>
    </main>
  );
}
