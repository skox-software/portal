"use client";

import { useState } from "react";

/** A small "Copy" button for a phone number or email address; `spoken` names a long value for screen readers. */
export function CopyButton({ value, label = "Copy", spoken }: { value: string; label?: string; spoken?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <>
      <button
        type="button"
        className="btn btn-ghost btn-small"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            window.prompt("Copy this", value);
          }
        }}
      >
        {copied ? "Copied" : label}
      </button>
      <span className="sr-only" role="status">
        {copied ? `${spoken ?? value} copied.` : ""}
      </span>
    </>
  );
}
