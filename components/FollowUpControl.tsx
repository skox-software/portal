"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { clearFollowUp, setFollowUp } from "@/app/admin/follow-ups/actions";
import { describeFollowUp, followUpState, REMIND_IN, remindIn } from "@/lib/follow-up";

type Props = {
  kind: "deal" | "client";
  id: string;
  /** Who it's for, for screen readers: "Remind me about Acme". */
  name: string;
  dueOn: string | null;
  note: string | null;
  /** Clients only: who gets reminded. Leads remind the deal's owner. */
  owner?: string | null;
  owners?: string[];
  me?: string;
  today: string;
  /** `compact`: a badge or "Remind" button that opens a small panel. `full`: the panel inline. */
  mode?: "compact" | "full";
};

/**
 * Set a follow-up in one tap: optionally type what it's for, then pick
 * "3 days", "1 week"… or a date. Done clears it as handled; Clear just
 * removes it. Shared by leads (pipeline and Clients) and client accounts.
 */
export function FollowUpControl({ kind, id, name, dueOn, note, owner, owners = [], me, today, mode = "compact" }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(mode === "full");
  const [text, setText] = useState(note ?? "");
  const [date, setDate] = useState("");
  const [who, setWho] = useState(owner ?? me ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const box = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  // Compact panels float above everything (lists and cards clip overflow), anchored under the button.
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const uid = useId();
  const state = followUpState(dueOn, today);
  const label = describeFollowUp(dueOn, today);

  // A compact panel closes on Escape or a click elsewhere.
  useEffect(() => {
    if (mode === "full" || !open) return;
    const onDown = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      }
    };
    // Scrolling the page would leave a fixed panel behind, so it closes instead.
    const onScroll = (e: Event) => {
      if (box.current && e.target instanceof Node && box.current.contains(e.target)) return;
      // On a phone the panel is docked at the bottom, and opening the keyboard scrolls and resizes the page.
      if (window.innerWidth <= 760) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open, mode]);

  function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    start(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.error ?? "That didn't save. Try again.");
        return;
      }
      setDate("");
      if (mode === "compact") setOpen(false);
      router.refresh();
    });
  }
  const save = (on: string) => run(() => setFollowUp({ kind, id, dueOn: on, note: text, ...(kind === "client" ? { owner: who } : {}) }));

  const panel = (
    <div
      className="followup-panel"
      role={mode === "compact" ? "dialog" : undefined}
      aria-label={mode === "compact" ? `Follow-up for ${name}` : undefined}
      style={mode === "compact" && at ? { top: at.top, left: at.left } : undefined}
      onClick={(e) => e.stopPropagation()}
    >
      {label && (
        <p className="followup-current">
          <span className="lead-due" data-state={state}>{label}</span>
          {note && <span className="followup-note">{note}</span>}
        </p>
      )}
      <label className="sr-only" htmlFor={`${uid}-note`}>
        What to follow up about
      </label>
      <input id={`${uid}-note`} value={text} onChange={(e) => setText(e.target.value)} maxLength={200} placeholder="What for? e.g. Check they got the proposal" />
      {kind === "client" && owners.length > 1 && (
        <>
          <label className="sr-only" htmlFor={`${uid}-owner`}>
            Who gets reminded
          </label>
          <select id={`${uid}-owner`} value={who} onChange={(e) => setWho(e.target.value)}>
            {owners.map((o) => (
              <option key={o} value={o}>
                Remind {o === me ? "me" : o.split("@")[0]}
              </option>
            ))}
          </select>
        </>
      )}
      <span className="followup-label">{dueOn ? "Move it to" : "Remind me in"}</span>
      <div className="followup-chips">
        {REMIND_IN.map((r) => (
          <button key={r.key} type="button" disabled={pending} onClick={() => save(remindIn(r.key, today))} title={remindIn(r.key, today)}>
            {r.label}
          </button>
        ))}
      </div>
      <div className="followup-date">
        <label className="sr-only" htmlFor={`${uid}-date`}>
          Pick a date
        </label>
        <input id={`${uid}-date`} type="date" min={today} value={date} onChange={(e) => setDate(e.target.value)} />
        <button type="button" className="btn btn-ghost btn-small" disabled={pending || !date} onClick={() => save(date)}>
          Set date
        </button>
      </div>
      {dueOn && (
        <div className="followup-actions">
          <button type="button" className="btn btn-primary btn-small" disabled={pending} onClick={() => run(() => clearFollowUp({ kind, id, done: true }))}>
            Done, reached out
          </button>
          <button type="button" className="btn btn-ghost btn-small" disabled={pending} onClick={() => run(() => clearFollowUp({ kind, id }))}>
            Remove
          </button>
        </div>
      )}
      {error && (
        <p className="followup-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );

  if (mode === "full") return <div className="followup followup-full" ref={box}>{panel}</div>;

  return (
    <div className="followup" ref={box}>
      <button
        ref={trigger}
        type="button"
        className="followup-trigger"
        data-state={state}
        aria-expanded={open}
        aria-label={label ? `Follow-up for ${name}: ${label}. Change it` : `Set a follow-up for ${name}`}
        title={note ?? undefined}
        onClick={(e) => {
          e.stopPropagation();
          const r = trigger.current?.getBoundingClientRect();
          if (r) {
            const width = Math.min(300, window.innerWidth - 24);
            const left = Math.max(12, Math.min(r.left, window.innerWidth - width - 12));
            // Open upwards when there isn't room below.
            const top = r.bottom + 330 > window.innerHeight ? Math.max(12, r.top - 330) : r.bottom + 6;
            setAt({ top, left });
          }
          setOpen((o) => !o);
        }}
      >
        {label ? <span className="lead-due" data-state={state}>{label}</span> : <span className="followup-add">+ Remind</span>}
      </button>
      {open && panel}
    </div>
  );
}
