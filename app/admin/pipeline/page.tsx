import type { Metadata } from "next";
import Link from "next/link";
import { BulkLeadForm } from "@/components/BulkLeadForm";
import { Notice, readMessage } from "@/components/Notice";
import { PipelineBoard, type BoardCard } from "@/components/PipelineBoard";
import { SubmitButton } from "@/components/SubmitButton";
import { TopBar } from "@/components/TopBar";
import { requireStaff } from "@/lib/access";
import type { Deal } from "@/lib/db/schema";
import { formatDate, formatMoney, nowMs, timeAgo } from "@/lib/format";
import { loadPipeline } from "@/lib/pipeline-data";
import {
  boardTotals,
  COLUMNS,
  daysSince,
  DEAL_KINDS,
  dealKindLabel,
  initials,
  isStalled,
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

  const now = new Date(nowMs());
  const totals = boardTotals(columns, now);
  const outstanding = billing.reduce((n, b) => n + b.openCents, 0);
  const unpaidInvoices = billing.reduce((n, b) => n + b.unpaid, 0);

  const view = (card: Card): BoardCard => {
    const days = daysSince(card.since, now);
    let meta = `${days}d in stage`;
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
      value: card.valueCents ? formatMoney(card.valueCents) : "No value yet",
      valueCents: card.valueCents,
      kind: dealKindLabel(card.kind),
      owner: card.ownerEmail ? { initials: initials(card.ownerEmail), email: card.ownerEmail } : null,
      meta,
      stalled,
      href: card.type === "deal" ? `/admin/pipeline?deal=${card.id}#deal-form` : card.href,
      source: card.source === "import" ? "Imported lead" : card.source === "referral" ? "Referral" : card.source?.startsWith("Referral") ? card.source : null,
      progress: card.type === "project" && card.column === "in_build" && total ? Math.round(((card.progress?.done ?? 0) / total) * 100) : null,
      paid: card.type === "project" && card.column === "shipped" && !!card.paid,
      paused: !!card.paused,
      onboardHref: card.needsOnboarding ? `/admin/onboard?deal=${card.id}` : null,
    };
  };

  const editing = typeof sp.deal === "string" ? dealRows.find((d) => d.id === sp.deal) ?? null : null;
  const creating = sp.new === "1";
  const linkedProject = editing?.projectId ? projectRows.find((p) => p.project.id === editing.projectId) : null;

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
            <Link className="btn btn-primary" href="/admin/pipeline?new=1#deal-form">New deal</Link>
          </div>
        </div>
        <Notice error={readMessage(sp.error)} notice={readMessage(sp.notice)} />

        <section className="admin-metrics" aria-label="Pipeline summary">
          <div className="admin-metric"><span>Open pipeline</span><strong>{formatMoney(totals.openCents)}</strong><small>Lead, proposal and negotiation</small></div>
          <div className="admin-metric"><span>Won / in build</span><strong>{formatMoney(totals.wonCents)}</strong><small>Agreed or invoiced</small></div>
          <div className="admin-metric"><span>Stalled &gt;10 days</span><strong className={totals.stalled ? "pipeline-metric-warn" : undefined}>{totals.stalled}</strong><small>Deals nobody has moved</small></div>
          <Link className="admin-metric" href="/admin/billing?status=open"><span>Outstanding invoices</span><strong>{formatMoney(outstanding)}</strong><small>{unpaidInvoices} unpaid</small></Link>
        </section>

        {(creating || editing) && (
          <section className="card pipeline-form" id="deal-form" aria-labelledby="deal-form-title">
            <div className="card-head">
              <h2 id="deal-form-title">{editing ? editing.company : "New deal"}</h2>
              <Link className="btn btn-ghost btn-small" href="/admin/pipeline">Close</Link>
            </div>
            {linkedProject && (
              <p className="small muted">
                Onboarded as <Link href={`/admin/projects/${linkedProject.project.id}`}>{linkedProject.project.name}</Link>. Its stage follows the project&apos;s status.
              </p>
            )}
            <DealForm deal={editing} owners={owners} me={viewer.email} linked={!!linkedProject} />
          </section>
        )}

        {sp.import === "1" && (
          <section className="card pipeline-form" id="bulk-form" aria-labelledby="bulk-form-title">
            <div className="card-head">
              <h2 id="bulk-form-title">Bulk add leads</h2>
              <Link className="btn btn-ghost btn-small" href="/admin/pipeline">Close</Link>
            </div>
            <BulkLeadForm owners={owners} me={viewer.email} />
          </section>
        )}

        <p className="pipeline-hint">Drag a card to another column, or use its stage menu.</p>
        <PipelineBoard columns={COLUMNS.map(({ key, label }) => ({ key, label }))} cards={columns.flatMap((c) => c.cards).map(view)} />

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
                    <Link href={`/admin/pipeline?deal=${card.id}#deal-form`}>{card.company}</Link>
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
    </>
  );
}

function DealForm({ deal, owners, me, linked }: { deal: Deal | null; owners: string[]; me: string; linked: boolean }) {
  const f = (id: string) => `deal-${id}`;
  return (
    <form action={deal ? saveDeal : createDeal} className="stack">
      {deal && <input type="hidden" name="dealId" value={deal.id} />}
      <div className="form-grid">
        <div className="field">
          <label htmlFor={f("company")}>Company</label>
          <input id={f("company")} name="company" required maxLength={120} defaultValue={deal?.company} autoFocus={!deal} placeholder="Lumen Physio" />
        </div>
        <div className="field">
          <label htmlFor={f("value")}>Value (USD)</label>
          <input id={f("value")} name="value" inputMode="decimal" defaultValue={deal?.valueCents != null ? String(deal.valueCents / 100) : ""} placeholder="12000" />
        </div>
        <div className="field">
          <label htmlFor={f("contactName")}>Contact</label>
          <input id={f("contactName")} name="contactName" maxLength={120} defaultValue={deal?.contactName ?? ""} placeholder="Sofia Reyes" />
        </div>
        <div className="field">
          <label htmlFor={f("contactEmail")}>Contact email</label>
          <input id={f("contactEmail")} name="contactEmail" type="email" defaultValue={deal?.contactEmail ?? ""} placeholder="sofia@lumenphysio.com" />
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
          <input id={f("industry")} name="industry" maxLength={80} defaultValue={deal?.industry ?? ""} placeholder="Dental clinics" />
        </div>
        <div className="field">
          <label htmlFor={f("location")}>Location</label>
          <input id={f("location")} name="location" maxLength={80} defaultValue={deal?.location ?? ""} placeholder="Tampa, FL" />
        </div>
        <div className="field">
          <label htmlFor={f("leadSource")}>Lead source</label>
          <input id={f("leadSource")} name="leadSource" maxLength={80} list="lead-sources" defaultValue={deal?.leadSource ?? ""} placeholder="Scoping form" />
          <datalist id="lead-sources">
            {["Scoping form", "Referral", "Cold outbound", "LinkedIn", "Apollo visit", "Website chat", "Event"].map((s) => <option key={s} value={s} />)}
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
      <div className="field">
        <label htmlFor={f("notes")}>Notes</label>
        <textarea id={f("notes")} name="notes" rows={3} maxLength={4000} defaultValue={deal?.notes ?? ""} />
      </div>
      <div className="pipeline-form-actions">
        <SubmitButton className="btn btn-primary">{deal ? "Save deal" : "Add deal"}</SubmitButton>
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
