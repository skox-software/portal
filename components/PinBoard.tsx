"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { addFeedback, type FeedbackState } from "@/app/projects/[id]/review/actions";

export type Pin = {
  id: string;
  x: number | null;
  y: number | null;
  body: string;
  tag: "love" | "change" | "must_fix";
  status: "open" | "in_progress" | "done" | "wont_do";
  author: string;
  number: number;
};

const TAGS = [
  { value: "change", label: "Change" },
  { value: "must_fix", label: "Must fix" },
  { value: "love", label: "Love it" },
] as const;

/**
 * Click anywhere on the design to drop a numbered pin and comment on that
 * spot. Positions are stored as percentages so pins stay put at any size.
 */
export function PinBoard({
  projectId,
  previewId,
  imageUrl,
  label,
  pins,
}: {
  projectId: string;
  previewId: string;
  imageUrl: string;
  label: string;
  pins: Pin[];
}) {
  const [draft, setDraft] = useState<{ x: number; y: number } | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState<FeedbackState, FormData>(async (previous, formData) => {
    const result = await addFeedback(previous, formData);
    if (result.status === "saved") {
      setDraft(null);
      form.current?.reset();
    }
    return result;
  }, { status: "idle" });

  useEffect(() => {
    if (draft) textarea.current?.focus();
  }, [draft]);

  function place(event: React.MouseEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest(".pin")) return;
    const rect = event.currentTarget.getBoundingClientRect();
    setDraft({
      x: Math.round(((event.clientX - rect.left) / rect.width) * 1000) / 10,
      y: Math.round(((event.clientY - rect.top) / rect.height) * 1000) / 10,
    });
  }

  return (
    <div className="pinboard">
      <div className="pin-stage" onClick={place} role="group" aria-label={`${label}. Click to add a comment at that spot.`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imageUrl} alt={label} draggable={false} />
        {pins
          .filter((p) => p.x != null && p.y != null)
          .map((p) => (
            <button
              key={p.id}
              type="button"
              className="pin"
              data-tag={p.tag}
              data-done={p.status === "done" || p.status === "wont_do" ? "true" : undefined}
              data-active={active === p.id ? "true" : undefined}
              style={{ left: `${p.x}%`, top: `${p.y}%` }}
              onClick={() => setActive(active === p.id ? null : p.id)}
              aria-label={`Comment ${p.number}: ${p.body}`}
            >
              {p.number}
            </button>
          ))}
        {draft && <span className="pin pin-draft" style={{ left: `${draft.x}%`, top: `${draft.y}%` }} aria-hidden="true" />}
      </div>

      <form ref={form} action={action} className="pin-form card">
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="previewId" value={previewId} />
        <input type="hidden" name="x" value={draft?.x ?? ""} />
        <input type="hidden" name="y" value={draft?.y ?? ""} />
        <p className="small muted">
          {draft ? "Pin placed. What should we know about this spot?" : "Tip: click on the design to pin your comment to an exact spot."}
        </p>
        <div className="tag-choice" role="radiogroup" aria-label="Type of comment">
          {TAGS.map((t, i) => (
            <label key={t.value} className="tag-option" data-tag={t.value}>
              <input type="radio" name="tag" value={t.value} defaultChecked={i === 0} />
              <span>{t.label}</span>
            </label>
          ))}
        </div>
        <label className="sr-only" htmlFor={`fb-${previewId}`}>
          Comment
        </label>
        <textarea ref={textarea} id={`fb-${previewId}`} name="body" required maxLength={2000} placeholder="e.g. Make this button bigger and use our navy" />
        <div className="row">
          <button className="btn btn-primary" type="submit" disabled={pending}>
            {pending ? "Sending…" : draft ? "Add pinned comment" : "Add comment"}
          </button>
          {draft && (
            <button type="button" className="btn btn-link small" onClick={() => setDraft(null)}>
              Remove pin
            </button>
          )}
          {state.status === "error" && (
            <span className="field-error" role="alert">
              {state.message}
            </span>
          )}
          {state.status === "saved" && (
            <span className="muted small" role="status">
              Sent to SKOX.
            </span>
          )}
        </div>
      </form>
    </div>
  );
}
