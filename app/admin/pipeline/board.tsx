import { and, eq, gte, inArray } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BulkLeadForm } from "@/components/BulkLeadForm";
import { DealPanel } from "@/components/DealPanel";
import { Notice, readMessage } from "@/components/Notice";
import { PipelineBoard, type BoardCard } from "@/components/PipelineBoard";
import { TopBar } from "@/components/TopBar";
import { requireStaff } from "@/lib/access";
import { callPriority, parseBrief, readBrief } from "@/lib/call-brief";
import { getDb } from "@/lib/db";
import { events } from "@/lib/db/schema";
import { formatMoney, nowMs, timeAgo } from "@/lib/format";
import { describeFollowUp, followUpState, salesToday } from "@/lib/follow-up";
import { zoneFor } from "@/lib/local-time";
import { withBase } from "@/lib/paths";
import { loadPipeline } from "@/lib/pipeline-data";
import { activeMetrics, formatPct, outreachMetrics, RATE_WINDOW_DAYS, type Rate } from "@/lib/pipeline-metrics";
import {
  callQueue,
  cardMatches,
  closeReasonLabel,
  COLUMNS,
  daysSince,
  dealKindLabel,
  initials,
  isStalled,
  OPEN_ACTIVE,
  previewInFlight,
  previewLabel,
  PREVIEW_STATUSES,
  queueable,
  SALES_COLUMNS,
  searchText,
  signalLabel,
  TRACK_COLUMNS,
  TRACK_LABEL,
  trackOf,
  viewQuery,
  type BoardView,
  type Card,
  type DealStage,
  type Track,
} from "@/lib/pipeline";

/** Where each board lives. Outreach is the call desk; the Pipeline is for closing. */
export const TRACK_HREF: Record<Track, "/admin/leads" | "/admin/pipeline"> = { outreach: "/admin/leads", active: "/admin/pipeline" };

/** Saved views per board: the ways each one gets worked. */
export const SAVED_VIEWS: Record<Track, { key: string; label: string; hint: string }[]> = {
  outreach: [
    { key: "", label: "All leads", hint: "Every lead still in Outreach" },
    { key: "due", label: "Due today", hint: "Follow-ups whose day has come" },
    { key: "untried", label: "Not tried yet", hint: "Never called or emailed" },
    { key: "mine", label: "Mine", hint: "Leads you own" },
  ],
  active: [
    { key: "", label: "All deals", hint: "Every deal in the Pipeline" },
    { key: "next", label: "Needs a next step", hint: "No follow-up set, or it's overdue" },
    { key: "stalled", label: "Stalled", hint: "Hasn't moved stage in over a week" },
    { key: "mine", label: "Mine", hint: "Deals you own" },
  ],
};

function RateTile({ label, r, of }: { label: string; r: Rate; of: string }) {
  return (
    <li>
      <span>{label}</span>
      <strong>{formatPct(r)}</strong>
      <small>{r.n ? `${r.hits} of ${r.n} ${of}` : `no ${of} yet`}</small>
    </li>
  );
}

/**
 * One sales board: Outreach (Attempt 1–4, Closed, then the previews in
 * flight) or the Pipeline (Interested → Won, with Lost folded below). Both
 * share the lead panel, filters and the J/K walk through leads.
 */
export async function SalesBoardPage({ track, sp }: { track: Track; sp: Record<string, string | string[] | undefined> }) {
  const { viewer, staff } = await requireStaff();
  const ws = staff.workspaceId;
  const now = new Date(nowMs());
  const today = salesToday(now);
  const base = TRACK_HREF[track];
  const since = new Date(now.getTime() - (RATE_WINDOW_DAYS + 1) * 86_400_000);

  const [{ dealRows, projectRows, columns, lost, owners, reps }, contacts] = await Promise.all([
    loadPipeline(ws),
    track === "outreach"
      ? getDb()
          .select({ dealId: events.subjectId, verb: events.verb, payload: events.payload, at: events.createdAt })
          .from(events)
          .where(and(eq(events.workspaceId, ws), eq(events.subjectType, "deal"), inArray(events.verb, ["deal.call_logged", "deal.email_sent", "deal.email_scheduled"]), gte(events.createdAt, since)))
      : Promise.resolve([]),
  ]);
  const dealById = new Map(dealRows.map((d) => [d.id, d]));
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).slice(0, 200) : "");
  const views = SAVED_VIEWS[track];
  const show = views.some((v) => v.key === str("show")) ? str("show") : "";
  const filters: BoardView = { view: "board", q: str("q"), owner: show === "mine" ? viewer.email : str("owner"), stage: "", callable: sp.callable === "1", show };

  const due = dealRows.filter((d) => d.stage !== "lost" && d.stage !== "won" && d.stage !== "outreach_closed" && trackOf(d.stage) === track && ["overdue", "today"].includes(followUpState(d.nextStepOn, today))).length;
  const inTrack = (t: Track) => columns.filter((c) => TRACK_COLUMNS[t].includes(c.key) && c.key !== "outreach_closed" && c.key !== "won").reduce((n, c) => n + c.cards.length, 0);

  const view = (card: Card): BoardCard => {
    const days = daysSince(card.since, now);
    const deal = card.type === "deal" ? dealById.get(card.id) : undefined;
    const stalled = isStalled(card.column, card.since, now);
    const total = card.progress?.total ?? 0;
    const brief = deal ? readBrief(deal.brief) ?? parseBrief(deal.notes).brief : null;
    const dueState = deal && deal.stage !== "won" ? followUpState(deal.nextStepOn, today) : "none";
    const active = (OPEN_ACTIVE as readonly string[]).includes(card.column);
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
      meta: stalled ? `${days}d · stalled` : `${days}d in stage`,
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
      untried: card.type === "referral" || (!!deal && !deal.lastContactedAt && card.column === "outreach_1"),
      needsNext: active && (dueState === "none" || dueState === "overdue"),
      signal: deal?.promotedSignal ? signalLabel(deal.promotedSignal) : null,
      preview: deal && previewInFlight(deal.previewStatus) ? { status: deal.previewStatus, label: previewLabel(deal.previewStatus) } : null,
      closed: card.column === "outreach_closed" ? closeReasonLabel(deal?.closeReason, deal?.closeDetail) : null,
    };
  };

  // The board is for selling: builds and launches live on Projects.
  const cards = columns.filter((c) => SALES_COLUMNS.includes(c.key)).flatMap((c) => c.cards).map(view);
  const boardCards = cards.filter((c) => TRACK_COLUMNS[track].includes(c.column));
  const editing = typeof sp.deal === "string" ? dealRows.find((d) => d.id === sp.deal) ?? null : null;
  const creating = sp.new === "1";
  // A lead opened on the other board (an old link, or it was just promoted or sent back) opens where it now lives.
  if (editing && !editing.projectId && trackOf(editing.stage) !== track) {
    const p = new URLSearchParams();
    for (const k of ["q", "owner", "deal", "notice", "error", "email", "close"]) if (typeof sp[k] === "string") p.set(k, sp[k] as string);
    redirect(`${TRACK_HREF[trackOf(editing.stage)]}?${p}`);
  }
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
  const closeHref = `${base}${viewQuery(filters)}`;
  const leadHref = (id: string) => `${base}${viewQuery(filters, { deal: id })}`;

  // ---- The numbers above the board ----
  const outreach =
    track === "outreach"
      ? outreachMetrics(
          contacts.map((e) => ({ dealId: e.dealId ?? "", verb: e.verb, outcome: typeof (e.payload as Record<string, unknown>)?.outcome === "string" ? ((e.payload as Record<string, string>).outcome) : null, at: e.at })),
          new Map(dealRows.map((d) => [d.id, d.industry ?? readBrief(d.brief)?.vertical ?? null])),
          now,
        )
      : null;
  const active =
    track === "active"
      ? activeMetrics(
          dealRows.filter((d) => !d.projectId || d.stage === "won").map((d) => ({ stage: d.stage as DealStage, valueCents: d.valueCents, nextStepOn: d.nextStepOn, createdAt: d.createdAt, promotedAt: d.promotedAt, wonAt: d.wonAt })),
          today,
        )
      : null;
  const previews = dealRows
    .filter((d) => previewInFlight(d.previewStatus))
    .sort((a, b) => PREVIEW_STATUSES.findIndex((s) => s.value === a.previewStatus) - PREVIEW_STATUSES.findIndex((s) => s.value === b.previewStatus) || (a.previewRequestedAt?.getTime() ?? 0) - (b.previewRequestedAt?.getTime() ?? 0));

  return (
    <>
      <TopBar viewer={viewer} />
      <main className="shell page pipeline-page" data-track={track}>
        <div className="pipeline-head">
          <div>
            <p className="eyebrow">{track === "outreach" ? "Calls and cold email" : "Real opportunities"}</p>
            <h1>{TRACK_LABEL[track]}</h1>
          </div>
          <ul className="pipeline-strip pipeline-tracks" aria-label="Boards">
            {(["outreach", "active"] as const).map((t) => (
              <li key={t}>
                <Link href={TRACK_HREF[t]} aria-current={track === t ? "page" : undefined}>
                  <span>{TRACK_LABEL[t]}</span>
                  <strong>{inTrack(t)}</strong>
                </Link>
              </li>
            ))}
            <li>
              <Link href={`${base}${viewQuery({ ...filters, show: track === "outreach" ? "due" : "next" })}`}>
                <span>{track === "outreach" ? "Follow-ups due" : "Due or overdue"}</span>
                <strong className={due ? "pipeline-metric-warn" : undefined}>{due}</strong>
              </Link>
            </li>
          </ul>
          <details className="new-menu">
            <summary className="btn btn-primary">+ New</summary>
            <div role="menu">
              <Link role="menuitem" href={`${base}${viewQuery(filters, { new: "1" })}`} scroll={false}>
                {track === "outreach" ? "New lead" : "New deal"}
              </Link>
              <Link role="menuitem" href="/admin/leads?import=1#bulk-form">
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

        {outreach && (
          <section className="track-metrics" aria-label="Outreach numbers">
            <ul className="track-metrics-tiles">
              <li>
                <span>Attempts today</span>
                <strong>{outreach.attemptsToday}</strong>
                <small>calls and emails</small>
              </li>
              <RateTile label="Connect rate" r={outreach.connect} of="dials" />
              <RateTile label="Interest rate" r={outreach.interest} of="connects" />
              <RateTile label="Preview rate" r={outreach.preview} of="connects" />
            </ul>
            <p className="track-metrics-note">Rates over the last {RATE_WINDOW_DAYS} days. Connect: reached the owner. Interest: said they&apos;re interested or asked for a preview.</p>
            {outreach.industries.length > 0 && (
              <details className="track-industries">
                <summary>By industry</summary>
                <div className="track-industries-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">Industry</th>
                        <th scope="col">Dials</th>
                        <th scope="col">Connect</th>
                        <th scope="col">Interest</th>
                        <th scope="col">Preview</th>
                      </tr>
                    </thead>
                    <tbody>
                      {outreach.industries.map((i) => (
                        <tr key={i.industry} data-small={i.comparable ? undefined : ""}>
                          <th scope="row">
                            {i.industry}
                            {!i.comparable && <small> · too few to compare</small>}
                          </th>
                          <td>{i.dials}</td>
                          <td>
                            {formatPct(i.connect)} <small>n={i.connect.n}</small>
                          </td>
                          <td>
                            {formatPct(i.interest)} <small>n={i.interest.n}</small>
                          </td>
                          <td>
                            {formatPct(i.preview)} <small>n={i.preview.n}</small>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}
          </section>
        )}

        {active && (
          <section className="track-metrics" aria-label="Pipeline numbers">
            <ul className="track-metrics-tiles">
              <li>
                <span>Open value</span>
                <strong>{formatMoney(active.openCents)}</strong>
                <small>
                  {active.openCount} open deal{active.openCount === 1 ? "" : "s"}
                  {active.unvalued ? ` · ${active.unvalued} without a value` : ""}
                </small>
              </li>
              <RateTile label="Win rate" r={active.winRate} of="closed deals" />
              <li>
                <span>Average days to close</span>
                <strong>{active.avgDaysToClose ?? "–"}</strong>
                <small>{active.closedN ? `from promotion to won · n=${active.closedN}` : "no won deals with dates yet"}</small>
              </li>
              <li>
                <Link href={`${base}${viewQuery({ ...filters, show: "next" })}`}>
                  <span>Needs a next step</span>
                  <strong className={active.needsNext ? "pipeline-metric-warn" : undefined}>{active.needsNext}</strong>
                  <small>of {active.openCount} open</small>
                </Link>
              </li>
            </ul>
          </section>
        )}

        {!(creating || editing) && <Notice error={readMessage(sp.error)} notice={readMessage(sp.notice)} />}

        {sp.import === "1" && track === "outreach" && (
          <section className="card pipeline-form" id="bulk-form" aria-labelledby="bulk-form-title">
            <div className="card-head">
              <h2 id="bulk-form-title">Bulk add leads</h2>
              <Link className="btn btn-ghost btn-small" href="/admin/leads">
                Close
              </Link>
            </div>
            <BulkLeadForm owners={owners} me={viewer.email} />
          </section>
        )}

        <PipelineBoard
          key={track}
          track={track}
          base={base}
          views={views}
          columns={COLUMNS.filter((c) => TRACK_COLUMNS[track].includes(c.key)).map(({ key, label }) => ({ key, label }))}
          cards={boardCards}
          owners={owners}
          me={viewer.email}
          today={today}
          initial={filters}
          nowMs={now.getTime()}
        />

        {track === "outreach" && previews.length > 0 && (
          <section className="card preview-lane" aria-labelledby="preview-lane-title">
            <div className="card-head">
              <h2 id="preview-lane-title">
                Previews <span className="chip">{previews.length}</span>
              </h2>
              <p className="muted small">The last step of outreach: a preview site for leads who asked. They&apos;re in the Pipeline while it&apos;s built.</p>
            </div>
            <ol>
              {previews.map((d) => (
                <li key={d.id} data-status={d.previewStatus}>
                  <Link href={leadHref(d.id)} scroll={false}>
                    {d.company}
                  </Link>
                  <span className="preview-chip" data-status={d.previewStatus}>
                    {previewLabel(d.previewStatus)}
                  </span>
                  <span className="muted small">
                    {d.previewRequestedAt ? `asked ${timeAgo(d.previewRequestedAt, now)}` : ""}
                    {d.previewFirstOpenAt ? ` · opened ${timeAgo(d.previewFirstOpenAt, now)}` : d.previewSentAt ? ` · sent ${timeAgo(d.previewSentAt, now)}` : ""}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        )}

        {track === "active" && lost.length > 0 && (
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
                base,
                back: viewQuery(filters),
                closeHref,
                nextId: next?.id ?? null,
                nextHref: next ? leadHref(next.id) : null,
                prevHref: prev ? leadHref(prev.id) : null,
                position: editingCard ? `${at + 1} of ${sameStage.length} ${inQueue ? "callable now" : `in ${COLUMNS.find((c) => c.key === editingCard.column)?.label}`}` : null,
              }}
              newTrack={track}
              today={today}
              now={now}
              notice={readMessage(sp.notice)}
              error={readMessage(sp.error)}
              emailOpen={sp.email === "1"}
              closeOpen={sp.close === "1"}
            />
          </aside>
        </>
      )}
    </>
  );
}
