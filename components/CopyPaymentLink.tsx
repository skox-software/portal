"use client";

import { useState } from "react";

export function CopyPaymentLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const [fallback, setFallback] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setFallback(false);
    } catch {
      setFallback(true);
    }
  }
  return (
    <div>
      <button type="button" className="btn btn-ghost btn-small" onClick={copy}>
        {copied ? "Link copied" : "Copy payment link"}
      </button>
      <span className="sr-only" role="status">{copied ? "Payment link copied to clipboard." : ""}</span>
      {fallback && (
        <label className="small">
          Copy this payment link
          <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
        </label>
      )}
    </div>
  );
}
