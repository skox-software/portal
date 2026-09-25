"use client";

import { useRef } from "react";
import { assignThread } from "@/app/admin/inbox/actions";

export type AssignOption = { value: string; label: string };

/** "Assign to client…": files the conversation as soon as a choice is made. */
export function AssignThread({
  threadId,
  clients,
  deals,
  assigned = false,
  compact = false,
}: {
  threadId: string;
  clients: AssignOption[];
  deals: AssignOption[];
  /** Already filed: the menu offers "Move to…" and "Unassign". */
  assigned?: boolean;
  compact?: boolean;
}) {
  const form = useRef<HTMLFormElement>(null);
  return (
    <form ref={form} action={assignThread} className={compact ? "assign assign-compact" : "assign"}>
      <input type="hidden" name="threadId" value={threadId} />
      <label className="sr-only" htmlFor={`assign-${threadId}-${compact ? "c" : "f"}`}>Assign to a client or deal</label>
      <select
        id={`assign-${threadId}-${compact ? "c" : "f"}`}
        name="target"
        defaultValue=""
        onChange={() => form.current?.requestSubmit()}
        onClick={(e) => e.stopPropagation()}
      >
        <option value="" disabled>{assigned ? "Move to…" : "Assign to client…"}</option>
        {clients.length > 0 && (
          <optgroup label="Clients">
            {clients.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </optgroup>
        )}
        {deals.length > 0 && (
          <optgroup label="Deals in the pipeline">
            {deals.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
          </optgroup>
        )}
        {assigned && <option value="none">Unassign (back to Needs a client)</option>}
      </select>
    </form>
  );
}
