"use client";

import { useState } from "react";
import { logCall } from "@/app/admin/pipeline/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { mailtoHref } from "@/lib/email-draft";

/**
 * The first email, drafted from the brief. Edit it here, then open it in the
 * mail app (subject and body filled in) or copy it. "Log as emailed" records
 * it and sets the follow-up.
 */
export function EmailDraft({
  dealId,
  to,
  draft,
  base,
  back,
  initiallyOpen = false,
}: {
  initiallyOpen?: boolean;
  dealId: string;
  to: string | null;
  draft: { subject: string; body: string };
  base: string;
  back: string;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  const [copied, setCopied] = useState<string | null>(null);

  async function copy(what: "subject" | "body" | "all") {
    const text = what === "subject" ? subject : what === "body" ? body : `Subject: ${subject}\n\n${body}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 1600);
    } catch {
      setCopied("failed");
    }
  }

  return (
    <>
      <button type="button" className="btn btn-ghost btn-small" data-reach="email" title="Email draft (E)" aria-expanded={open} aria-controls={`email-${dealId}`} onClick={() => setOpen(!open)}>
        Email
      </button>
      {open && (
        <section className="email-draft" id={`email-${dealId}`} aria-label="Email draft">
          <div className="email-draft-to small">
            To: {to ? <strong>{to}</strong> : <span className="muted">no email on file; add it in the mail app or Details</span>}
          </div>
          <label className="sr-only" htmlFor={`email-subject-${dealId}`}>
            Subject
          </label>
          <input id={`email-subject-${dealId}`} value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} />
          <label className="sr-only" htmlFor={`email-body-${dealId}`}>
            Body
          </label>
          <textarea id={`email-body-${dealId}`} value={body} onChange={(e) => setBody(e.target.value)} rows={12} />
          <div className="email-draft-actions">
            <a className="btn btn-primary btn-small" href={mailtoHref(to, { subject, body })}>
              Open in mail app
            </a>
            <button type="button" className="btn btn-ghost btn-small" onClick={() => copy("all")}>
              {copied === "all" ? "Copied" : "Copy all"}
            </button>
            <button type="button" className="btn btn-ghost btn-small" onClick={() => copy("body")}>
              {copied === "body" ? "Copied" : "Copy body"}
            </button>
            <form action={logCall}>
              <input type="hidden" name="dealId" value={dealId} />
              <input type="hidden" name="base" value={base} />
              <input type="hidden" name="back" value={back} />
              <input type="hidden" name="note" value={`Emailed: ${subject}`} />
              <SubmitButton className="btn btn-ghost btn-small" name="outcome" value="emailed" pendingLabel="Saving…">
                Log as emailed
              </SubmitButton>
            </form>
          </div>
          {copied === "failed" && <p className="small muted">Couldn&apos;t reach the clipboard. Select the text and copy it.</p>}
        </section>
      )}
    </>
  );
}
