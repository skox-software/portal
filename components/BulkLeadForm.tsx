"use client";

import { useMemo, useState } from "react";
import { bulkAddDeals } from "@/app/admin/pipeline/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { dealKindLabel } from "@/lib/pipeline";
import { parseLeadSources } from "@/lib/pipeline-import";

const EXAMPLE = "Company, Contact, Email, Phone, Website, Value\nLumen Physio, Sofia Reyes, sofia@lumenphysio.com, 904-555-0101, lumenphysio.com, 12000";

function money(cents: number | null) {
  return cents ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100) : "";
}

/** Paste rows or pick a CSV; shows what will be added before anything is saved. */
export function BulkLeadForm({ owners, me }: { owners: string[]; me: string }) {
  const [rows, setRows] = useState("");
  const [fileText, setFileText] = useState("");
  const [fileName, setFileName] = useState("");
  const preview = useMemo(() => parseLeadSources(fileText, rows), [rows, fileText]);

  return (
    <form action={bulkAddDeals} className="stack">
      <div className="field">
        <label htmlFor="bulk-rows">Paste leads</label>
        <textarea
          id="bulk-rows"
          name="rows"
          rows={6}
          value={rows}
          onChange={(e) => setRows(e.target.value)}
          placeholder={EXAMPLE}
          className="bulk-rows"
          spellCheck={false}
        />
        <span className="hint">
          One lead per line, straight from a spreadsheet or CSV. With a header row, columns are matched by name
          (company, contact, email, phone, website, value, type, notes) and anything else is kept in the notes.
          Without one: company, contact, email, phone, website, value.
        </span>
      </div>
      <div className="bulk-options">
        <div className="field">
          <label htmlFor="bulk-file">…or upload a CSV</label>
          <input
            id="bulk-file"
            name="file"
            type="file"
            accept=".csv,.tsv,.txt,text/csv,text/plain"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              setFileName(file?.name ?? "");
              setFileText(file && file.size <= 900_000 ? await file.text() : "");
            }}
          />
        </div>
        <div className="field">
          <label htmlFor="bulk-stage">Add to</label>
          <select id="bulk-stage" name="stage" defaultValue="lead">
            <option value="lead">Lead</option>
            <option value="proposal_sent">Proposal sent</option>
            <option value="negotiation">Negotiation</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="bulk-owner">Owner</label>
          <select id="bulk-owner" name="ownerEmail" defaultValue={me}>
            <option value="">Unassigned</option>
            {owners.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
      </div>

      {preview.drafts.length > 0 && (
        <div className="bulk-preview" aria-live="polite">
          <p className="small">
            <strong>{preview.drafts.length} {preview.drafts.length === 1 ? "lead" : "leads"} ready</strong>
            {fileName && ` (including ${fileName})`}
            {preview.skipped.length > 0 && ` · ${preview.skipped.length} without a company will be skipped`}
            {preview.truncated && " · only the first 500 rows are read"}
            . Anything already in the pipeline is skipped when you add them.
          </p>
          <div className="bulk-table">
            <table>
              <thead>
                <tr><th>Company</th><th>Contact</th><th>Email</th><th>Phone</th><th>Value</th><th>Type</th></tr>
              </thead>
              <tbody>
                {preview.drafts.slice(0, 8).map((d, i) => (
                  <tr key={i}>
                    <td>{d.company}</td>
                    <td>{d.contactName}</td>
                    <td>{d.contactEmail}</td>
                    <td>{d.phone}</td>
                    <td>{money(d.valueCents)}</td>
                    <td>{d.kind === "other" ? "" : dealKindLabel(d.kind)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.drafts.length > 8 && <p className="small muted">…and {preview.drafts.length - 8} more.</p>}
        </div>
      )}

      <div className="pipeline-form-actions">
        <SubmitButton className="btn btn-primary" disabled={!preview.drafts.length} pendingLabel="Adding…">
          {preview.drafts.length ? `Add ${preview.drafts.length} ${preview.drafts.length === 1 ? "lead" : "leads"}` : "Add leads"}
        </SubmitButton>
      </div>
    </form>
  );
}
