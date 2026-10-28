"use client";

import { useState } from "react";

/**
 * UnBusy's calendar, inside the rep's lead page. The rep books the scope call
 * while the prospect is still on the phone: copy their details into Google's
 * form in one tap each, or send them the link to pick a time themselves.
 */

function CopyChip({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="rp-chip"
      data-copied={copied ? "" : undefined}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch {
          // Clipboard blocked (rare): select-and-copy still works from the facts panel.
        }
      }}
      aria-label={`Copy ${label}: ${value}`}
    >
      <span>{label}</span>
      <strong>{value}</strong>
      <em aria-live="polite">{copied ? "Copied" : "Copy"}</em>
    </button>
  );
}

export function BookCall({
  embedUrl,
  openUrl,
  company,
  contactName,
  contactEmail,
  phone,
  repName,
}: {
  embedUrl: string | null;
  openUrl: string;
  company: string;
  contactName: string | null;
  contactEmail: string | null;
  phone: string | null;
  repName: string;
}) {
  const first = contactName?.split(" ")[0] ?? "there";
  const message = `Hi ${first}, it's ${repName} with UnBusy. Here's the link to grab a 30-minute call with our team about ${company}'s website: ${openUrl}`;
  const smsTo = phone ? phone.replace(/[^\d+]/g, "") : "";
  return (
    <div className="rp-book">
      <div className="rp-book-prep">
        <p className="rp-book-step"><b>1</b> Copy their details into the calendar</p>
        <div className="rp-chips">
          {contactName && <CopyChip label="Name" value={contactName} />}
          {contactEmail && <CopyChip label="Email" value={contactEmail} />}
          {phone && <CopyChip label="Phone" value={phone} />}
          {!contactName && !contactEmail && !phone && <p className="rp-note">No contact details yet. Ask for their email so Google can send the invite.</p>}
        </div>
        <div className="rp-book-send">
          <span>Or let them pick:</span>
          {phone && <a className="rp-btn" href={`sms:${smsTo}?&body=${encodeURIComponent(message)}`}>Text them the link</a>}
          {contactEmail && (
            <a className="rp-btn" href={`mailto:${contactEmail}?subject=${encodeURIComponent(`Quick call with UnBusy about ${company}`)}&body=${encodeURIComponent(message)}`}>
              Email them the link
            </a>
          )}
          <CopyLink url={openUrl} />
        </div>
      </div>
      <p className="rp-book-step"><b>2</b> Pick a time with them</p>
      {embedUrl ? (
        <div className="rp-book-frame">
          <iframe src={embedUrl} title="UnBusy scope call booking" loading="lazy" referrerPolicy="strict-origin-when-cross-origin" />
        </div>
      ) : (
        <p className="rp-note">
          <a href={openUrl} target="_blank" rel="noreferrer">Open UnBusy&apos;s calendar ↗</a>
        </p>
      )}
      <p className="rp-note rp-book-fallback">
        Calendar not loading? <a href={openUrl} target="_blank" rel="noreferrer">Open it in a new tab ↗</a>. Google emails the invite to the address you enter.
      </p>
    </div>
  );
}

function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="rp-btn"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch {}
      }}
    >
      {copied ? "Link copied" : "Copy link"}
    </button>
  );
}
