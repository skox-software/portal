"use client";

import Link from "next/link";
import { useOptimistic, useState, useTransition } from "react";
import { claimProject, moveCard } from "@/app/admin/pipeline/actions";
import { allowedColumns, COLUMNS, type CardType, type ColumnKey } from "@/lib/pipeline";

export type BoardCard = {
  key: string;
  type: CardType;
  id: string;
  column: ColumnKey;
  company: string;
  contact: string | null;
  value: string;
  valueCents: number;
  kind: string;
  owner: { initials: string; email: string } | null;
  /** "3d in stage", "Due Oct 14", "Shipped Sep 1"… */
  meta: string;
  stalled: boolean;
  href: string | null;
  source: string | null;
  progress: number | null;
  paid: boolean;
  paused: boolean;
  onboardHref: string | null;
};

type Column = { key: ColumnKey; label: string };
const STAGE_LABEL: Record<ColumnKey | "lost", string> = {
  ...(Object.fromEntries(COLUMNS.map((c) => [c.key, c.label])) as Record<ColumnKey, string>),
  lost: "Lost",
};

function money(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100);
}

export function PipelineBoard({ cards, columns }: { cards: BoardCard[]; columns: Column[] }) {
  const [optimistic, applyMove] = useOptimistic(cards, (state, move: { key: string; to: ColumnKey | "lost" }) =>
    move.to === "lost"
      ? state.filter((c) => c.key !== move.key)
      : state.map((c) => (c.key === move.key ? { ...c, column: move.to as ColumnKey, stalled: false } : c)),
  );
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState<BoardCard | null>(null);
  const [over, setOver] = useState<ColumnKey | null>(null);

  function move(card: BoardCard, to: ColumnKey | "lost") {
    if (card.column === to) return;
    if (!allowedColumns(card.type).includes(to)) {
      setError(
        card.type === "project"
          ? "Projects are already won: move them between Won, In build and Shipped."
          : "Start onboarding from the Won column to turn a deal into a build.",
      );
      return;
    }
    setError(null);
    startTransition(async () => {
      applyMove({ key: card.key, to });
      const result = await moveCard(card.type, card.id, to);
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <>
      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}
      <div className="pipeline-board">
        {columns.map((column) => {
          const inColumn = optimistic.filter((c) => c.column === column.key);
          const total = inColumn.reduce((n, c) => n + c.valueCents, 0);
          const canDrop = dragging ? allowedColumns(dragging.type).includes(column.key) : false;
          return (
            <section
              key={column.key}
              className="pipeline-col"
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
                <strong>{money(total)}</strong>
              </header>
              <ul className="pipeline-cards">
                {inColumn.map((card) => (
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
                        {card.href ? <Link href={card.href}>{card.company}</Link> : <strong>{card.company}</strong>}
                        {card.contact && <span title={card.contact}>{card.contact}</span>}
                        {card.source && <small>{card.source}</small>}
                      </div>
                      {card.owner ? (
                        <span className="pipeline-owner" title={card.owner.email}>
                          {card.owner.initials}
                        </span>
                      ) : card.type === "project" ? (
                        <form action={claimProject}>
                          <input type="hidden" name="projectId" value={card.id} />
                          <button className="pipeline-claim" title="Set an owner and agreed value" aria-label={`Set an owner for ${card.company}`}>+</button>
                        </form>
                      ) : null}
                    </div>
                    <div className="pipeline-card-value">
                      <strong data-empty={card.valueCents ? undefined : ""}>{card.value}</strong>
                      <span className="pipeline-tag" title={card.kind}>{card.kind}</span>
                    </div>
                    {card.progress !== null && (
                      <div className="pipeline-progress" role="progressbar" aria-valuenow={card.progress} aria-valuemin={0} aria-valuemax={100} aria-label="Milestones done">
                        <span style={{ width: `${card.progress}%` }} />
                      </div>
                    )}
                    <div className="pipeline-card-meta">
                      <span className={card.stalled ? "pipeline-stalled" : undefined}>
                        {card.meta}
                        {card.paused && " · Paused"}
                        {card.paid && <b className="pipeline-paid"> · Paid</b>}
                      </span>
                    </div>
                    {card.onboardHref && (
                      <Link className="pipeline-onboard" href={card.onboardHref}>
                        Start onboarding →
                      </Link>
                    )}
                    <label className="sr-only" htmlFor={`stage-${card.key}`}>
                      Stage for {card.company}
                    </label>
                    <select
                      id={`stage-${card.key}`}
                      className="pipeline-stage"
                      value={card.column}
                      onChange={(e) => move(card, e.target.value as ColumnKey | "lost")}
                    >
                      {allowedColumns(card.type).map((key) => (
                        <option key={key} value={key}>
                          {STAGE_LABEL[key]}
                        </option>
                      ))}
                    </select>
                  </li>
                ))}
              </ul>
              {!inColumn.length && <p className="pipeline-empty">{dragging && canDrop ? "Drop here" : "Nothing here"}</p>}
            </section>
          );
        })}
      </div>
    </>
  );
}
