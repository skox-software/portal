"use client";

import { useState } from "react";
import { logCall } from "@/app/admin/pipeline/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { defaultFollowUp, describeFollowUp, followUpChoices, OUTCOMES, type Outcome } from "@/lib/follow-up";

const BUTTONS = OUTCOMES.filter((o) => o.button);
/** These need one more thing before saving: a name, or what was said. */
const EXPANDS: Outcome[] = ["gatekeeper", "spoke"];

/**
 * One tap per outcome. Each saves with a sensible follow-up and moves on to
 * the next lead in the queue. Gatekeeper asks for the name first; Talked
 * opens a note and the follow-up date. Keys 1–6 press the buttons.
 */
export function LogCallForm({
  dealId,
  today,
  base,
  back,
  nextId,
  nextStep,
  action = logCall,
}: {
  /** The server action that saves it. Reps use their own, which checks the lead is theirs. */
  action?: (formData: FormData) => Promise<void>;
  dealId: string;
  today: string;
  base: string;
  back: string;
  nextId: string | null;
  nextStep: string | null;
}) {
  const [open, setOpen] = useState<Outcome | null>(null);
  const [followUp, setFollowUp] = useState("");
  const [showNote, setShowNote] = useState(false);
  const label = nextId ? "& next" : "";

  return (
    <form
      action={action}
      className="logcall"
      aria-labelledby={`logcall-${dealId}`}
      onKeyDown={(e) => {
        // Enter in a text box would press the first button (No answer); press the open outcome's instead.
        if (e.key !== "Enter" || !(e.target instanceof HTMLInputElement)) return;
        e.preventDefault();
        const submit = open && e.currentTarget.querySelector<HTMLButtonElement>(`.logcall-more button[type=submit][value="${open}"]`);
        if (submit) e.currentTarget.requestSubmit(submit);
      }}
    >
      <input type="hidden" name="dealId" value={dealId} />
      <input type="hidden" name="base" value={base} />
      <input type="hidden" name="back" value={back} />
      {nextId && (
        <>
          <input type="hidden" name="nextId" value={nextId} />
          <input type="hidden" name="intent" value="next" />
        </>
      )}
      <div className="logcall-head">
        <span className="logcall-legend" id={`logcall-${dealId}`}>
          Log the call
        </span>
        {nextId && <span className="muted small">Saves and opens the next lead</span>}
      </div>
      <div className="logcall-buttons" role="group" aria-labelledby={`logcall-${dealId}`}>
        {BUTTONS.map((o, i) => {
          const date = o.followUpDays ? describeFollowUp(defaultFollowUp(o.value, today), today) : null;
          const due = date === "Tomorrow" ? "tomorrow" : date;
          const expands = EXPANDS.includes(o.value);
          const tone = o.value === "not_interested" || o.value === "bad_number" ? "danger" : undefined;
          return expands ? (
            <button
              key={o.value}
              type="button"
              className="logcall-btn"
              data-tone={tone}
              data-shortcut={i + 1}
              aria-expanded={open === o.value}
              onClick={() => {
                setOpen(open === o.value ? null : o.value);
                setFollowUp(defaultFollowUp(o.value, today) ?? "");
              }}
            >
              <span>{o.label}</span>
              <small>{due ? `Follow up ${due}` : "…"}</small>
              <kbd>{i + 1}</kbd>
            </button>
          ) : (
            <SubmitButton key={o.value} className="logcall-btn" name="outcome" value={o.value} data-tone={tone} data-shortcut={i + 1} pendingLabel="Saving…">
              <span>{o.label}</span>
              <small>{o.value === "not_interested" ? "Closes the lead" : o.value === "bad_number" ? "Flags the number" : `Follow up ${due}`}</small>
              <kbd>{i + 1}</kbd>
            </SubmitButton>
          );
        })}
      </div>

      {open === "gatekeeper" && (
        <div className="logcall-more">
          <label htmlFor={`gk-${dealId}`}>Who answered?</label>
          <input id={`gk-${dealId}`} name="gatekeeper" maxLength={80} autoFocus placeholder="Name, e.g. Sarah at the front desk" autoComplete="off" />
          <input type="hidden" name="followUp" value={followUp} />
          <SubmitButton className="btn btn-primary" name="outcome" value="gatekeeper" pendingLabel="Saving…">
            Log gatekeeper {label}
          </SubmitButton>
        </div>
      )}

      {open === "spoke" && (
        <div className="logcall-more">
          <label htmlFor={`note-${dealId}`}>What did they say?</label>
          <textarea id={`note-${dealId}`} name="note" rows={3} maxLength={1000} autoFocus placeholder="Interested in…, call back after…" />
          <div className="logcall-chips" role="group" aria-label="Follow up">
            {followUpChoices(today).map((c) => (
              <button key={c.label} type="button" aria-pressed={followUp === c.value} onClick={() => setFollowUp(c.value)}>
                {c.label}
              </button>
            ))}
            <label className="sr-only" htmlFor={`followup-${dealId}`}>
              Follow-up date
            </label>
            <input id={`followup-${dealId}`} type="date" name="followUp" value={followUp} min={today} onChange={(e) => setFollowUp(e.target.value)} />
          </div>
          <label className="sr-only" htmlFor={`nextstep-${dealId}`}>
            Next step
          </label>
          <input id={`nextstep-${dealId}`} name="nextStep" maxLength={200} placeholder={nextStep ? `Next step (was: ${nextStep})` : "Next step, e.g. send the preview"} />
          <SubmitButton className="btn btn-primary" name="outcome" value="spoke" pendingLabel="Saving…">
            Log talked {label}
          </SubmitButton>
        </div>
      )}

      {open !== "spoke" &&
        (showNote ? (
          <>
            <label className="sr-only" htmlFor={`quicknote-${dealId}`}>
              Note
            </label>
            <textarea id={`quicknote-${dealId}`} name="note" rows={2} maxLength={1000} autoFocus placeholder="A note to save with the next tap (optional)" />
          </>
        ) : (
          <button type="button" className="logcall-addnote" onClick={() => setShowNote(true)}>
            + Add a note first
          </button>
        ))}
    </form>
  );
}
