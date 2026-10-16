"use client";

import { useState } from "react";
import { logCall } from "@/app/admin/pipeline/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { defaultFollowUp, followUpChoices, OUTCOMES, type Outcome } from "@/lib/follow-up";

/**
 * One tap for what happened, one for when to follow up. Picking an outcome
 * suggests a follow-up date; the chips or the date box change it.
 */
export function LogCallForm({
  dealId,
  today,
  base,
  back,
  nextId,
  nextStep,
}: {
  dealId: string;
  today: string;
  base: string;
  back: string;
  nextId: string | null;
  nextStep: string | null;
}) {
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [followUp, setFollowUp] = useState("");
  const closing = outcome === "not_interested";

  return (
    <form action={logCall} className="logcall" aria-labelledby={`logcall-${dealId}`}>
      <input type="hidden" name="dealId" value={dealId} />
      <input type="hidden" name="base" value={base} />
      <input type="hidden" name="back" value={back} />
      {nextId && <input type="hidden" name="nextId" value={nextId} />}
      <fieldset className="logcall-outcomes">
        <legend id={`logcall-${dealId}`}>Log a call</legend>
        {OUTCOMES.map((o, i) => (
          <label key={o.value} data-tone={o.value === "not_interested" ? "danger" : undefined}>
            <input
              type="radio"
              name="outcome"
              value={o.value}
              checked={outcome === o.value}
              onChange={() => {
                setOutcome(o.value);
                setFollowUp(defaultFollowUp(o.value, today) ?? "");
              }}
              required
              data-shortcut={i + 1}
            />
            <span>
              {o.label} <kbd>{i + 1}</kbd>
            </span>
          </label>
        ))}
      </fieldset>
      {outcome && (
        <>
          {!closing && (
            <div className="logcall-follow">
              <span className="logcall-label">Follow up</span>
              <div className="logcall-chips">
                {followUpChoices(today).map((c) => (
                  <button key={c.label} type="button" aria-pressed={followUp === c.value} onClick={() => setFollowUp(c.value)}>
                    {c.label}
                  </button>
                ))}
                <button type="button" aria-pressed={followUp === ""} onClick={() => setFollowUp("")}>
                  No follow-up
                </button>
              </div>
              <label className="sr-only" htmlFor={`followup-${dealId}`}>
                Follow-up date
              </label>
              <input id={`followup-${dealId}`} type="date" name="followUp" value={followUp} min={today} onChange={(e) => setFollowUp(e.target.value)} />
              <label className="sr-only" htmlFor={`nextstep-${dealId}`}>
                Next step
              </label>
              <input id={`nextstep-${dealId}`} name="nextStep" maxLength={200} defaultValue={nextStep ?? ""} placeholder="Next step, e.g. call back after 2pm" />
            </div>
          )}
          <label className="sr-only" htmlFor={`note-${dealId}`}>
            What happened
          </label>
          <textarea id={`note-${dealId}`} name="note" rows={2} maxLength={1000} placeholder={closing ? "Why? (optional)" : "What happened (optional)"} />
          <div className="logcall-actions">
            {nextId && (
              <SubmitButton className="btn btn-primary" name="intent" value="next" pendingLabel="Saving…">
                Log &amp; next
              </SubmitButton>
            )}
            <SubmitButton className={nextId ? "btn btn-ghost" : "btn btn-primary"} pendingLabel="Saving…">
              {closing ? "Close as not interested" : "Log call"}
            </SubmitButton>
          </div>
        </>
      )}
    </form>
  );
}
