"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { bulkUpdateDeals } from "@/app/admin/pipeline/actions";
import { followUpChoices, salesToday } from "@/lib/follow-up";
import { initials } from "@/lib/pipeline";

export type ClientRow = {
  key: string;
  /** Set for deals: only deals open in the panel, take bulk changes and log calls. */
  dealId: string | null;
  name: string;
  href: string;
  subtitle: string | null;
  contactName: string | null;
  contactEmail: string | null;
  phone: string | null;
  website: string | null;
  stage: string;
  valueCents: number;
  days: number | null;
  slow: boolean;
  source: string | null;
  owner: string | null;
  followUp: string | null;
  followUpState: "overdue" | "today" | "upcoming" | "none";
  followUpOn: string | null;
  nextStep: string | null;
  /** ISO time. */
  lastTouch: string | null;
  contacted: boolean;
  untouched: boolean;
  search: string;
};

export type ClientGroup = { key: string; label: string; rows: ClientRow[] };

const COLLAPSED_KEY = "skox.clients.collapsed";
const BULK_STAGES = [
  { key: "lead", label: "Lead" },
  { key: "initial_outreach", label: "Initial outreach" },
  { key: "proposal_sent", label: "Proposal sent" },
  { key: "negotiation", label: "Negotiation" },
  { key: "won", label: "Won" },
  { key: "lost", label: "Lost" },
];

// Folded groups live in this browser's storage; Lost starts folded.
const DEFAULT_COLLAPSED = '["lost"]';
const subscribeCollapsed = (onChange: () => void) => {
  window.addEventListener("storage", onChange);
  window.addEventListener(COLLAPSED_KEY, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(COLLAPSED_KEY, onChange);
  };
};
const readCollapsed = () => {
  try {
    return localStorage.getItem(COLLAPSED_KEY) ?? DEFAULT_COLLAPSED;
  } catch {
    return DEFAULT_COLLAPSED;
  }
};

const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100);
const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
const typing = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));

export function ClientsList({
  groups,
  openDealId,
  panelOpen,
  owners,
  me,
  empty,
}: {
  groups: ClientGroup[];
  openDealId: string | null;
  panelOpen: boolean;
  owners: string[];
  me: string;
  empty: string;
}) {
  const router = useRouter();
  const collapsedRaw = useSyncExternalStore(subscribeCollapsed, readCollapsed, () => DEFAULT_COLLAPSED);
  const collapsed = useMemo(() => new Set(JSON.parse(collapsedRaw) as string[]), [collapsedRaw]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [cursor, setCursor] = useState<number>(-1);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const list = useRef<HTMLDivElement>(null);

  const toggleGroup = (key: string) => {
    const next = new Set(collapsed);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    try {
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
    } catch {}
    window.dispatchEvent(new Event(COLLAPSED_KEY));
  };

  const visible = useMemo(() => groups.flatMap((g) => (collapsed.has(g.key) ? [] : g.rows)), [groups, collapsed]);
  const dealIds = useMemo(() => new Set(groups.flatMap((g) => g.rows.map((r) => r.dealId).filter(Boolean) as string[])), [groups]);
  // Drop selections that left the list (moved, filtered away).
  const picked = [...selected].filter((id) => dealIds.has(id));

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Keyboard on the list: J/K move, Enter opens, X selects, / searches. The panel has its own keys while open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "/" && !typing(e.target)) {
        e.preventDefault();
        document.getElementById("crm-search")?.focus();
        return;
      }
      if (panelOpen || typing(e.target)) return;
      if (e.key === "j" || e.key === "k") {
        e.preventDefault();
        setCursor((c) => {
          const n = e.key === "j" ? Math.min(visible.length - 1, c + 1) : Math.max(0, c - 1);
          list.current?.querySelector<HTMLElement>(`[data-row="${visible[n]?.key}"]`)?.scrollIntoView({ block: "nearest" });
          return n;
        });
      } else if ((e.key === "Enter" || e.key === "o") && visible[cursor]) {
        e.preventDefault();
        router.push(visible[cursor].href, { scroll: false });
      } else if (e.key === "x" && visible[cursor]?.dealId) {
        toggle(visible[cursor].dealId!);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panelOpen, visible, cursor, router]);

  // The owner menu filters as soon as it changes.
  useEffect(() => {
    const select = document.querySelector<HTMLSelectElement>("select[data-autosubmit]");
    const onChange = () => select?.form?.requestSubmit();
    select?.addEventListener("change", onChange);
    return () => select?.removeEventListener("change", onChange);
  }, []);

  function bulk(change: { stage?: string; ownerEmail?: string; nextStepOn?: string }, label: string) {
    if (!picked.length) return;
    setMessage(null);
    startTransition(async () => {
      const result = await bulkUpdateDeals({ ids: picked, ...change });
      if (!result.ok) {
        setMessage({ kind: "error", text: result.error });
        return;
      }
      setMessage({ kind: "ok", text: `${label} for ${result.count} ${result.count === 1 ? "deal" : "deals"}.` });
      setSelected(new Set());
      router.refresh();
    });
  }

  if (!groups.length) return <p className="admin-empty crm-table-card">{empty}</p>;
  const today = salesToday();

  return (
    <div className="crm-groups" ref={list}>
      {message && (
        <p className={`notice ${message.kind === "error" ? "notice-error" : "notice-ok"}`} role={message.kind === "error" ? "alert" : "status"}>
          {message.text}
        </p>
      )}
      {picked.length > 0 && (
        <div className="crm-bulk" role="region" aria-label="Change selected deals">
          <strong>{picked.length} selected</strong>
          <label className="sr-only" htmlFor="bulk-stage-move">
            Move selected to
          </label>
          <select id="bulk-stage-move" value="" disabled={pending} onChange={(e) => e.target.value && bulk({ stage: e.target.value }, `Moved to ${BULK_STAGES.find((s) => s.key === e.target.value)?.label}`)}>
            <option value="">Move to…</option>
            {BULK_STAGES.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
          <label className="sr-only" htmlFor="bulk-owner">
            Set owner
          </label>
          <select
            id="bulk-owner"
            value=""
            disabled={pending}
            onChange={(e) => e.target.value && bulk({ ownerEmail: e.target.value === "none" ? "" : e.target.value }, "Owner changed")}
          >
            <option value="">Owner…</option>
            <option value={me}>Me</option>
            {owners
              .filter((o) => o !== me)
              .map((o) => (
                <option key={o} value={o}>
                  {o.split("@")[0]}
                </option>
              ))}
            <option value="none">Unassigned</option>
          </select>
          <label className="sr-only" htmlFor="bulk-follow">
            Set follow-up
          </label>
          <select id="bulk-follow" value="" disabled={pending} onChange={(e) => e.target.value && bulk({ nextStepOn: e.target.value === "clear" ? "" : e.target.value }, "Follow-up set")}>
            <option value="">Follow up…</option>
            <option value={today}>Today</option>
            {followUpChoices(today).map((c) => (
              <option key={c.label} value={c.value}>
                {c.label}
              </option>
            ))}
            <option value="clear">No follow-up</option>
          </select>
          <button type="button" className="btn btn-ghost btn-small" onClick={() => setSelected(new Set())}>
            Clear selection
          </button>
        </div>
      )}

      {groups.map((g) => {
        const isCollapsed = collapsed.has(g.key);
        const groupDeals = g.rows.map((r) => r.dealId).filter(Boolean) as string[];
        const allPicked = groupDeals.length > 0 && groupDeals.every((id) => selected.has(id));
        const due = g.rows.filter((r) => r.followUpState === "overdue" || r.followUpState === "today").length;
        return (
          <section key={g.key} className="crm-group" data-stage={g.key} aria-labelledby={`group-${g.key}`}>
            <header className="crm-group-head">
              {groupDeals.length > 0 && (
                <input
                  type="checkbox"
                  aria-label={`Select every deal in ${g.label}`}
                  checked={allPicked}
                  onChange={() =>
                    setSelected((prev) => {
                      const next = new Set(prev);
                      for (const id of groupDeals) {
                        if (allPicked) next.delete(id);
                        else next.add(id);
                      }
                      return next;
                    })
                  }
                />
              )}
              <button type="button" id={`group-${g.key}`} aria-expanded={!isCollapsed} onClick={() => toggleGroup(g.key)}>
                <span className="crm-caret" aria-hidden="true" />
                <span className="crm-stage" data-stage={g.key}>
                  <i aria-hidden="true" />
                  {g.label}
                </span>
                <span className="crm-group-count">{g.rows.length}</span>
                {due > 0 && <span className="lead-due" data-state="today">{due} due</span>}
              </button>
            </header>
            {!isCollapsed && (
              <table className="crm-table crm-work">
                <thead>
                  <tr>
                    <th className="crm-check">
                      <span className="sr-only">Select</span>
                    </th>
                    <th>Company</th>
                    <th className="crm-hide-split">Contact</th>
                    <th>Reach</th>
                    <th>Follow-up</th>
                    <th className="crm-hide-split">Last touch</th>
                    <th className="crm-hide-split">In stage</th>
                    <th className="crm-num crm-hide-split">Value</th>
                    <th>
                      <span className="sr-only">Owner</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {g.rows.map((r) => {
                    const index = visible.indexOf(r);
                    const tel = r.phone ? `tel:${r.phone.replace(/[^\d+]/g, "")}` : null;
                    return (
                      <tr
                        key={r.key}
                        data-row={r.key}
                        data-open={r.dealId && r.dealId === openDealId ? "" : undefined}
                        data-cursor={index === cursor && !panelOpen ? "" : undefined}
                        data-picked={r.dealId && selected.has(r.dealId) ? "" : undefined}
                        onClick={(e) => {
                          if ((e.target as HTMLElement).closest("a,button,input,select,label")) return;
                          setCursor(index);
                          router.push(r.href, { scroll: false });
                        }}
                      >
                        <td className="crm-check">
                          {r.dealId && (
                            // The whole cell ticks the box, so a near miss never opens the lead instead.
                            <label className="crm-check-hit">
                              <input type="checkbox" aria-label={`Select ${r.name}`} checked={selected.has(r.dealId)} onChange={() => toggle(r.dealId!)} />
                            </label>
                          )}
                        </td>
                        <td className="crm-client" data-label="Company">
                          <Link href={r.href} scroll={false}>
                            {r.name}
                          </Link>
                          {(r.subtitle || r.source) && <small>{r.subtitle ?? r.source}</small>}
                        </td>
                        <td className="crm-contact crm-hide-split" data-label="Contact">
                          {r.contactName || r.contactEmail ? (
                            <>
                              <span>{r.contactName ?? r.contactEmail}</span>
                              {r.contactName && r.contactEmail && <small>{r.contactEmail}</small>}
                            </>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                        <td data-label="Reach">
                          {tel || r.contactEmail || r.website ? (
                            <span className="pipeline-reach">
                              {tel && (
                                <a href={tel} title={`Call ${r.phone}`} aria-label={`Call ${r.name}, ${r.phone}`}>
                                  Call
                                </a>
                              )}
                              {r.contactEmail && (
                                <a href={`mailto:${r.contactEmail}`} title={`Email ${r.contactEmail}`} aria-label={`Email ${r.name}`}>
                                  Email
                                </a>
                              )}
                              {r.website && (
                                <a href={r.website} target="_blank" rel="noreferrer" title={r.website} aria-label={`${r.name} website`}>
                                  Site ↗
                                </a>
                              )}
                            </span>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                        <td data-label="Follow-up">
                          {r.followUp ? (
                            <span className="lead-due" data-state={r.followUpState} title={r.nextStep ?? undefined}>
                              {r.followUp}
                            </span>
                          ) : r.dealId && r.stage !== "won" && r.stage !== "lost" ? (
                            <span className="muted small">{r.contacted ? "None set" : "Not contacted"}</span>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                        <td className="crm-mono crm-hide-split" data-label="Last touch">
                          {r.lastTouch ? shortDate(r.lastTouch) : "—"}
                        </td>
                        <td className="crm-mono crm-hide-split" data-label="In stage">
                          <span className={r.slow ? "crm-slow" : undefined}>{r.days === null ? "—" : `${r.days}d`}</span>
                        </td>
                        <td className="crm-num crm-mono crm-hide-split" data-label="Value">
                          {r.valueCents ? money(r.valueCents) : "—"}
                        </td>
                        <td data-label="Owner">
                          {r.owner ? (
                            <span className="crm-owner" title={r.owner} data-tone={initials(r.owner).charCodeAt(0) % 2 ? "amber" : "ink"}>
                              {initials(r.owner)}
                            </span>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>
        );
      })}
      <p className="crm-keys small muted">
        <kbd>J</kbd>/<kbd>K</kbd> move · <kbd>Enter</kbd> open · <kbd>X</kbd> select · <kbd>/</kbd> search · in a lead: <kbd>C</kbd> call · <kbd>E</kbd> email · <kbd>W</kbd> site · <kbd>1</kbd>–<kbd>5</kbd> log
        call · <kbd>Esc</kbd> close
      </p>
    </div>
  );
}
