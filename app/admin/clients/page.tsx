import { and, eq, isNotNull, sql } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/app/admin/actions";
import { Notice, readMessage } from "@/components/Notice";
import { requireStaff } from "@/lib/access";
import { getDb } from "@/lib/db";
import { emailThreads, events } from "@/lib/db/schema";
import { formatMoney, nowMs } from "@/lib/format";
import { columnLabel, daysSince, initials, STALL_DAYS, type Card, type ColumnKey } from "@/lib/pipeline";
import { loadPipeline } from "@/lib/pipeline-data";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Clients · SKOX" };

type Stage = ColumnKey | "lost" | "none";
type Row = {
  key: string;
  name: string;
  href: string;
  subtitle: string | null;
  contactName: string | null;
  contactEmail: string | null;
  stage: Stage;
  valueCents: number;
  days: number | null;
  source: string | null;
  owner: string | null;
  lastTouch: Date | null;
};

const VIEWS = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "shipped", label: "Shipped" },
  { key: "lost", label: "Lost" },
] as const;
type View = (typeof VIEWS)[number]["key"];

const stageLabel = (stage: Stage) => (stage === "lost" ? "Lost" : stage === "none" ? "No project yet" : columnLabel(stage));

function sourceLabel(card: Card) {
  if (card.leadSource) return card.leadSource;
  if (card.type === "referral" || card.source === "referral") return "Referral";
  if (card.source === "import") return "Imported";
  return null;
}

const shortDate = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export default async function ClientsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const { staff } = await requireStaff();
  const ws = staff.workspaceId;
  const db = getDb();
  const [{ columns, lost, clientRows }, projectTouches, dealTouches, clientMail, dealMail] = await Promise.all([
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
  ]);

  const toMap = (rows: { id: string | null; at: Date | string }[]) => new Map(rows.filter((r) => r.id).map((r) => [r.id!, new Date(r.at)]));
  const projectAt = toMap(projectTouches);
  const dealAt = toMap(dealTouches);
  const clientMailAt = toMap(clientMail);
  const dealMailAt = toMap(dealMail);
  const latest = (...dates: (Date | undefined | null)[]) =>
    dates.filter((d): d is Date => !!d && !Number.isNaN(d.getTime())).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  const now = new Date(nowMs());

  const toRow = (card: Card, stage: Stage): Row => ({
    key: card.key,
    name: card.company,
    href:
      card.type === "project" && card.clientId
        ? `/admin/clients/${card.clientId}`
        : card.type === "deal"
          ? `/admin/pipeline?deal=${card.id}#deal-form`
          : "/admin/pipeline",
    subtitle: [card.industry, card.location].filter(Boolean).join(" · ") || null,
    contactName: card.contactName,
    contactEmail: card.contactEmail,
    stage,
    valueCents: card.valueCents,
    days: daysSince(card.since, now),
    source: sourceLabel(card),
    owner: card.ownerEmail,
    lastTouch: latest(
      card.type === "project" ? projectAt.get(card.id) : undefined,
      card.dealId ? dealAt.get(card.dealId) : undefined,
      card.dealId ? dealMailAt.get(card.dealId) : undefined,
      card.clientId ? clientMailAt.get(card.clientId) : undefined,
      card.since,
    ),
  });

  const cardRows = [...columns.flatMap((c) => c.cards.map((card) => toRow(card, c.key))), ...lost.map((card) => toRow(card, "lost"))];
  // Companies added by name only, with no project or deal yet.
  const shown = new Set(columns.flatMap((c) => c.cards).concat(lost).map((c) => c.clientId).filter(Boolean));
  const bare: Row[] = clientRows
    .filter((c) => !shown.has(c.id))
    .map((c) => ({
      key: `client:${c.id}`,
      name: c.name,
      href: `/admin/clients/${c.id}`,
      subtitle: null,
      contactName: null,
      contactEmail: null,
      stage: "none",
      valueCents: 0,
      days: null,
      source: null,
      owner: null,
      lastTouch: latest(clientMailAt.get(c.id), c.createdAt),
    }));
  const all = [...cardRows, ...bare].sort((a, b) => (b.lastTouch?.getTime() ?? 0) - (a.lastTouch?.getTime() ?? 0));

  const view: View = VIEWS.some((v) => v.key === sp.view) ? (sp.view as View) : "all";
  const q = typeof sp.q === "string" ? sp.q.trim().toLowerCase().slice(0, 200) : "";
  const matchesView = (r: Row, v: View) =>
    v === "all" ||
    (v === "active" && !["shipped", "lost"].includes(r.stage)) ||
    (v === "shipped" && r.stage === "shipped") ||
    (v === "lost" && r.stage === "lost");
  const rows = all.filter(
    (r) => matchesView(r, view) && (!q || [r.name, r.contactName, r.contactEmail, r.subtitle, r.source].some((v) => v?.toLowerCase().includes(q))),
  );
  const href = (next: View) => {
    const params = new URLSearchParams({ ...(next !== "all" ? { view: next } : {}), ...(q ? { q } : {}) }).toString();
    return params ? `/admin/clients?${params}` : "/admin/clients";
  };

  return (
    <main className="shell page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Sales</p>
          <h1>Clients</h1>
        </div>
        <nav className="crm-views" aria-label="Show">
          {VIEWS.map((v) => (
            <Link key={v.key} href={href(v.key)} aria-current={view === v.key ? "page" : undefined}>
              {v.label}
              <span>{all.filter((r) => matchesView(r, v.key)).length}</span>
            </Link>
          ))}
        </nav>
      </div>
      <Notice error={readMessage(sp.error)} notice={readMessage(sp.notice)} />

      <form className="admin-filter" action="/portal/admin/clients">
        {view !== "all" && <input type="hidden" name="view" value={view} />}
        <label className="sr-only" htmlFor="crm-search">Search clients</label>
        <input id="crm-search" name="q" defaultValue={q} placeholder="Search company, contact, email or source…" />
        <button className="btn btn-ghost">Search</button>
        <Link className="btn btn-ghost" href="/admin/pipeline?new=1#deal-form">New deal</Link>
        <Link className="btn btn-primary" href="/admin/onboard">Add client</Link>
      </form>

      <section className="crm-table-card">
        {rows.length ? (
          <table className="crm-table">
            <thead>
              <tr>
                <th>Client</th>
                <th>Contact</th>
                <th>Stage</th>
                <th className="crm-num">Value</th>
                <th>In stage</th>
                <th>Source</th>
                <th>Owner</th>
                <th>Last touch</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const slow = r.days !== null && r.days > STALL_DAYS && !["shipped", "lost", "none"].includes(r.stage);
                return (
                  <tr key={r.key}>
                    <td className="crm-client">
                      <Link href={r.href}>{r.name}</Link>
                      {r.subtitle && <small>{r.subtitle}</small>}
                    </td>
                    <td className="crm-contact">
                      {r.contactName || r.contactEmail ? (
                        <>
                          <span>{r.contactName ?? r.contactEmail}</span>
                          {r.contactName && r.contactEmail && <small>{r.contactEmail}</small>}
                        </>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="crm-stage-cell" data-label="Stage">
                      <span className="crm-stage" data-stage={r.stage}>
                        <i aria-hidden="true" />
                        {stageLabel(r.stage)}
                      </span>
                    </td>
                    <td className="crm-num crm-mono" data-label="Value">{r.valueCents ? formatMoney(r.valueCents) : "—"}</td>
                    <td className="crm-mono" data-label="In stage">
                      <span className={slow ? "crm-slow" : undefined}>{r.days === null ? "—" : `${r.days}d`}</span>
                    </td>
                    <td data-label="Source">{r.source ?? <span className="muted">—</span>}</td>
                    <td data-label="Owner">
                      {r.owner ? (
                        <span className="crm-owner" title={r.owner} data-tone={initials(r.owner).charCodeAt(0) % 2 ? "amber" : "ink"}>
                          {initials(r.owner)}
                        </span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="crm-mono" data-label="Last touch">{r.lastTouch ? shortDate(r.lastTouch) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p className="admin-empty">{q || view !== "all" ? "No matches. Try another search or view." : "No clients or leads yet. Add a deal or onboard a client."}</p>
        )}
      </section>

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
    </main>
  );
}
