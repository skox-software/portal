"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { moveDealStage } from "@/app/admin/crm-actions";
import { ALL_STAGES, BOARD_STAGES, formatDealValue, STAGE_LABEL, type DealStage } from "@/lib/crm";

export type BoardCard = {
  id: string;
  stage: DealStage;
  clientId: string;
  clientName: string;
  contactName: string | null;
  valueCents: number;
  kind: string | null;
  days: number;
  stalled: boolean;
  ownerInitials: string;
  ownerEmail: string | null;
  progress: { done: number; total: number } | null;
  /** Pre-formatted on the server: "Due Oct 14", "Shipped Sep 1 · Paid". */
  footLabel: string | null;
};

/**
 * The deal board. Drag a card to another column, or use its stage menu (the
 * keyboard and touch path). Moves show at once and roll back if the server
 * says no.
 */
export function PipelineBoard({ initial }: { initial: BoardCard[] }) {
  const [cards, setCards] = useState(initial);
  const [pending, setPending] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<DealStage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function move(id: string, stage: DealStage) {
    const before = cards.find((c) => c.id === id);
    if (!before || before.stage === stage) return;
    setError(null);
    setPending(id);
    setCards((all) => all.map((c) => (c.id === id ? { ...c, stage, days: 0, stalled: false, footLabel: null } : c)));
    startTransition(async () => {
      try {
        const result = await moveDealStage(id, stage);
        if (!result.ok) throw new Error(result.error);
      } catch (err) {
        setCards((all) => all.map((c) => (c.id === id ? before : c)));
        setError(`Couldn't move ${before.clientName}: ${(err as Error).message || "try again."}`);
      } finally {
        setPending(null);
      }
    });
  }

  return (
    <>
      {error && (
        <p className="notice notice-error board-error" role="alert">
          {error}
        </p>
      )}
      <div className="board">
        {BOARD_STAGES.map((stage) => {
          const list = cards.filter((c) => c.stage === stage);
          const total = list.reduce((s, c) => s + c.valueCents, 0);
          return (
            <section
              key={stage}
              className="board-col"
              data-stage={stage}
              data-drop={over === stage}
              aria-labelledby={`col-${stage}`}
              onDragOver={(e) => {
                if (!dragging) return;
                e.preventDefault();
                if (over !== stage) setOver(stage);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setOver(null);
                const id = e.dataTransfer.getData("text/plain");
                if (id) move(id, stage);
              }}
            >
              <div className="board-col-head">
                <span className="stage-dot" aria-hidden="true" />
                <h2 className="board-col-name" id={`col-${stage}`}>
                  {STAGE_LABEL[stage]}
                </h2>
                <span className="board-col-count">{list.length}</span>
                <span className="board-col-total">{formatDealValue(total)}</span>
              </div>
              {list.map((c) => (
                <article
                  key={c.id}
                  className="deal-card"
                  data-stage={c.stage}
                  data-dragging={dragging === c.id}
                  data-pending={pending === c.id}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData("text/plain", c.id);
                    e.dataTransfer.effectAllowed = "move";
                    setDragging(c.id);
                  }}
                  onDragEnd={() => {
                    setDragging(null);
                    setOver(null);
                  }}
                >
                  <Link className="deal-card-name" href={`/admin/clients/${c.clientId}?deal=${c.id}`} draggable={false}>
                    {c.clientName}
                  </Link>
                  {c.contactName && <div className="deal-card-contact">{c.contactName}</div>}
                  <div className="deal-card-row">
                    <span className="money">{formatDealValue(c.valueCents)}</span>
                    {c.kind && <span className="deal-kind">{c.kind}</span>}
                  </div>
                  {c.stage === "in_build" && c.progress && c.progress.total > 0 && (
                    <div className="deal-progress" title={`${c.progress.done} of ${c.progress.total} milestones done`}>
                      <span style={{ width: `${(c.progress.done / c.progress.total) * 100}%` }} />
                    </div>
                  )}
                  <div className="deal-card-foot">
                    {c.footLabel ? (
                      <span>{c.footLabel}</span>
                    ) : c.stalled ? (
                      <span className="stalled">{c.days}d · stalled</span>
                    ) : (
                      <span>{c.days}d in stage</span>
                    )}
                    <span className="owner" title={c.ownerEmail ?? "No owner"}>
                      {c.ownerInitials}
                    </span>
                  </div>
                  <label className="sr-only" htmlFor={`stage-${c.id}`}>
                    Stage for {c.clientName}
                  </label>
                  <select id={`stage-${c.id}`} value={c.stage} disabled={pending === c.id} onChange={(e) => move(c.id, e.target.value as DealStage)}>
                    {ALL_STAGES.map((s) => (
                      <option key={s} value={s}>
                        {STAGE_LABEL[s]}
                      </option>
                    ))}
                  </select>
                </article>
              ))}
            </section>
          );
        })}
      </div>
    </>
  );
}
