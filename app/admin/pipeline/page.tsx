import type { Metadata } from "next";
import Link from "next/link";
import { BulkLeadForm } from "@/components/BulkLeadForm";
import { DealPanel } from "@/components/DealPanel";
import { Notice, readMessage } from "@/components/Notice";
import { PipelineBoard, type BoardCard } from "@/components/PipelineBoard";
import { TopBar } from "@/components/TopBar";
import { requireStaff } from "@/lib/access";
import { callPriority, parseBrief, readBrief } from "@/lib/call-brief";
import { formatMoney, nowMs, timeAgo } from "@/lib/format";
import { describeFollowUp, followUpState, salesToday } from "@/lib/follow-up";
import { zoneFor } from "@/lib/local-time";
import { withBase } from "@/lib/paths";
import { loadPipeline } from "@/lib/pipeline-data";
import {
  boardTotals,
  callQueue,
  cardMatches,
  COLUMNS,
  daysSince,
  dealKindLabel,
  initials,
  isStalled,
  queueable,
  SALES_COLUMNS,
  searchText,
  viewQuery,
  type BoardView,
  type Card,
} from "@/lib/pipeline";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Pipeline · Mission control" };

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const { viewer, staff } = await requireStaff();
  const ws = staff.workspaceId;

  const { dealRows, projectRows, billing, columns, lost, owners, reps } = await loadPipeline(ws);
  const dealById = new Map(dealRows.map((d) => [d.id, d]));
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).slice(0, 200) : "");
  const filters: BoardView = { view: "board", q: str("q"), owner: str("owner"), stage: "", callable: sp.callable === "1" };

  const now = new Date(nowMs());
  const today = salesToday(now);
  const totals = boardTotals(columns, now);
  const outstanding = billing.reduce((n, b) => n + b.openCents, 0);
  const due = dealRows.filter((d) => d.stage !== "lost" && d.stage !== "won" && ["overdue", "today"].includes(followUpState(d.nextStepOn, today))).length;

  const view = (card: Card): BoardCard => {
    const days = daysSince(card.since, now);
    const deal = card.type === "deal" ? dealById.get(card.id) : undefined;
    const stalled = isStalled(card.column, card.since, now);
    const total = card.progress?.total ?? 0;
    const brief = deal ? readBrief(deal.brief) ?? parseBrief(deal.notes).brief : null;
    const dueState = deal && deal.stage !== "won" ? followUpState(deal.nextStepOn, today) : "none";
    return {
      key: card.key,
      type: card.type,
      id: card.id,
      column: card.column,
      company: card.company,
      qualified: brief?.qualified === true,
      contact: card.contact,
      value: card.valueCents ? formatMoney(card.valueCents) : null,
      valueCents: card.valueCents,
      kind: dealKindLabel(card.kind),
      owner: card.ownerEmail ? { initials: initials(card.ownerEmail), email: card.ownerEmail } : null,
      meta: stalled ? `${days}d · stalled` : `${days}d`,
      stalled,
      href: card.href,
      source: card.source === "website" ? card.leadSource ?? "Website" : card.source === "referral" ? "Referral" : card.source?.startsWith("Referral") ? card.source : null,
      progress: card.type === "project" && card.column === "in_build" && total ? Math.round(((card.progress?.done ?? 0) / total) * 100) : null,
      paid: false,
      paused: !!card.paused,
      onboardHref: card.needsOnboarding ? `/admin/onboard?deal=${card.id}` : null,
      phone: deal?.phone ?? null,
      email: card.contactEmail,
      website: deal?.website ?? null,
      location: card.location,
      industry: card.industry,
      followUp: deal && deal.stage !== "won" ? describeFollowUp(deal.nextStepOn, today) : null,
      followUpOn: deal?.nextStepOn ?? null,
      nextStep: deal?.nextStep ?? null,
      followUpState: dueState,
      tag: brief?.tag ?? null,
      warning: !!brief?.warnings?.length,
      badNumber: !!deal?.badNumber,
      zone: deal ? zoneFor(deal) : null,
      queueable: deal ? queueable(deal, today) : false,
      priority: callPriority({ brief, followUp: dueState, contacted: !!deal?.lastContactedAt }),
      search: searchText([card.company, card.contactName, card.contactEmail, deal?.phone, deal?.website, card.location, card.industry, card.leadSource, deal?.notes, brief?.tag, brief?.askFor, brief?.vertical]),
    };
  };

  // The board is for selling: builds and launches live on Projects.
  const cards = columns.filter((c) => SALES_COLUMNS.includes(c.key)).flatMap((c) => c.cards).map(view);
  const editing = typeof sp.deal === "string" ? dealRows.find((d) => d.id === sp.deal) ?? null : null;
  const creating = sp.new === "1";
  const linkedProject = editing?.projectId ? projectRows.find((p) => p.project.id === editing.projectId) : null;

  // Next and previous: through the call queue when "Callable now" is on, else within the same stage, under the same filters.
  const editingCard = editing ? cards.find((c) => c.key === `deal:${editing.id}`) : undefined;
  const matching = (c: BoardCard) => c.type === "deal" && (c.key === editingCard?.key || cardMatches({ search: c.search, ownerEmail: c.owner?.email ?? null }, filters));
  const queue = filters.callable && editingCard ? callQueue(cards.filter(matching), now) : [];
  const inQueue = queue.includes(editingCard!);
  const sameStage = !editingCard ? [] : inQueue ? queue : cards.filter((c) => matching(c) && c.column === editingCard.column);
  const at = editingCard ? sameStage.indexOf(editingCard) : -1;
  const next = at >= 0 ? sameStage[at + 1] : undefined;
  const prev = at > 0 ? sameStage[at - 1] : undefined;
  const closeHref = `/admin/pipeline${viewQuery(filters)}`;
  const leadHref = (id: string) => `/admin/pipeline${viewQuery(filters, { deal: id })}`;

  return (
    <>
      <TopBar viewer={viewer} />
      <main className="shell page pipeline-page">
        <div className="pipeline-head">
          <div>
            <p className="eyebrow">Sales</p>
            <h1>Pipeline</h1>
          </div>
          <ul className="pipeline-strip" aria-label="Pipeline summary">
            <li>
              <span>Open</span>
              <strong>{formatMoney(totals.openCents)}</strong>
            </li>
            <li>
              <span>Won</span>
              <strong>{formatMoney(totals.wonCents)}</strong>
            </li>
            <li>
              <Link href="/admin/clients?view=due">
                <span>Follow-ups due</span>
                <strong className={due ? "pipeline-metric-warn" : undefined}>{due}</strong>
              </Link>
            </li>
            <li>
              <span>Stalled</span>
              <strong className={totals.stalled ? "pipeline-metric-warn" : undefined}>{totals.stalled}</strong>
            </li>
            <li>
              <Link href="/admin/billing?status=open">
                <span>Unpaid invoices</span>
                <strong>{formatMoney(outstanding)}</strong>
              </Link>
            </li>
          </ul>
          <details className="new-menu">
            <summary className="btn btn-primary">+ New</summary>
            <div role="menu">
              <Link role="menuitem" href={`/admin/pipeline${viewQuery(filters, { new: "1" })}`} scroll={false}>
                New deal
              </Link>
              <Link role="menuitem" href="/admin/pipeline?import=1#bulk-form">
                Bulk add leads
              </Link>
              <Link role="menuitem" href="/admin/onboard">
                Add client
              </Link>
              {/* Won deals from ad clicks, for Google Ads → Goals → Conversions → Uploads. */}
              <a role="menuitem" href={withBase("/api/pipeline/google-ads")} download title="Won deals that came from a Google Ads click, as Google's upload file">
                Google Ads upload file
              </a>
            </div>
          </details>
        </div>
        {!(creating || editing) && <Notice error={readMessage(sp.error)} notice={readMessage(sp.notice)} />}

        {sp.import === "1" && (
          <section className="card pipeline-form" id="bulk-form" aria-labelledby="bulk-form-title">
            <div className="card-head">
              <h2 id="bulk-form-title">Bulk add leads</h2>
              <Link className="btn btn-ghost btn-small" href="/admin/pipeline">
                Close
              </Link>
            </div>
            <BulkLeadForm owners={owners} me={viewer.email} />
          </section>
        )}

        <PipelineBoard columns={COLUMNS.filter((c) => SALES_COLUMNS.includes(c.key)).map(({ key, label }) => ({ key, label }))} cards={cards} owners={owners} me={viewer.email} today={today} initial={filters} nowMs={now.getTime()} />

        {lost.length > 0 && (
          <details className="card pipeline-lost">
            <summary>
              Lost deals <span className="chip">{lost.length}</span>
            </summary>
            <ul>
              {lost.map((card) => {
                const deal = dealById.get(card.id);
                return (
                  <li key={card.key}>
                    <Link href={leadHref(card.id)} scroll={false}>
                      {card.company}
                    </Link>
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
            <DealPanel
              deal={editing}
              owners={owners}
              reps={reps}
              me={viewer.email}
              linkedProject={linkedProject ? { id: linkedProject.project.id, name: linkedProject.project.name } : null}
              nav={{
                base: "/admin/pipeline",
                back: viewQuery(filters),
                closeHref,
                nextId: next?.id ?? null,
                nextHref: next ? leadHref(next.id) : null,
                prevHref: prev ? leadHref(prev.id) : null,
                position: editingCard ? `${at + 1} of ${sameStage.length} ${inQueue ? "callable now" : `in ${COLUMNS.find((c) => c.key === editingCard.column)?.label}`}` : null,
              }}
              today={today}
              now={now}
              notice={readMessage(sp.notice)}
              error={readMessage(sp.error)}
              emailOpen={sp.email === "1"}
            />
          </aside>
        </>
      )}
    </>
  );
}
