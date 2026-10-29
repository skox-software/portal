"use client";

import { useState } from "react";

/** Reveals the lead's older history events, which the panel renders hidden. */
export function HistoryMore({ count }: { count: number }) {
  const [shown, setShown] = useState(false);
  if (shown) return null;
  return (
    <button
      type="button"
      className="pv-text-btn lead-history-more"
      onClick={(e) => {
        e.currentTarget.closest(".lead-history")?.querySelectorAll("li[hidden]").forEach((li) => li.removeAttribute("hidden"));
        setShown(true);
      }}
    >
      Show {count} earlier
    </button>
  );
}
