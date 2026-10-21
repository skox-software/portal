"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FollowUpControl } from "@/components/FollowUpControl";
import { useEffect, useMemo, useOptimistic, useRef, useState, useTransition } from "react";
import { claimProject, moveCard } from "@/app/admin/pipeline/actions";
import { allowedColumns, callQueue, cardMatches, COLUMNS, viewQuery, type BoardView, type CardType, type ColumnKey, type Track } from "@/lib/pipeline";

export type { BoardView };

export type BoardCard = {
  key: string;
  type: CardType;
  id: string;
  column: ColumnKey;
  company: string;
  qualified?: boolean;
  contact: string | null;
  /** Empty when there's no value yet, so the card stays quiet. */
  value: string | null;
  valueCents: number;
  kind: string;
  owner: { initials: string; email: string } | null;
  /** "3d", "Due Oct 14", "Shipped Sep 1"… */
  meta: string;
  stalled: boolean;
  /** Where the card opens; deals open in the side panel. */
  href: string | null;
  source: string | null;
  progress: number | null;
  paid: boolean;
  paused: boolean;
  onboardHref: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  /** "Due today", "Overdue 2d"… for deals with a follow-up set. */
  followUp: string | null;
  followUpState: "overdue" | "today" | "upcoming" | "none";
  /** The follow-up's date and what it's for, so the card can change it in place. */
  followUpOn: string | null;
  nextStep: string | null;
  location: string | null;
  industry: string | null;
  /** The brief's CALL ABOUT: "NOT MOBILE", "SITE DOWN", "NO WEBSITE"… */
  tag: string | null;
  /** The brief has a CHECK FIRST / WEAK LEAD / PHONE UNVERIFIED warning. */
  warning: boolean;
  badNumber: boolean;
  /** The lead's IANA time zone, from its location or area code. */
  zone: string | null;
  /** Open, with a working number and no follow-up set for a later day. */
  queueable: boolean;
  /** Call-sheet order, lowest first (lib/call-brief.ts callPriority). */
  priority: number;
  /** Lower-cased text the search box matches against. */
  search: string;
  /** Outreach: never called or emailed. */
  untried?: boolean;
  /** Pipeline: open with no follow-up, or an overdue one. */
  needsNext?: boolean;
  /** Pipeline: what promoted it ("Replied", "Asked for a preview"…). */
  signal?: string | null;
  /** A preview website in flight. */
  preview?: { status: string; label: string } | null;
  /** Closed outreach: why ("Not interested · Retiring"). */
  closed?: string | null;
};

/** Does a card belong in a saved view? Empty means every card. */
function inSavedView(card: BoardCard, show: string | undefined) {
  if (show === "due") return card.followUpState === "overdue" || card.followUpState === "today";
  if (show === "untried") return !!card.untried;
  if (show === "next") return !!card.needsNext;
  if (show === "stalled") return card.stalled;
  return true;
}

type Column = { key: ColumnKey; label: string };
const LABEL: Record<ColumnKey | "lost", string> = {
  ...(Object.fromEntries(COLUMNS.map((c) => [c.key, c.label])) as Record<ColumnKey, string>),
  lost: "Lost",
};

function money(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100);
}

export function PipelineBoard({
  cards,
  columns,
  owners,
  me,
  today,
  initial,
  nowMs,
  track,
  base,
  views,
}: {
  track: Track;
  /** The board's own page: "/admin/leads" or "/admin/pipeline". */
  base: string;
  views: { key: string; label: string; hint: string }[];
  cards: BoardCard[];
  columns: Column[];
  owners: string[];
  me: string;
  /** Today in the sales time zone, from the server. */
  today: string;
  initial: BoardView;
  /** The server's clock, so the first render matches; it ticks on from there. */
  nowMs: number;
}) {
  const [optimistic, applyMove] = useOptimistic(cards, (state, move: { key: string; to: ColumnKey | "lost" }) =>
    move.to === "lost"
      ? state.filter((c) => c.key !== move.key)
      : state.map((c) => (c.key === move.key ? { ...c, column: move.to as ColumnKey, stalled: false, meta: "0d" } : c)),
  );
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState<BoardCard | null>(null);
  const [over, setOver] = useState<ColumnKey | null>(null);
  const [v, setV] = useState<BoardView>(initial);
  const [nowAt, setNowAt] = useState(nowMs);
  // Local times and "Callable now" move with the clock.
  useEffect(() => {
    const t = setInterval(() => setNowAt(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const now = useMemo(() => new Date(nowAt), [nowAt]);
  // Phones show one column at a time; the chips jump between them.
  const board = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState<ColumnKey>(columns[0].key);
  const router = useRouter();

  // Keep the filters in the address, so opening a lead and coming back keeps them.
  useEffect(() => {
    const url = new URL(window.location.href);
    for (const k of ["view", "q", "owner", "stage", "callable", "track", "show"]) url.searchParams.delete(k);
    for (const [k, val] of new URLSearchParams(viewQuery(v))) url.searchParams.set(k, val);
    window.history.replaceState(window.history.state, "", url);
  }, [v]);

  const matched = useMemo(() => optimistic.filter((c) => inSavedView(c, v.show) && cardMatches({ search: c.search, ownerEmail: c.owner?.email ?? null }, v)), [optimistic, v]);
  const callableNow = useMemo(() => callQueue(matched, now), [matched, now]);
  const shown = v.callable ? callableNow : matched;
  const filtering = Boolean(v.q || v.owner || v.callable || v.show);

  useEffect(() => {
    const el = board.current;
    if (!el) return;
    const onScroll = () => {
      const pad = parseFloat(getComputedStyle(el).paddingLeft);
      const cols = [...el.querySelectorAll<HTMLElement>(".pipeline-col")];
      const nearest = cols.reduce((best, col) =>
        Math.abs(col.offsetLeft - pad - el.scrollLeft) < Math.abs(best.offsetLeft - pad - el.scrollLeft) ? col : best,
      );
      setVisible(nearest.dataset.stage as ColumnKey);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [v.view]);

  function jumpTo(key: ColumnKey) {
    const el = board.current;
    const col = el?.querySelector<HTMLElement>(`.pipeline-col[data-stage="${key}"]`);
    if (el && col) el.scrollTo({ left: col.offsetLeft - parseFloat(getComputedStyle(el).paddingLeft), behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    setVisible(key);
  }

  function move(card: BoardCard, to: ColumnKey | "lost") {
    if (card.column === to) return;
    if (!allowedColumns(card.type, card.column).includes(to)) {
      setError(
        card.type === "project"
          ? "Projects are already won: move them between Won, In build and Shipped."
          : to === "in_build" || to === "shipped"
            ? "Start onboarding from the Won column to turn a deal into a build."
            : "Leads move to the Pipeline with Promote, and back with Send back, both in the lead's panel.",
      );
      return;
    }
    // Closing outreach asks why: open the lead with the reasons showing.
    if (to === "outreach_closed" && card.type === "deal") {
      router.push(`${base}${viewQuery(v, { deal: card.id, close: "1" })}`, { scroll: false });
      return;
    }
    setError(null);
    startTransition(async () => {
      applyMove({ key: card.key, to });
      const result = await moveCard(card.type, card.id, to);
      if (!result.ok) setError(result.error);
    });
  }

  const open = (card: BoardCard) => (card.type === "deal" ? `${base}${viewQuery(v, { deal: card.id })}` : card.href);

  const stageSelect = (card: BoardCard) => (
    <>
      <label className="sr-only" htmlFor={`stage-${card.key}`}>
        Stage for {card.company}
      </label>
      <select id={`stage-${card.key}`} className="pipeline-stage" value={card.column} onChange={(e) => move(card, e.target.value as ColumnKey | "lost")}>
        {allowedColumns(card.type, card.column).map((key) => (
          <option key={key} value={key}>
            {LABEL[key]}
          </option>
        ))}
      </select>
    </>
  );

  const reach = (card: BoardCard) =>
    (card.website?.trim() || card.phone?.trim() || card.email?.trim()) && (
      <span className="pipeline-reach">
        {card.website?.trim() && (
          <a href={card.website} target="_blank" rel="noreferrer" title={`Website: ${card.website}`} aria-label={`${card.company} website`}>
            Site ↗
          </a>
        )}
        {card.phone?.trim() && (
          <a href={`tel:${card.phone.replace(/[^\d+]/g, "")}`} title={`Call ${card.phone}`} aria-label={`Call ${card.company}, ${card.phone}`}>
            Call
          </a>
        )}
        {card.email?.trim() && (card.type === "deal" ? (
          // Deals open the drafted email in the panel, written from the call brief.
          <Link href={`${base}${viewQuery(v, { deal: card.id, email: "1" })}`} scroll={false} title="Open the email draft" aria-label={`Email draft for ${card.company}`}>
            Email
          </Link>
        ) : (
          card.email && (
            <a href={`mailto:${card.email}`} title={`Email ${card.email}`} aria-label={`Email ${card.company}`}>
              Email
            </a>
          )
        ))}
      </span>
    );

  return (
    <>
      <div className="pipeline-toolbar">
        <nav className="crm-views pipeline-views" aria-label="Saved views">
          {views.map((sv) => (
            <button key={sv.key || "all"} type="button" title={sv.hint} aria-pressed={(v.show ?? "") === sv.key} onClick={() => setV({ ...v, show: sv.key, owner: sv.key === "mine" ? me : v.show === "mine" ? "" : v.owner })}>
              {sv.label}
              <span>{optimistic.filter((c) => (sv.key === "mine" ? c.owner?.email === me : inSavedView(c, sv.key))).length}</span>
            </button>
          ))}
          <Link href="/admin/clients" title="Every lead and client as a list">
            List
          </Link>
        </nav>
        <label className="sr-only" htmlFor="pipeline-search">
          Search {track === "outreach" ? "leads" : "deals"}
        </label>
        <input
          id="pipeline-search"
          type="search"
          value={v.q}
          onChange={(e) => setV({ ...v, q: e.target.value })}
          placeholder="Search company, contact, phone, city, notes…"
          autoComplete="off"
        />
        <label className="sr-only" htmlFor="pipeline-owner">
          Owner
        </label>
        <select id="pipeline-owner" value={v.owner} onChange={(e) => setV({ ...v, owner: e.target.value })}>
          <option value="">Everyone&apos;s</option>
          <option value={me}>Mine</option>
          {owners.filter((o) => o !== me).map((o) => (
            <option key={o} value={o}>
              {o.split("@")[0]}&apos;s
            </option>
          ))}
          <option value="none">Unassigned</option>
        </select>
        {track === "outreach" && <button
          type="button"
          className="pipeline-callable"
          aria-pressed={!!v.callable}
          onClick={() => setV({ ...v, callable: !v.callable })}
          title="Open leads where it's 8:30–5 on a weekday right now, best first"
        >
          <i aria-hidden="true" />
          Callable now <span>{callableNow.length}</span>
        </button>}
        {filtering && (
          <button type="button" className="btn btn-ghost btn-small" onClick={() => setV({ ...v, q: "", owner: "", callable: false, show: "" })}>
            Clear
          </button>
        )}
        <span className="pipeline-count" aria-live="polite">
          {filtering ? `${shown.length} of ${optimistic.length}` : `${optimistic.length} cards`}
        </span>
      </div>

      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}

      <>
          <div className="pipeline-jump" role="tablist" aria-label="Stages">
            {columns.map((column) => (
              <button
                key={column.key}
                type="button"
                role="tab"
                aria-selected={visible === column.key}
                data-stage={column.key}
                onClick={() => jumpTo(column.key)}
              >
                <i aria-hidden="true" />
                {column.label}
                <span>{shown.filter((c) => c.column === column.key).length}</span>
              </button>
            ))}
          </div>
          <div className="pipeline-board" ref={board}>
            {columns.map((column) => {
              const inColumn = shown.filter((c) => c.column === column.key);
              const total = inColumn.reduce((n, c) => n + c.valueCents, 0);
              const canDrop = dragging ? allowedColumns(dragging.type).includes(column.key) : false;
              return (
                <section
                  key={column.key}
                  className="pipeline-col"
                  data-empty={!inColumn.length && !dragging ? "" : undefined}
                  data-stage={column.key}
                  data-over={over === column.key && canDrop ? "" : undefined}
                  data-blocked={dragging && !canDrop ? "" : undefined}
                  aria-label={`${column.label}: ${inColumn.length} cards, ${money(total)}`}
                  onDragOver={(e) => {
                    if (!canDrop) return;
                    e.preventDefault();
                    setOver(column.key);
                  }}
                  onDragLeave={() => setOver((o) => (o === column.key ? null : o))}
                  onDrop={(e) => {
                    e.preventDefault();
                    setOver(null);
                    if (dragging) move(dragging, column.key);
                    setDragging(null);
                  }}
                >
                  <header className="pipeline-col-head">
                    <h2>
                      <i aria-hidden="true" />
                      {column.label} <span>{inColumn.length}</span>
                    </h2>
                    {total > 0 && <strong>{money(total)}</strong>}
                  </header>
                  <ul className="pipeline-cards">
                    {inColumn.map((card) => {
                      const href = open(card);
                      return (
                        <li
                          key={card.key}
                          className="pipeline-card"
                          draggable
                          data-dragging={dragging?.key === card.key ? "" : undefined}
                          onDragStart={(e) => {
                            e.dataTransfer.effectAllowed = "move";
                            e.dataTransfer.setData("text/plain", card.key);
                            setDragging(card);
                          }}
                          onDragEnd={() => {
                            setDragging(null);
                            setOver(null);
                          }}
                        >
                          <div className="pipeline-card-top">
                            <div className="pipeline-card-title">
                              {href ? (
                                <Link href={href} scroll={false}>
                                  {card.company}
                                </Link>
                              ) : (
                                <strong>{card.company}</strong>
                              )}
                              {(card.contact || card.location) && (
                                <span title={[card.contact, card.location].filter(Boolean).join(" · ")}>
                                  {[card.contact, card.location].filter(Boolean).join(" · ")}
                                </span>
                              )}
                              {card.source && <small>{card.source}</small>}
                            </div>
                            {card.owner ? (
                              <span className="pipeline-owner" title={card.owner.email}>
                                {card.owner.initials}
                              </span>
                            ) : card.type === "project" ? (
                              <form action={claimProject}>
                                <input type="hidden" name="projectId" value={card.id} />
                                <button className="pipeline-claim" title="Set an owner and agreed value" aria-label={`Set an owner for ${card.company}`}>
                                  +
                                </button>
                              </form>
                            ) : null}
                          </div>
                          {card.progress !== null && (
                            <div className="pipeline-progress" role="progressbar" aria-valuenow={card.progress} aria-valuemin={0} aria-valuemax={100} aria-label="Milestones done">
                              <span style={{ width: `${card.progress}%` }} />
                            </div>
                          )}
                          {(card.badNumber || card.signal || card.preview || card.closed) && (
                            <div className="pipeline-chips">
                              {card.badNumber && <span className="brief-tag" data-tag="BAD NUMBER">Bad number</span>}
                              {card.signal && <span className="signal-chip" title="What promoted it to the Pipeline">{card.signal}</span>}
                              {card.preview && <span className="preview-chip" data-status={card.preview.status}>Preview · {card.preview.label}</span>}
                              {card.closed && <span className="close-chip">{card.closed}</span>}
                            </div>
                          )}
                          {track === "active" && card.type === "deal" && card.column !== "won" && (
                            <p className="pipeline-next" data-missing={card.nextStep ? undefined : ""}>
                              <span>Next</span> {card.nextStep ?? (card.followUp ? "Follow up" : "No next step set")}
                            </p>
                          )}
                          {track === "outreach" && reach(card)}
                          <div className="pipeline-card-meta">
                            {card.value ? <strong className="pipeline-card-money">{card.value}</strong> : track === "active" && card.type === "deal" && <span className="pipeline-novalue">No value yet</span>}
                            {card.type === "deal" ? (
                              <FollowUpControl kind="deal" id={card.id} name={card.company} dueOn={card.followUpOn} note={card.nextStep} today={today} />
                            ) : (
                              card.followUp && (
                                <span className="lead-due" data-state={card.followUpState}>
                                  {card.followUp}
                                </span>
                              )
                            )}
                            <span className={card.stalled ? "pipeline-stalled" : undefined}>
                              {card.meta}
                              {card.paused && " · Paused"}
                              {card.paid && <b className="pipeline-paid"> · Paid</b>}
                            </span>
                            {stageSelect(card)}
                          </div>
                          {card.onboardHref && (
                            <Link className="pipeline-onboard" href={card.onboardHref}>
                              Start onboarding →
                            </Link>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  {!inColumn.length && <p className="pipeline-empty">{dragging && canDrop ? "Drop here" : v.callable ? "No one to call here right now" : filtering ? "No matches" : "Nothing here"}</p>}
                </section>
              );
            })}
          </div>
        </>
    </>
  );
}
