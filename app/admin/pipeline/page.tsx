import type { Metadata } from "next";
import Link from "next/link";
import { BulkLeadForm } from "@/components/BulkLeadForm";
import { Notice, readMessage } from "@/components/Notice";
import { DrawerEscape } from "@/components/DrawerEscape";
import { PipelineBoard, type BoardCard } from "@/components/PipelineBoard";
import { SubmitButton } from "@/components/SubmitButton";
import { TopBar } from "@/components/TopBar";
import { requireStaff } from "@/lib/access";
import type { Deal } from "@/lib/db/schema";
import { formatDate, formatMoney, nowMs, timeAgo } from "@/lib/format";
import { withBase } from "@/lib/paths";
import { loadPipeline } from "@/lib/pipeline-data";
import {
  boardTotals,
  cardMatches,
  COLUMNS,
  daysSince,
  DEAL_KINDS,
  dealKindLabel,
  initials,
  isStalled,
  searchText,
  viewQuery,
  type BoardView,
  type Card,
} from "@/lib/pipeline";
import { createDeal, saveDeal } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Pipeline · Mission control" };

const STAGES = [...COLUMNS.filter((c) => c.key !== "in_build" && c.key !== "shipped"), { key: "lost", label: "Lost" }] as const;

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const { viewer, staff } = await requireStaff();
  const ws = staff.workspaceId;

  const { dealRows, projectRows, billing, columns, lost, owners } = await loadPipeline(ws);
  const dealById = new Map(dealRows.map((d) => [d.id, d]));
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).slice(0, 200) : "");
  const filters: BoardView = { view: str("view") === "list" ? "list" : "board", q: str("q"), owner: str("owner"), stage: str("stage") };

  const now = new Date(nowMs());
  const totals = boardTotals(columns, now);
  const outstanding = billing.reduce((n, b) => n + b.openCents, 0);
  const unpaidInvoices = billing.reduce((n, b) => n + b.unpaid, 0);

  const view = (card: Card): BoardCard => {
    const days = daysSince(card.since, now);
    const deal = card.type === "deal" ? dealById.get(card.id) : undefined;
    let meta = `${days}d`;
    if (card.type === "project" && card.column === "in_build") {
      meta = card.dateTentative ? "Date set at kickoff" : `Due ${formatDate(card.dueOn).replace(/, \d{4}$/, "")}`;
    }
    if (card.type === "project" && card.column === "shipped") {
      meta = card.launchedOn ? `Shipped ${formatDate(card.launchedOn).replace(/, \d{4}$/, "")}` : "Shipped";
    }
    const stalled = isStalled(card.column, card.since, now);
    if (stalled) meta = `${days}d · stalled`;
    const total = card.progress?.total ?? 0;
    return {
      key: card.key,
      type: card.type,
      id: card.id,
      column: card.column,
      company: card.company,
      contact: card.contact,
      value: card.valueCents ? formatMoney(card.valueCents) : null,
      valueCents: card.valueCents,
      kind: dealKindLabel(card.kind),
      owner: card.ownerEmail ? { initials: initials(card.ownerEmail), email: card.ownerEmail } : null,
      meta,
      stalled,
      href: card.href,
      source: card.source === "website" ? card.leadSource ?? "Website" : card.source === "referral" ? "Referral" : card.source?.startsWith("Referral") ? card.source : null,
      progress: card.type === "project" && card.column === "in_build" && total ? Math.round(((card.progress?.done ?? 0) / total) * 100) : null,
      paid: card.type === "project" && card.column === "shipped" && !!card.paid,
      paused: !!card.paused,
      onboardHref: card.needsOnboarding ? `/admin/onboard?deal=${card.id}` : null,
      phone: deal?.phone ?? null,
      email: card.contactEmail,
      website: deal?.website ?? null,
      location: card.location,
      industry: card.industry,
      search: searchText([card.company, card.contactName, card.contactEmail, deal?.phone, deal?.website, card.location, card.industry, card.leadSource, deal?.notes]),
    };
  };

  const editing = typeof sp.deal === "string" ? dealRows.find((d) => d.id === sp.deal) ?? null : null;
  const creating = sp.new === "1";
  const linkedProject = editing?.projectId ? projectRows.find((p) => p.project.id === editing.projectId) : null;
  const cards = columns.flatMap((c) => c.cards).map(view);

  // "Save & next": the next deal below this one in its stage, under the same filters.
  const editingCard = editing ? cards.find((c) => c.key === `deal:${editing.id}`) : undefined;
  const sameStage = editingCard
    ? cards.filter((c) => c.column === editingCard.column && (c.key === editingCard.key || cardMatches({ search: c.search, ownerEmail: c.owner?.email ?? null }, filters)))
    : [];
  const nextCard = editingCard ? sameStage.slice(sameStage.indexOf(editingCard) + 1).find((c) => c.type === "deal") : undefined;
  const position = editingCard ? `${sameStage.indexOf(editingCard) + 1} of ${sameStage.length} in ${COLUMNS.find((c) => c.key === editingCard.column)?.label}` : null;
  const closeHref = `/admin/pipeline${viewQuery(filters)}`;

  return (
    <>
      <TopBar viewer={viewer} />
      <main className="shell page">
        <div className="page-head">
          <div>
            <p className="eyebrow">Sales</p>
            <h1>Pipeline</h1>
            <p className="muted">Every lead, deal and build in one place, straight from your clients, projects, invoices and referrals.</p>
          </div>
          <div className="pipeline-head-actions">
            <Link className="btn btn-ghost" href="/admin/onboard">Add client</Link>
            <Link className="btn btn-ghost" href="/admin/pipeline?import=1#bulk-form">Bulk add leads</Link>
            {/* Won deals from ad clicks, for Google Ads → Goals → Conversions → Uploads. */}
            <a className="btn btn-ghost" href={withBase("/api/pipeline/google-ads")} download title="Won deals that came from a Google Ads click, as Google's upload file">
              Google Ads upload
            </a>
            <Link className="btn btn-primary" href={`/admin/pipeline${viewQuery(filters, { new: "1" })}`} scroll={false}>New deal</Link>
          </div>
        </div>
        {!(creating || editing) && <Notice error={readMessage(sp.error)} notice={readMessage(sp.notice)} />}

        <section className="admin-metrics" aria-label="Pipeline summary">
          <div className="admin-metric"><span>Open pipeline</span><strong>{formatMoney(totals.openCents)}</strong><small>Lead, outreach, proposal and negotiation</small></div>
          <div className="admin-metric"><span>Won / in build</span><strong>{formatMoney(totals.wonCents)}</strong><small>Agreed or invoiced</small></div>
          <div className="admin-metric"><span>Stalled &gt;10 days</span><strong className={totals.stalled ? "pipeline-metric-warn" : undefined}>{totals.stalled}</strong><small>Deals nobody has moved</small></div>
          <Link className="admin-metric" href="/admin/billing?status=open"><span>Outstanding invoices</span><strong>{formatMoney(outstanding)}</strong><small>{unpaidInvoices} unpaid</small></Link>
        </section>

        {sp.import === "1" && (
          <section className="card pipeline-form" id="bulk-form" aria-labelledby="bulk-form-title">
            <div className="card-head">
              <h2 id="bulk-form-title">Bulk add leads</h2>
              <Link className="btn btn-ghost btn-small" href="/admin/pipeline">Close</Link>
            </div>
            <BulkLeadForm owners={owners} me={viewer.email} />
          </section>
        )}

        <PipelineBoard columns={COLUMNS.map(({ key, label }) => ({ key, label }))} cards={cards} owners={owners} me={viewer.email} initial={filters} />

        {lost.length > 0 && (
          <details className="card pipeline-lost">
            <summary>
              Lost deals <span className="chip">{lost.length}</span>
            </summary>
            <ul>
              {lost.map((card) => {
                const deal = dealRows.find((d) => d.id === card.id);
                return (
                  <li key={card.key}>
                    <Link href={`/admin/pipeline${viewQuery(filters, { deal: card.id })}`} scroll={false}>{card.company}</Link>
                    <span className="muted small">
                      {card.valueCents ? formatMoney(card.valueCents) : ""} · lost {timeAgo(card.since, now)}
                      {deal?.lostReason ? ` · ${deal.lostReason}` : ""}
                    </span>
                  </li>
                );
              })}
            </ul>
          </details>
        )}
      </main>

      {(creating || editing) && (
        <>
          <Link className="pipeline-drawer-backdrop" href={closeHref} scroll={false} aria-label="Close" tabIndex={-1} />
          <aside className="pipeline-drawer" id="deal-form" aria-labelledby="deal-form-title">
            <DrawerEscape href={closeHref} />
            <div className="pipeline-drawer-head">
              <div>
                {position && <p className="eyebrow">{position}</p>}
                <h2 id="deal-form-title">{editing ? editing.company : "New deal"}</h2>
                {editing && (editing.contactName || editing.location) && (
                  <p className="muted small">{[editing.contactName, editing.industry, editing.location].filter(Boolean).join(" · ")}</p>
                )}
              </div>
              <Link className="btn btn-ghost btn-small" href={closeHref} scroll={false}>Close</Link>
            </div>
            {editing && (editing.phone || editing.contactEmail || editing.website) && (
              <div className="pipeline-quick">
                {editing.phone && <a className="btn btn-primary btn-small" href={`tel:${editing.phone.replace(/[^\d+]/g, "")}`}>Call {editing.phone}</a>}
                {editing.contactEmail && <a className="btn btn-ghost btn-small" href={`mailto:${editing.contactEmail}`}>Email</a>}
                {editing.website && <a className="btn btn-ghost btn-small" href={editing.website} target="_blank" rel="noreferrer">Website ↗</a>}
              </div>
            )}
            <Notice error={readMessage(sp.error)} notice={readMessage(sp.notice)} />
            {linkedProject && (
              <p className="small muted">
                Onboarded as <Link href={`/admin/projects/${linkedProject.project.id}`}>{linkedProject.project.name}</Link>. Its stage follows the project&apos;s status.
              </p>
            )}
            <DealForm deal={editing} owners={owners} me={viewer.email} linked={!!linkedProject} filters={filters} nextId={nextCard?.id ?? null} />
          </aside>
        </>
      )}
    </>
  );
}

function DealForm({
  deal,
  owners,
  me,
  linked,
  filters,
  nextId,
}: {
  deal: Deal | null;
  owners: string[];
  me: string;
  linked: boolean;
  filters: BoardView;
  nextId: string | null;
}) {
  const f = (id: string) => `deal-${id}`;
  return (
    <form key={deal?.id ?? "new"} action={deal ? saveDeal : createDeal} className="stack">
      {deal && <input type="hidden" name="dealId" value={deal.id} />}
      <input type="hidden" name="back" value={viewQuery(filters)} />
      {nextId && <input type="hidden" name="nextId" value={nextId} />}
      {/* Notes first: imported leads carry their call sheet here. */}
      <div className="field">
        <label htmlFor={f("notes")}>Notes</label>
        <textarea id={f("notes")} name="notes" rows={deal?.notes ? 9 : 4} maxLength={4000} defaultValue={deal?.notes ?? ""} />
      </div>
      <div className="form-grid">
        <div className="field">
          <label htmlFor={f("company")}>Company</label>
          <input id={f("company")} name="company" required maxLength={120} defaultValue={deal?.company} autoFocus={!deal} placeholder="Company name" />
        </div>
        <div className="field">
          <label htmlFor={f("value")}>Value (USD)</label>
          <input id={f("value")} name="value" inputMode="decimal" defaultValue={deal?.valueCents != null ? String(deal.valueCents / 100) : ""} placeholder="Not set" />
        </div>
        <div className="field">
          <label htmlFor={f("contactName")}>Contact</label>
          <input id={f("contactName")} name="contactName" maxLength={120} defaultValue={deal?.contactName ?? ""} placeholder="Not set" />
        </div>
        <div className="field">
          <label htmlFor={f("contactEmail")}>Contact email</label>
          <input id={f("contactEmail")} name="contactEmail" type="email" defaultValue={deal?.contactEmail ?? ""} placeholder="Not set" />
        </div>
        <div className="field">
          <label htmlFor={f("phone")}>Phone</label>
          <input id={f("phone")} name="phone" maxLength={40} defaultValue={deal?.phone ?? ""} />
        </div>
        <div className="field">
          <label htmlFor={f("website")}>Website</label>
          <input id={f("website")} name="website" type="url" defaultValue={deal?.website ?? ""} placeholder="https://" />
        </div>
        <div className="field">
          <label htmlFor={f("industry")}>Industry</label>
          <input id={f("industry")} name="industry" maxLength={80} defaultValue={deal?.industry ?? ""} placeholder="Not set" />
        </div>
        <div className="field">
          <label htmlFor={f("location")}>Location</label>
          <input id={f("location")} name="location" maxLength={80} defaultValue={deal?.location ?? ""} placeholder="Not set" />
        </div>
        <div className="field">
          <label htmlFor={f("leadSource")}>Lead source</label>
          <input id={f("leadSource")} name="leadSource" maxLength={80} list="lead-sources" defaultValue={deal?.leadSource ?? ""} placeholder="Not set" />
          <datalist id="lead-sources">
            {["Website", "Scoping form", "Referral", "Cold outbound", "LinkedIn", "Apollo visit", "Website chat", "Event"].map((s) => <option key={s} value={s} />)}
          </datalist>
        </div>
        <div className="field">
          <label htmlFor={f("kind")}>Type</label>
          <select id={f("kind")} name="kind" defaultValue={deal?.kind ?? "web-app"}>
            {DEAL_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor={f("stage")}>Stage</label>
          <select id={f("stage")} name="stage" defaultValue={deal?.stage ?? "lead"} disabled={linked}>
            {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor={f("owner")}>Owner</label>
          <select id={f("owner")} name="ownerEmail" defaultValue={deal ? deal.ownerEmail ?? "" : me}>
            <option value="">Unassigned</option>
            {owners.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        {deal?.stage === "lost" && (
          <div className="field">
            <label htmlFor={f("lostReason")}>Why we lost it</label>
            <input id={f("lostReason")} name="lostReason" maxLength={300} defaultValue={deal.lostReason ?? ""} placeholder="Went with a cheaper quote" />
          </div>
        )}
      </div>
      <div className="pipeline-form-actions">
        {nextId && (
          <SubmitButton className="btn btn-primary" name="intent" value="next">
            Save &amp; next
          </SubmitButton>
        )}
        <SubmitButton className={nextId ? "btn btn-ghost" : "btn btn-primary"}>{deal ? "Save" : "Add deal"}</SubmitButton>
        {deal && !linked && deal.stage === "won" && <Link className="btn btn-ghost" href={`/admin/onboard?deal=${deal.id}`}>Start onboarding →</Link>}
        {deal && (
          <button className="btn btn-ghost pipeline-delete" name="intent" value="delete" formNoValidate>
            Remove from pipeline
          </button>
        )}
        {deal && <span className="small muted">Added {formatDate(deal.createdAt.toISOString().slice(0, 10))} · in stage since {formatDate(deal.stageChangedAt.toISOString().slice(0, 10))}</span>}
      </div>
    </form>
  );
}
