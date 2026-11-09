"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { decideProposal } from "@/app/admin/company/actions";
import { DEPARTMENTS, KIND_LABEL, SEATS, chainToOwner, seatByKey, seatPulse, type OwnerDecision, type SeatStatus } from "@/lib/company";
import { BOXES, H, W, edgePath, routeUp } from "./geometry";

export type CardView = {
  id: string;
  seat: string;
  kind: string;
  title: string;
  why: string;
  body: string | null;
  impact: string;
  confidence: number;
  wrongIf: string | null;
  links: { label: string; url: string }[] | null;
  status: string;
  createdAt: string;
  decidedAt: string | null;
  decisionNote: string | null;
  edited: boolean;
  doneAt: string | null;
  doneNote: string | null;
};
export type RunView = { seat: string; at: string; summary: string; outcome: string };
export type Score = { actedOn: number; approvedTotal: number; medianActHours: number | null; waiting: number; medianHours: number | null; approvedWeek: number; deniedWeek: number; editRate: number | null; runsWeek: number; liveSeats: number };

const MOTION = "(prefers-reduced-motion: reduce)";
function subscribeMotion(on: () => void) {
  const mq = window.matchMedia(MOTION);
  mq.addEventListener("change", on);
  return () => mq.removeEventListener("change", on);
}

type Flight = { id: string; seat: string; tone: "approve" | "deny" };

const deptOf = (key: string) => seatByKey.get(key)?.department ?? "ceo";
const ago = (iso: string, now: number) => {
  const m = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (m < 60) return `${Math.max(m, 1)} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
};

export function CompanyBoard({ cards, runs, score, now }: { cards: CardView[]; runs: RunView[]; score: Score; now: string }) {
  const nowMs = new Date(now).getTime();
  const [selected, setSelected] = useState<string>("claude");
  const [flights, setFlights] = useState<Flight[]>([]);
  const [gone, setGone] = useState<Set<string>>(new Set());
  const reduce = useSyncExternalStore(subscribeMotion, () => window.matchMedia(MOTION).matches, () => false);
  const stage = useRef<HTMLDivElement>(null);
  // On a phone the tree scrolls sideways; start it centred on Josh and Claude.
  useEffect(() => {
    const centre = () => {
      const el = stage.current;
      if (el && el.scrollWidth > el.clientWidth) el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2;
    };
    const el = stage.current;
    if (!el) return;
    const ro = new ResizeObserver(centre);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Decisions light the chain from Josh down to the seat, one node at a time.
  const [flash, setFlash] = useState<Map<string, Flight["tone"]>>(new Map());
  // A slight tilt toward the pointer gives the tree depth (mouse only, never with reduced motion).
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  function onTilt(e: React.PointerEvent<HTMLDivElement>) {
    if (reduce || e.pointerType !== "mouse") return;
    const r = e.currentTarget.getBoundingClientRect();
    setTilt({ x: ((e.clientY - r.top) / r.height - 0.5) * -5, y: ((e.clientX - r.left) / r.width - 0.5) * 6 });
  }

  // Keyboard: J/K move between cards, A approves, D starts a denial.
  const [cursor, setCursor] = useState(0);
  useEffect(() => {
    function key(e: KeyboardEvent) {
      const t = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || t.closest("input, textarea, select, [contenteditable]")) return;
      const list = [...document.querySelectorAll<HTMLElement>(".co-card")];
      if (!list.length) return;
      const k = e.key.toLowerCase();
      if (k === "j" || k === "k") {
        e.preventDefault();
        setCursor((c) => {
          const n = Math.max(0, Math.min(list.length - 1, c + (k === "j" ? 1 : -1)));
          list[n]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
          return n;
        });
      } else if (k === "a" || k === "d" || k === "c" || k === "n") {
        const card = list[Math.min(cursor, list.length - 1)];
        const btn = card?.querySelector<HTMLButtonElement>({ a: ".co-approve", d: "[data-deny]", c: "[data-revise]", n: "[data-note]" }[k]);
        if (btn && !btn.disabled) { e.preventDefault(); btn.click(); }
      }
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [cursor]);

  const lastRun = useMemo(() => {
    const m = new Map<string, RunView>();
    for (const r of runs) if (!m.has(r.seat) || new Date(r.at) > new Date(m.get(r.seat)!.at)) m.set(r.seat, r);
    return m;
  }, [runs]);
  const pending = cards.filter((c) => c.status === "pending" && !gone.has(c.id));
  const pendingBySeat = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of pending) for (const k of chainToOwner(c.seat).slice(0, 1)) m.set(k, (m.get(k) ?? 0) + 1);
    return m;
  }, [pending]);
  const pulse = (key: string): ReturnType<typeof seatPulse> => {
    const s = seatByKey.get(key)!;
    // Departments glow when any seat under them is working.
    if (s.title === "Department") {
      const kids = SEATS.filter((k) => k.parent === key).map((k) => pulse(k.key));
      return kids.includes("working") ? "working" : kids.includes("active") ? "active" : "idle";
    }
    if (key === "josh") return pending.length ? "working" : "active";
    const r = lastRun.get(key);
    return seatPulse(s.status as SeatStatus, r ? new Date(r.at) : null, new Date(nowMs));
  };

  function launch(seat: string, tone: Flight["tone"]) {
    if (reduce) return;
    const id = `${seat}-${Date.now()}`;
    setFlights((f) => [...f, { id, seat, tone }]);
    setTimeout(() => setFlights((f) => f.filter((x) => x.id !== id)), 1900);
    chainToOwner(seat).reverse().forEach((k, i) => {
      setTimeout(() => setFlash((m) => new Map(m).set(k, tone)), i * 320);
      setTimeout(() => setFlash((m) => { const n = new Map(m); n.delete(k); return n; }), i * 320 + 900);
    });
  }

  return (
    <div className="co">
      <dl className="co-score" aria-label="Scorecard">
        <div><dt>Waiting on you</dt><dd>{pending.length}</dd></div>
        <div><dt>Median time to decide</dt><dd>{score.medianHours === null ? "—" : score.medianHours < 1 ? "<1 h" : `${Math.round(score.medianHours)} h`}</dd></div>
        <div><dt>Approved this week</dt><dd>{score.approvedWeek}</dd></div>
        <div><dt>Denied this week</dt><dd>{score.deniedWeek}</dd></div>
        <div><dt>Edited before approval</dt><dd>{score.editRate === null ? "—" : `${Math.round(score.editRate * 100)}%`}</dd></div>
        <div><dt>Approvals carried out</dt><dd>{score.approvedTotal ? `${score.actedOn} of ${score.approvedTotal}` : "—"}<small>{score.medianActHours === null ? "" : ` · ~${score.medianActHours < 1 ? "<1" : Math.round(score.medianActHours)} h`}</small></dd></div>
        <div><dt>Seat runs this week</dt><dd>{score.runsWeek}</dd></div>
        <div><dt>Seats live</dt><dd>{score.liveSeats} of {SEATS.filter((s) => s.title !== "Department" && s.key !== "josh").length}</dd></div>
      </dl>

      <div className="co-stage" onPointerMove={onTilt} onPointerLeave={() => setTilt({ x: 0, y: 0 })}>
        <div className="co-scroll" ref={stage}>
        <svg style={{ transform: `perspective(1600px) rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)` }} viewBox={`0 0 ${W} ${H}`} className="co-tree" role="group" aria-label="The UnBusy company tree">
          <defs>
            <filter id="co-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="6" result="b" />
              <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            <radialGradient id="co-halo"><stop offset="0" stopColor="#0b5cff" stopOpacity=".55" /><stop offset="1" stopColor="#0b5cff" stopOpacity="0" /></radialGradient>
          </defs>

          <g className="co-edges">
            {SEATS.map((s) => {
              const d = edgePath(s.key);
              if (!d) return null;
              const p = pulse(s.key);
              return (
                <g key={s.key} data-pulse={p} data-planned={s.status === "planned" || undefined}>
                  <path d={d} className="co-edge" />
                  {!reduce && (p === "working" || p === "active") && <path d={d} className="co-flow" />}
                </g>
              );
            })}
          </g>

          {!reduce && pending.slice(0, 12).map((c, i) => (
            <g key={c.id} className={`co-dot co-dot-${c.impact}`} data-dept={deptOf(c.seat)} filter="url(#co-glow)" opacity="0">
              <rect x="-8" y="-6" width="16" height="12" rx="2.5" />
              <path d="M -4.5 -2 H 4.5 M -4.5 1 H 2" className="co-dot-lines" />
              <animateMotion dur="3.8s" begin={`${(i * 0.9) % 3.8}s`} repeatCount="indefinite" path={routeUp(c.seat)} />
              <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;.12;.86;1" dur="3.8s" begin={`${(i * 0.9) % 3.8}s`} repeatCount="indefinite" />
            </g>
          ))}

          {flights.map((f) => <FlightDot key={f.id} seat={f.seat} tone={f.tone} />)}

          {SEATS.map((s) => {
            const b = BOXES.get(s.key)!;
            const p = pulse(s.key);
            const n = s.key === "josh" ? pending.length : pendingBySeat.get(s.key) ?? 0;
            const isDept = s.title === "Department";
            return (
              <g
                key={s.key}
                className="co-node"
                data-dept={s.department}
                data-pulse={p}
                data-kind={isDept ? "dept" : s.key === "josh" ? "owner" : s.key === "claude" ? "ceo" : "seat"}
                data-planned={s.status === "planned" || undefined}
                data-selected={selected === s.key || undefined}
                data-flash={flash.get(s.key)}
                transform={`translate(${b.x - b.w / 2} ${b.y - b.h / 2})`}
                role="button"
                tabIndex={0}
                aria-label={`${s.name}, ${s.title}${s.status === "planned" ? ", planned" : ""}${n ? `, ${n} waiting` : ""}`}
                onClick={() => setSelected(s.key)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelected(s.key); } }}
              >
                {(p === "working" || (s.key === "josh" && n > 0)) && !reduce && (
                  <ellipse cx={b.w / 2} cy={b.h / 2} rx={b.w * 0.75} ry={b.h * 1.1} fill="url(#co-halo)" className="co-halo" />
                )}
                <rect width={b.w} height={b.h} rx="12" className="co-box" />
                <circle cx={16} cy={b.h / 2} r="4.5" className="co-led" />
                <text x={30} y={b.h / 2 - (isDept ? 2 : 4)} className="co-name">{s.name}</text>
                <text x={30} y={b.h / 2 + 14} className="co-title">{s.status === "planned" ? "Planned" : isDept ? s.number : s.title}</text>
                {n > 0 && (
                  <g transform={`translate(${b.w - 16} 0)`} className="co-badge">
                    <circle r="12" />
                    <text y="4.5" textAnchor="middle">{n}</text>
                  </g>
                )}
              </g>
            );
          })}
        </svg>
        </div>
        <Feed runs={runs} reduce={reduce} />
        <p className="co-legend"><span data-l="working" />Working now <span data-l="active" />Ran in the last 2 days <span data-l="idle" />Idle <span data-l="planned" />Planned <span data-l="card" />Card on its way to you</p>
      </div>

      <div className="co-grid">
        <section className="co-inbox" aria-labelledby="co-inbox-h">
          <h2 id="co-inbox-h">Waiting on you <span>{pending.length}</span></h2>
          {pending.length === 0 && <p className="co-empty">Nothing waiting. Seats send cards here when they need a yes.</p>}
          {pending.length > 0 && <p className="co-keys" aria-hidden="true"><kbd>J</kbd><kbd>K</kbd> move <kbd>A</kbd> approve <kbd>N</kbd> with a note <kbd>C</kbd> changes <kbd>D</kbd> deny</p>}
          {pending.map((c, i) => (
            <Card key={c.id} focused={i === Math.min(cursor, pending.length - 1)} card={c} nowMs={nowMs} onDecided={(tone) => { setGone((g) => new Set(g).add(c.id)); launch(c.seat, tone); }} onSeat={setSelected} />
          ))}
          <Decided cards={cards} nowMs={nowMs} />
        </section>
        <SeatPanel seatKey={selected} lastRun={lastRun.get(selected)} nowMs={nowMs} cards={cards} />
      </div>
    </div>
  );
}

/** The live feed: the latest real runs, typed out one after another. */
function Feed({ runs, reduce }: { runs: RunView[]; reduce: boolean }) {
  const lines = useMemo(
    () => [...runs].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8).map((r) => {
      const t = new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/New_York" }).format(new Date(r.at));
      return `${t}  ${(seatByKey.get(r.seat)?.name ?? r.seat).toUpperCase()} \u203a ${r.summary}${r.outcome === "error" ? "  [ERROR]" : ""}`;
    }),
    [runs],
  );
  const [line, setLine] = useState(0);
  const [chars, setChars] = useState(0);
  useEffect(() => {
    if (!lines.length) return;
    const full = lines[line % lines.length];
    const id = setTimeout(() => {
      if (reduce || chars >= full.length) { setChars(0); setLine((l) => (l + 1) % lines.length); }
      else setChars((c) => c + 1);
    }, reduce ? 4000 : chars >= full.length ? 2600 : 24);
    return () => clearTimeout(id);
  }, [chars, line, lines, reduce]);
  if (!lines.length) return <p className="co-feed">NO RUNS YET › seats report here when they work</p>;
  const full = lines[line % lines.length];
  return (
    <p className="co-feed" aria-live="off">
      <span className="co-feed-tag">LIVE</span>
      <span>{reduce ? full : full.slice(0, chars)}</span>
      <span className="co-caret" aria-hidden="true" />
    </p>
  );
}

/** One card flying from Josh back down to its seat after a decision. */
function FlightDot({ seat, tone }: { seat: string; tone: "approve" | "deny" }) {
  const motion = useRef<SVGAnimateMotionElement>(null);
  useEffect(() => { motion.current?.beginElement(); }, []);
  return (
    <circle r="7" className={`co-flight co-flight-${tone}`} filter="url(#co-glow)">
      <animateMotion ref={motion} dur="1.6s" begin="indefinite" fill="freeze" keyPoints="1;0" keyTimes="0;1" calcMode="linear" path={routeUp(seat)} />
    </circle>
  );
}

function Card({ card, focused, nowMs, onDecided, onSeat }: { card: CardView; focused: boolean; nowMs: number; onDecided: (tone: "approve" | "deny") => void; onSeat: (k: string) => void }) {
  const seat = seatByKey.get(card.seat);
  const [body, setBody] = useState(card.body ?? "");
  /** null: no note box; otherwise the action the note goes with. */
  const [mode, setMode] = useState<null | "approve" | "revise" | "deny">(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const edited = body !== (card.body ?? "");
  const decide = (decision: OwnerDecision) =>
    start(async () => {
      setError(null);
      const res = await decideProposal({ id: card.id, decision, note: note.trim() || undefined, body: card.body === null ? undefined : body });
      if (res.ok) onDecided(decision === "approve" ? "approve" : "deny");
      else setError(res.error);
    });
  const prompt = { approve: "Note for the seat (optional): how to carry it out", revise: "What should change? The seat redoes it and sends it back.", deny: "Why not? The seat learns from this." } as const;
  return (
    <article className="co-card" data-impact={card.impact} data-focused={focused || undefined} aria-busy={busy || undefined}>
      <header>
        <button type="button" className="co-card-seat" data-dept={deptOf(card.seat)} onClick={() => onSeat(card.seat)}>{seat?.name ?? card.seat}</button>
        <span>{KIND_LABEL[card.kind as keyof typeof KIND_LABEL] ?? card.kind}</span>
        <span className="co-impact">{card.impact} impact</span>
        <span>{card.confidence}% sure</span>
        <span className="co-when">{ago(card.createdAt, nowMs)}</span>
      </header>
      <h3>{card.title}</h3>
      <p>{card.why}</p>
      {card.wrongIf && <p className="co-wrong"><strong>Wrong if:</strong> {card.wrongIf}</p>}
      {card.body !== null && (
        <details>
          <summary>The draft{edited ? " (edited)" : ""}</summary>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={Math.min(14, Math.max(4, body.split("\n").length + 1))} aria-label="Draft; edit before approving if needed" />
        </details>
      )}
      {card.links && card.links.length > 0 && (
        <ul className="co-links">{card.links.map((l) => <li key={l.url}><a href={l.url} target="_blank" rel="noreferrer">{l.label}</a></li>)}</ul>
      )}
      {mode && (
        <label className="co-reason" data-mode={mode}>{prompt[mode]}
          <textarea value={note} onChange={(e) => setNote(e.target.value)} autoFocus maxLength={1000} rows={3}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && (mode === "approve" || note.trim())) decide(mode); }} />
        </label>
      )}
      {error && <p className="co-error" role="alert">{error}</p>}
      <footer>
        {!mode ? (
          <>
            <button type="button" className="btn co-approve" disabled={busy} onClick={() => decide("approve")}>{edited ? "Approve with edits" : "Approve"}</button>
            <button type="button" className="btn btn-ghost" data-note disabled={busy} onClick={() => setMode("approve")}>Approve with a note</button>
            <button type="button" className="btn btn-ghost" data-revise disabled={busy} onClick={() => setMode("revise")}>Changes</button>
            <button type="button" className="btn btn-ghost" data-deny disabled={busy} onClick={() => setMode("deny")}>Deny</button>
          </>
        ) : (
          <>
            <button type="button" className={`btn ${mode === "deny" ? "co-deny" : mode === "revise" ? "co-revise" : "co-approve"}`} disabled={busy || (mode !== "approve" && !note.trim())} onClick={() => decide(mode)}>
              {mode === "approve" ? (edited ? "Approve edits with note" : "Approve with note") : mode === "revise" ? "Send back for changes" : "Deny with reason"}
            </button>
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => { setMode(null); setNote(""); }}>Back</button>
          </>
        )}
      </footer>
    </article>
  );
}

function Decided({ cards, nowMs }: { cards: CardView[]; nowMs: number }) {
  const approved = cards.filter((c) => c.status === "approved");
  const recent = cards.filter((c) => c.status === "denied" || c.status === "done").slice(0, 12);
  const revise = cards.filter((c) => c.status === "revise");
  if (!approved.length && !recent.length && !revise.length) return null;
  return (
    <div className="co-decided">
      {approved.length > 0 && (
        <details open>
          <summary>Approved, waiting for the seat to carry it out <span>{approved.length}</span></summary>
          <ul>{approved.map((c) => <li key={c.id}><b>{seatByKey.get(c.seat)?.name}</b> {c.title}{c.decisionNote && <> — <i>&ldquo;{c.decisionNote}&rdquo;</i></>} <i>approved {c.decidedAt ? ago(c.decidedAt, nowMs) : ""}</i></li>)}</ul>
        </details>
      )}
      {revise.length > 0 && (
        <details open>
          <summary>Sent back for changes <span>{revise.length}</span></summary>
          <ul>{revise.map((c) => <li key={c.id}><b>{seatByKey.get(c.seat)?.name}</b> {c.title}{c.decisionNote && <> — <i>{c.decisionNote}</i></>}</li>)}</ul>
        </details>
      )}
      {recent.length > 0 && (
        <details>
          <summary>Recently done or denied <span>{recent.length}</span></summary>
          <ul>{recent.map((c) => <li key={c.id} data-status={c.status}><b>{seatByKey.get(c.seat)?.name}</b> {c.title}{c.status === "done" ? (c.doneNote && <> — <span className="co-done-note">Done: {c.doneNote}</span></>) : c.decisionNote && <> — <i>{c.decisionNote}</i></>}</li>)}</ul>
        </details>
      )}
    </div>
  );
}

function SeatPanel({ seatKey, lastRun, nowMs, cards }: { seatKey: string; lastRun?: RunView; nowMs: number; cards: CardView[] }) {
  const s = seatByKey.get(seatKey)!;
  const isDept = s.title === "Department";
  const kids = isDept ? SEATS.filter((k) => k.parent === s.key) : [];
  const mine = cards.filter((c) => c.seat === s.key);
  return (
    <aside className="co-seat" data-dept={s.department} aria-live="polite">
      <p className="co-seat-kicker">{isDept ? "Department" : s.title}{s.status === "planned" ? " · planned" : ""}</p>
      <h2>{s.name}</h2>
      <p>{s.mission}</p>
      <dl>
        <div><dt>Answers for</dt><dd>{s.number}</dd></div>
        {s.schedule && <div><dt>Runs</dt><dd>{s.schedule}</dd></div>}
        {!isDept && s.key !== "josh" && <div><dt>Last run</dt><dd>{lastRun ? `${ago(lastRun.at, nowMs)} — ${lastRun.summary}` : s.status === "planned" ? "Not switched on yet" : "No runs yet"}</dd></div>}
        {mine.length > 0 && <div><dt>Cards</dt><dd>{mine.filter((c) => c.status === "pending").length} waiting · {mine.filter((c) => c.status === "approved" || c.status === "done").length} approved · {mine.filter((c) => c.status === "denied").length} denied</dd></div>}
      </dl>
      {s.decides.length > 0 && <><h3>Decides alone</h3><ul>{s.decides.map((d) => <li key={d}>{d}</li>)}</ul></>}
      {s.asks.length > 0 && <><h3>Asks you first</h3><ul>{s.asks.map((d) => <li key={d}>{d}</li>)}</ul></>}
      {kids.length > 0 && <><h3>Seats</h3><ul>{kids.map((k) => <li key={k.key}>{k.name}{k.status === "planned" ? " (planned)" : ""}</li>)}</ul></>}
      {s.key !== "josh" && <p className="co-never">Never: send, spend, publish, bill or sign without your yes; invent proof; name AI as the method.</p>}
    </aside>
  );
}

export const DEPT_ORDER = DEPARTMENTS.map((d) => d.key);
