"use client";

import { useState } from "react";
import { logCall } from "@/app/admin/pipeline/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { advanceAfterCall, OUTCOMES, type Outcome } from "@/lib/follow-up";
import { stageLabel, type DealStage } from "@/lib/pipeline";

const BUTTONS = OUTCOMES.filter((o) => o.button);

/**
 * Log this contact: pick what happened (optional), write a note (optional),
 * save. "Save & move" does the same and moves the lead to the next outreach
 * attempt, or to Close Outreach after "Not interested". Keys 1–6 pick an outcome.
 */
export function ContactLog({
  dealId,
  stage,
  base,
  back,
  nextId,
}: {
  dealId: string;
  stage: DealStage;
  base: string;
  back: string;
  nextId: string | null;
}) {
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [goNext, setGoNext] = useState(true);
  const advance = advanceAfterCall(stage, outcome);

  return (
    <form action={logCall} className="logcall contact-log" aria-labelledby={`log-${dealId}`}>
      <input type="hidden" name="dealId" value={dealId} />
      <input type="hidden" name="base" value={base} />
      <input type="hidden" name="back" value={back} />
      <input type="hidden" name="outcome" value={outcome ?? ""} />
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
            data-tone={o.value === "not_interested" || o.value === "bad_number" ? "danger" : undefined}
            aria-pressed={outcome === o.value}
            onClick={() => setOutcome(outcome === o.value ? null : o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
      {outcome === "emailed" && stage.startsWith("outreach_") && <p className="small muted">Saving moves this lead to Potential Deals · Emailed.</p>}
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
