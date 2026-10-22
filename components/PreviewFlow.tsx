"use client";

import { useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { markPreviewSent, savePreviewLink } from "@/app/admin/pipeline/actions";
import { sendPreviewEmail } from "@/app/admin/pipeline/email-actions";
import { SubmitButton } from "@/components/SubmitButton";

type Stage = "build" | "send" | "out";

/**
 * A lead's preview in three steps, one main button at a time:
 * Build (copy the prompt into your AI, paste the live link back),
 * Send (review the written email in a pop-up, confirm), then Out (sent, opened).
 */
export function PreviewFlow({
  status,
  url,
  linkPlaceholder,
  prompt,
  hidden,
  sentLine,
  opened,
  email,
}: {
  status: string;
  url: string | null;
  linkPlaceholder: string;
  prompt: string;
  /** The panel's dealId/base/back inputs, for the link and mark-sent forms. */
  hidden: ReactNode;
  /** "Sent 2h ago · opened 40m ago on a phone · 3 views", formatted on the server. */
  sentLine: string | null;
  opened: boolean;
  email: { dealId: string; to: string | null; firstName: string; subject: string; body: string; fromLine: string; blocked: string | null };
}) {
  const stage: Stage = status === "sent" || status === "opened" ? "out" : status === "ready" && url ? "send" : "build";
  const [copied, setCopied] = useState(false);
  const [editingLink, setEditingLink] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 4000);
    } catch {
      window.prompt("Copy this prompt", prompt);
    }
  }

  const steps: { key: Stage; label: string }[] = [
    { key: "build", label: "Build" },
    { key: "send", label: "Send" },
    { key: "out", label: opened ? "Opened" : "Sent" },
  ];
  const at = steps.findIndex((s) => s.key === stage);

  const linkForm = (
    <form action={savePreviewLink} className="pv-link-form">
      {hidden}
      <label className="sr-only" htmlFor="pv-link">
        Preview link
      </label>
      <input id="pv-link" name="previewUrl" type="url" required defaultValue={url ?? ""} placeholder={linkPlaceholder} />
      <SubmitButton className="btn btn-ghost btn-small" pendingLabel="Saving…">
        Save link
      </SubmitButton>
    </form>
  );

  return (
    <div className="pv" data-stage={stage} data-opened={(stage === "out" && opened) || undefined}>
      <ol className="pv-steps" aria-label="Preview progress">
        {steps.map((s, i) => (
          <li key={s.key} data-state={i < at ? "done" : i === at ? "current" : "todo"} aria-current={i === at ? "step" : undefined}>
            <span className="pv-dot" aria-hidden>{i < at || (s.key === "out" && opened) ? "✓" : i + 1}</span>
            {s.label}
          </li>
        ))}
      </ol>

      {stage === "build" && (
        <div className="pv-stage">
          <button type="button" className="pv-main" data-done={copied || undefined} onClick={copyPrompt}>
            <span className="pv-main-title">{copied ? "Copied. Paste it into your AI" : "Copy build prompt"}</span>
            <span className="pv-main-sub">{copied ? "It builds the site and puts it live" : "Everything your AI needs to build and publish it"}</span>
          </button>
          <p className="pv-hint">When it&apos;s live, paste the link here:</p>
          {linkForm}
        </div>
      )}

      {stage === "send" && url && (
        <div className="pv-stage">
          <a className="pv-site" href={`${url}?team=1`} target="_blank" rel="noreferrer" title="Opens without counting as their view">
            <span className="pv-site-live" aria-hidden />
            <span className="pv-site-url">{url.replace(/^https:\/\//, "")}</span>
            <span aria-hidden>↗</span>
          </a>
          <button type="button" className="pv-main" disabled={!email.to} onClick={() => dialog.current?.showModal()}>
            <span className="pv-main-title">Email {email.firstName}</span>
            <span className="pv-main-sub">{email.to ? "Written and ready. You review it before it goes" : "Add their email in Details first"}</span>
          </button>
          <div className="pv-quiet">
            <button type="button" className="pv-text-btn" onClick={() => setEditingLink(!editingLink)} aria-expanded={editingLink}>
              Change link
            </button>
            <button type="button" className="pv-text-btn" onClick={copyPrompt}>
              {copied ? "Prompt copied" : "Copy prompt to edit it"}
            </button>
            <form action={markPreviewSent}>
              {hidden}
              <button type="submit" className="pv-text-btn">Sent it another way</button>
            </form>
          </div>
          {editingLink && linkForm}
        </div>
      )}

      {stage === "out" && (
        <div className="pv-stage">
          <p className="pv-status" data-opened={opened || undefined}>
            <span className="pv-pulse" aria-hidden />
            {sentLine}
          </p>
          {url && (
            <a className="pv-site" href={`${url}?team=1`} target="_blank" rel="noreferrer" title="Opens without counting as their view">
              <span className="pv-site-url">{url.replace(/^https:\/\//, "")}</span>
              <span aria-hidden>↗</span>
            </a>
          )}
          <div className="pv-quiet">
            <button type="button" className="pv-text-btn" onClick={copyPrompt}>
              {copied ? "Prompt copied. Add your changes at the end" : "Copy prompt to edit it"}
            </button>
          </div>
        </div>
      )}

      {stage === "send" && email.to && <SendDialog dialog={dialog} email={{ ...email, to: email.to }} />}
    </div>
  );
}

function SendDialog({ dialog, email }: { dialog: React.RefObject<HTMLDialogElement | null>; email: { dealId: string; to: string; subject: string; body: string; fromLine: string; blocked: string | null } }) {
  const router = useRouter();
  const [subject, setSubject] = useState(email.subject);
  const [body, setBody] = useState(email.body);
  const [state, setState] = useState<"review" | "sending" | "sent">("review");
  const [error, setError] = useState("");
  const linkIn = /https:\/\/previews\.skoxsoftware\.com\/\S+/.test(body);


  async function send() {
    setState("sending");
    setError("");
    try {
      const result = await sendPreviewEmail({ dealId: email.dealId, to: email.to, subject, body });
      if (result.error) {
        setError(result.error);
        setState("review");
      } else setState("sent");
    } catch {
      setError("Couldn't confirm it sent. Check the Inbox before trying again.");
      setState("review");
    }
  }

  const close = () => dialog.current?.close();

  return (
    <dialog ref={dialog} className="pv-dialog" aria-labelledby="pv-dialog-title" onClose={() => state === "sent" && router.refresh()}>
      {state === "sent" ? (
        <div className="pv-sent">
          <span className="pv-sent-mark" aria-hidden>✓</span>
          <h2 id="pv-dialog-title">Sent</h2>
          <p>It&apos;s on its way to {email.to}. You&apos;ll get an alert the moment they open it, so you can call while it&apos;s on their screen.</p>
          <button type="button" className="btn btn-primary" onClick={close} autoFocus>
            Done
          </button>
        </div>
      ) : (
        <form method="dialog" className="pv-mail" onSubmit={(e) => e.preventDefault()}>
          <header>
            <h2 id="pv-dialog-title">Review and send</h2>
            <button type="button" className="pv-x" onClick={close} aria-label="Close">
              ×
            </button>
          </header>
          <dl className="pv-meta">
            <dt>From</dt>
            <dd>{email.fromLine}</dd>
            <dt>To</dt>
            <dd>{email.to}</dd>
          </dl>
          <label className="sr-only" htmlFor="pv-subject">
            Subject
          </label>
          <input id="pv-subject" className="pv-subject" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} disabled={state === "sending"} />
          <label className="sr-only" htmlFor="pv-body">
            Message
          </label>
          <textarea id="pv-body" className="pv-body" value={body} onChange={(e) => setBody(e.target.value)} disabled={state === "sending"} />
          <p className="pv-check" data-ok={linkIn || undefined}>{linkIn ? "Preview link is in the email" : "The preview link is missing. Put it back to send"}</p>
          {email.blocked && <p className="pv-error">{email.blocked}</p>}
          {error && <p className="pv-error" role="alert">{error}</p>}
          <footer>
            <button type="button" className="btn btn-ghost" onClick={close}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" onClick={send} disabled={!linkIn || !subject.trim() || state === "sending" || !!email.blocked}>
              {state === "sending" ? "Sending…" : "Confirm & send"}
            </button>
          </footer>
        </form>
      )}
    </dialog>
  );
}
