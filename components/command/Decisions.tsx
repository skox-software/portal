"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { decideProposal } from "@/app/admin/company/actions";

export type DecisionView = { id: string; seat: string; title: string; why: string; impact: string };

/** Up to three cards from the company inbox, decided right here. "Changes" asks what to change first. */
export function Decisions({ items, total }: { items: DecisionView[]; total: number }) {
  const [gone, setGone] = useState<Set<string>>(new Set());
  const left = items.filter((i) => !gone.has(i.id));
  const remaining = total - gone.size;
  return (
    <section aria-labelledby="cmd-dec">
      <div className="cmd-head">
        <h2 id="cmd-dec">Needs your decision {remaining > 0 && <span className="cmd-pill">{remaining}</span>}</h2>
        <Link className="cmd-link" href="/admin/company">See all</Link>
      </div>
      {left.length === 0 ? (
        <p className="cmd-clear">{remaining > 0 ? <>More in the <Link className="cmd-link" href="/admin/company">company inbox</Link>.</> : "All clear. Nothing waiting on you."}</p>
      ) : (
        left.map((d) => <Row key={d.id} d={d} onDone={() => setGone((g) => new Set(g).add(d.id))} />)
      )}
    </section>
  );
}

function Row({ d, onDone }: { d: DecisionView; onDone: () => void }) {
  const [changing, setChanging] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const [leaving, setLeaving] = useState(false);
  const decide = (decision: "approve" | "revise") =>
    start(async () => {
      setError(null);
      const res = await decideProposal({ id: d.id, decision, note: note.trim() || undefined });
      if (!res.ok) return setError(res.error);
      setLeaving(true);
      setTimeout(onDone, 300);
    });
  return (
    <div className="cmd-dec" data-leaving={leaving || undefined} aria-busy={busy || undefined}>
      <div className="cmd-dec-text">
        <div className="cmd-who">{d.seat}</div>
        <div className="cmd-t">{d.title}</div>
        <div className="cmd-w">{d.why}</div>
        {changing && (
          <label className="cmd-note">What should change?
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} autoFocus maxLength={1000}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && note.trim()) { e.preventDefault(); decide("revise"); } }} />
          </label>
        )}
        {error && <p className="cmd-error" role="alert">{error}</p>}
      </div>
      <div className="cmd-btns">
        {!changing ? (
          <>
            <button type="button" className="cmd-yes" disabled={busy} onClick={() => decide("approve")}>Approve</button>
            <button type="button" disabled={busy} onClick={() => setChanging(true)}>Changes</button>
          </>
        ) : (
          <>
            <button type="button" className="cmd-yes" disabled={busy || !note.trim()} onClick={() => decide("revise")}>Send back</button>
            <button type="button" disabled={busy} onClick={() => { setChanging(false); setNote(""); }}>Cancel</button>
          </>
        )}
      </div>
    </div>
  );
}
