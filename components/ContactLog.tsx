"use client";

import { useState } from "react";
import { logCall } from "@/app/admin/pipeline/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { advanceAfterCall, callEffect, OUTCOMES, type Outcome } from "@/lib/follow-up";
import { NOT_INTERESTED_REASONS, stageLabel, type DealStage } from "@/lib/pipeline";

const BUTTONS = OUTCOMES.filter((o) => o.button);

/**
 * Log this contact: pick what happened (optional), write a note (optional),
 * save. "Save & move" does the same and moves the lead to the next attempt.
 * "Interested" and "Preview requested" promote it to the Pipeline; "Not
 * interested" closes outreach and asks why in one tap. Keys 1–8 pick an outcome.
 */
export function ContactLog({
  dealId,
  stage,
  base,
  back,
  nextId,
  previewInFlight = false,
}: {
  /** A preview is already being built, so "Preview requested" won't queue another. */
  previewInFlight?: boolean;
  dealId: string;
  stage: DealStage;
  base: string;
  back: string;
  nextId: string | null;
}) {
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [goNext, setGoNext] = useState(true);
  const [reason, setReason] = useState("");
  const advance = advanceAfterCall(stage, outcome);
  const effect = outcome ? callEffect(stage, outcome) : null;

  return (
    <form action={logCall} className="logcall contact-log" aria-labelledby={`log-${dealId}`}>
      <input type="hidden" name="dealId" value={dealId} />
      <input type="hidden" name="base" value={base} />
      <input type="hidden" name="back" value={back} />
      <input type="hidden" name="outcome" value={outcome ?? ""} />
      <input type="hidden" name="reason" value={outcome === "not_interested" ? reason : ""} />
      {nextId && goNext && (
        <>
          <input type="hidden" name="nextId" value={nextId} />
          <input type="hidden" name="then" value="next" />
        </>
      )}
      <h3 className="logcall-legend" id={`log-${dealId}`}>
        Log this contact
      </h3>
      <div className="contact-log-outcomes" role="group" aria-label="What happened">
        {BUTTONS.map((o, i) => (
          <button
            key={o.value}
            type="button"
            className="contact-log-pill"
            data-shortcut={i + 1}
            data-tone={o.value === "not_interested" || o.value === "bad_number" ? "danger" : o.value === "interested" || o.value === "preview" ? "good" : undefined}
            aria-pressed={outcome === o.value}
            onClick={() => setOutcome(outcome === o.value ? null : o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
      {effect?.signal && <p className="small contact-log-effect">Saving promotes this lead to the Pipeline · {stageLabel(effect.stage)}{outcome === "preview" && !previewInFlight ? ", and queues the preview" : ""}.</p>}
      {outcome === "preview" && previewInFlight && <p className="small muted">A preview is already in progress; this logs the call.</p>}
      {outcome === "not_interested" && (
        <div className="contact-log-reasons">
          {effect?.closeReason && <p className="small muted">Saving closes outreach. Why weren&apos;t they interested?</p>}
          <div className="choice-chips" role="group" aria-label="Why not interested">
            {NOT_INTERESTED_REASONS.map((r) => (
              <button key={r.value} type="button" aria-pressed={reason === r.value} onClick={() => setReason(reason === r.value ? "" : r.value)}>
                {r.label}
              </button>
            ))}
          </div>
        </div>
      )}
      <label className="sr-only" htmlFor={`note-${dealId}`}>
        Note
      </label>
      <textarea id={`note-${dealId}`} name="note" rows={3} maxLength={2000} placeholder="Notes: who you spoke to, what they said, what's next" />
      <div className="contact-log-actions">
        <SubmitButton className="btn btn-primary" pendingLabel="Saving…">
          Save
        </SubmitButton>
        {advance && (
          <SubmitButton className="btn btn-ghost" name="intent" value="advance" pendingLabel="Saving…">
            Save &amp; move to {stageLabel(advance)}
          </SubmitButton>
        )}
        {nextId && (
          <label className="small muted contact-log-next">
            <input type="checkbox" checked={goNext} onChange={(e) => setGoNext(e.target.checked)} /> Then open the next lead
          </label>
        )}
      </div>
    </form>
  );
}
