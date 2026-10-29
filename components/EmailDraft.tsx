"use client";

import { useState } from "react";
import { logCall } from "@/app/admin/pipeline/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { updateLeadEmail } from "@/app/admin/pipeline/email-actions";
import type { SavedEmailDraft } from "@/lib/call-brief";
import { SKOX_WEBSITE } from "@/lib/lead-email";
import { EMAIL_STATUS_LABEL, type StatusReport } from "@/lib/resend-events";

/**
 * The first email, drafted from the brief. Edit it here, then open it in the
 * portal from Reiss's address, save it, or copy it. "Log as emailed" records
 * it and sets the follow-up.
 */
export function EmailDraft({
  dealId,
  to,
  draft,
  base,
  back,
  initiallyOpen = false,
  saved,
  canSend,
  fromLine,
  signedBy = null,
  doNotEmail = false,
  outreachBlocked,
  delivery = null,
}: {
  /** What Resend last reported for the sent email (lib/resend-events.ts); `when` is formatted on the server. */
  delivery?: (StatusReport & { when: string }) | null;
  /** The contact opted out: nothing can be sent. */
  doNotEmail?: boolean;
  outreachBlocked?: string;
  initiallyOpen?: boolean;
  saved?: SavedEmailDraft;
  canSend: boolean;
  /** "Josh Fox <josh@outreach.skoxsoftware.com>": who the lead sees it from if the signed-in person sends it. */
  fromLine: string;
  /** Set when the draft is signed by someone else on the team, so the sender fixes it first. */
  signedBy?: string | null;
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

  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState(saved?.status ?? "draft");
  const [message, setMessage] = useState("");
  async function persist(intent: "save" | "send") {
    if (!to || pending || status !== "draft") return;
    setPending(true);
    setMessage("");
    try {
      const result = await updateLeadEmail({ dealId, to, subject, body, intent });
      setMessage(result.error ?? result.notice ?? "");
      if (result.status) setStatus(result.status);
    } catch {
      setMessage("Could not confirm the result. Reload before trying again.");
      if (intent === "send") setStatus("sending");
    } finally { setPending(false); }
  }

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
      {delivery && (
        <span className="email-status" data-status={delivery.status} title={`Outreach email ${EMAIL_STATUS_LABEL[delivery.status].toLowerCase()} ${delivery.when}${delivery.reason ? ` · ${delivery.reason}` : ""}`}>
          {EMAIL_STATUS_LABEL[delivery.status]}
        </span>
      )}
      {open && (
        <section className="email-draft" id={`email-${dealId}`} aria-label="Email draft">
          <div className="email-draft-to small">
            To: {to ? <strong>{to}</strong> : <span className="muted">no email on file; add it in the mail app or Details</span>}
          </div>
          {signedBy && status === "draft" && <p className="small email-draft-warning" role="note">This draft is signed by <strong>{signedBy}</strong>. Change the name and phone number at the bottom before you send it.</p>}
          <p className="small">From: <strong>{status === "draft" ? fromLine : saved?.fromEmail ?? fromLine}</strong> · {status === "sent" ? "Sent" : status === "scheduled" ? `Scheduled for ${saved?.scheduledAt ? new Date(saved.scheduledAt).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }) : "later"}` : status === "sending" || status === "scheduling" ? "Processing" : "Draft — not sent"}</p>
          {delivery?.status === "bounced" && <p className="small">This address bounced{delivery.reason ? `: ${delivery.reason}` : "."} The lead is marked do-not-email.</p>}
          <label className="sr-only" htmlFor={`email-subject-${dealId}`}>
            Subject
          </label>
          <input id={`email-subject-${dealId}`} value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} disabled={pending || status !== "draft"} />
          <label className="sr-only" htmlFor={`email-body-${dealId}`}>
            Body
          </label>
          <textarea id={`email-body-${dealId}`} value={body} onChange={(e) => setBody(e.target.value)} rows={12} disabled={pending || status !== "draft"} />
          <p className="small muted">Signature: <a href={SKOX_WEBSITE} target="_blank" rel="noreferrer">UnBusy</a> links to our website in the email. Our postal address and an unsubscribe link are added below it when sent.</p>
          <div className="email-draft-actions">
            <button type="button" className="btn btn-primary btn-small" onClick={() => persist("send")} disabled={!!outreachBlocked || doNotEmail || !canSend || !to || pending || status !== "draft"}>
              {pending ? "Working…" : "Send email"}
            </button>
            <button type="button" className="btn btn-ghost btn-small" onClick={() => persist("save")} disabled={!to || pending || status !== "draft"}>Save draft</button>
            <button type="button" className="btn btn-ghost btn-small" onClick={() => copy("all")}>
              {copied === "all" ? "Copied" : "Copy all"}
            </button>
            <button type="button" className="btn btn-ghost btn-small" onClick={() => copy("body")}>
              {copied === "body" ? "Copied" : "Copy body"}
            </button>
            {status === "draft" && <form action={logCall}>
              <input type="hidden" name="dealId" value={dealId} />
              <input type="hidden" name="base" value={base} />
              <input type="hidden" name="back" value={back} />
              <input type="hidden" name="note" value={`Emailed: ${subject}`} />
              <SubmitButton className="btn btn-ghost btn-small" name="outcome" value="emailed" pendingLabel="Saving…">
                Log as emailed
              </SubmitButton>
            </form>}
          </div>
          {outreachBlocked && <p className="small"><strong>Sending blocked.</strong> {outreachBlocked}</p>}
          {doNotEmail && <p className="small"><strong>Do not email.</strong> This contact opted out, so sending is blocked.</p>}
          {message && <p role="status" className="small">{message}</p>}
          {!canSend && <p className="small muted">Sending isn&apos;t available for this account.</p>}
          {copied === "failed" && <p className="small muted">Couldn&apos;t reach the clipboard. Select the text and copy it.</p>}
        </section>
      )}
    </>
  );
}
