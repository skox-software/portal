/**
 * Bulk lead import: turns pasted rows or a CSV file into deal drafts.
 *
 * Accepts comma- or tab-separated text (a spreadsheet paste is tab-separated).
 * With a header row, columns are matched by name, so exports from other
 * tools (e.g. the old lead scraper: business_name, owner_name, niche…) work
 * as they are, and unknown columns are kept in the notes. Without one, columns
 * are read as: company, contact, email, phone, website, value.
 */

import { DEAL_KINDS } from "./pipeline.ts";

export const MAX_IMPORT_ROWS = 500;

export type LeadDraft = {
  company: string;
  contactName: string | null;
  contactEmail: string | null;
  phone: string | null;
  website: string | null;
  valueCents: number | null;
  kind: string;
  notes: string | null;
};

type Field = keyof Omit<LeadDraft, "notes"> | "notes";

const ALIASES: Record<string, Field> = {
  company: "company", business: "company", businessname: "company", name: "company", account: "company", organization: "company",
  contact: "contactName", contactname: "contactName", ownername: "contactName", owner: "contactName", person: "contactName", fullname: "contactName",
  email: "contactEmail", emailaddress: "contactEmail", contactemail: "contactEmail",
  phone: "phone", phonenumber: "phone", tel: "phone", mobile: "phone",
  website: "website", url: "website", site: "website", web: "website",
  value: "valueCents", amount: "valueCents", dealvalue: "valueCents", budget: "valueCents", price: "valueCents",
  type: "kind", kind: "kind", service: "kind",
  notes: "notes", note: "notes", comments: "notes",
};
/** Bookkeeping columns from other tools that mean nothing on a deal. */
const IGNORED = new Set(["id", "placeid", "stage", "status", "createdat", "updatedat"]);
const POSITIONAL: Field[] = ["company", "contactName", "contactEmail", "phone", "website", "valueCents"];

/** Splits one delimited line, honouring "quoted, fields" and "" escapes. */
function splitLine(line: string, delimiter: string) {
  const out: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell.trim() === "") {
      quoted = true;
      cell = "";
    } else if (ch === delimiter) {
      out.push(cell.trim());
      cell = "";
    } else cell += ch;
  }
  out.push(cell.trim());
  return out;
}

/** Records, allowing newlines inside quoted cells. */
function records(text: string) {
  const lines: string[] = [];
  let current = "";
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    current = current ? `${current}\n${raw}` : raw;
    if ((current.match(/"/g)?.length ?? 0) % 2 === 0) {
      if (current.trim()) lines.push(current);
      current = "";
    }
  }
  if (current.trim()) lines.push(current);
  return lines;
}

const key = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

function cleanEmail(value: string) {
  const email = value.trim().toLowerCase().replace(/^mailto:/, "").replace(/[.,;]+$/, "");
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(email) ? email : null;
}

function cleanWebsite(value: string) {
  const raw = value.trim();
  if (!raw) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!url.hostname.includes(".")) return null;
    // Tracking parameters from map listings aren't worth keeping.
    for (const p of [...url.searchParams.keys()]) if (p.startsWith("utm_")) url.searchParams.delete(p);
    return url.toString().slice(0, 300);
  } catch {
    return null;
  }
}

function cleanValue(value: string) {
  const n = Number(value.replace(/[$,\s]/g, "").replace(/k$/i, "000"));
  return Number.isFinite(n) && n > 0 && n <= 10_000_000 ? Math.round(n * 100) : null;
}

function cleanKind(value: string) {
  const v = key(value);
  return DEAL_KINDS.find((k) => key(k.value) === v || key(k.label) === v)?.value ?? null;
}

/** "Owner", "N/A" and friends are placeholders, not names. */
function cleanName(value: string) {
  const v = value.trim();
  return !v || /^(owner|n\/?a|none|unknown|-)$/i.test(v) ? null : v.slice(0, 120);
}

export type ParseResult = { drafts: LeadDraft[]; skipped: { row: number; reason: string }[]; truncated: boolean };

export function parseLeads(text: string): ParseResult {
  const rows = records(text);
  const skipped: ParseResult["skipped"] = [];
  if (!rows.length) return { drafts: [], skipped, truncated: false };
  const delimiter = rows[0].includes("\t") ? "\t" : ",";

  const first = splitLine(rows[0], delimiter);
  const headerFields = first.map((h) => ALIASES[key(h)]);
  const hasHeader = headerFields.filter(Boolean).length >= 1 && headerFields.includes("company") && !first.some((h) => h.includes("@"));
  const columns: (Field | { extra: string })[] = hasHeader
    ? first.map((h, i) => headerFields[i] ?? { extra: h })
    : POSITIONAL;
  const body = hasHeader ? rows.slice(1) : rows;
  const truncated = body.length > MAX_IMPORT_ROWS;

  const drafts: LeadDraft[] = [];
  body.slice(0, MAX_IMPORT_ROWS).forEach((line, index) => {
    const row = index + (hasHeader ? 2 : 1);
    const cells = splitLine(line, delimiter);
    const draft: LeadDraft = { company: "", contactName: null, contactEmail: null, phone: null, website: null, valueCents: null, kind: "other", notes: null };
    const notes: string[] = [];
    let kindText = "";
    cells.forEach((cell, i) => {
      const column = columns[i];
      if (!cell || !column) return;
      if (typeof column === "object") {
        if (IGNORED.has(key(column.extra))) return;
        notes.push(`${column.extra}: ${cell}`);
        return;
      }
      switch (column) {
        case "company": draft.company = cell.slice(0, 120); break;
        case "contactName": draft.contactName = cleanName(cell); break;
        case "contactEmail": draft.contactEmail = cleanEmail(cell); break;
        case "phone": draft.phone = cell.slice(0, 40); break;
        case "website": draft.website = cleanWebsite(cell); break;
        case "valueCents": draft.valueCents = cleanValue(cell); break;
        case "kind": kindText = cell; break;
        case "notes": notes.unshift(cell); break;
      }
    });
    if (kindText) {
      const kind = cleanKind(kindText);
      if (kind) draft.kind = kind;
      else notes.unshift(`Type: ${kindText}`);
    }
    if (!draft.company) {
      skipped.push({ row, reason: "no company name" });
      return;
    }
    draft.notes = notes.length ? notes.join("\n").slice(0, 4000) : null;
    drafts.push(draft);
  });
  return { drafts, skipped, truncated };
}

/** Parses several sources (an uploaded file, a paste) each with its own header. */
export function parseLeadSources(...texts: string[]): ParseResult {
  const results = texts.filter((t) => t.trim()).map(parseLeads);
  const drafts = results.flatMap((r) => r.drafts);
  return {
    drafts: drafts.slice(0, MAX_IMPORT_ROWS),
    skipped: results.flatMap((r) => r.skipped),
    truncated: results.some((r) => r.truncated) || drafts.length > MAX_IMPORT_ROWS,
  };
}

/** Company names compared loosely: "Harbor Dental, LLC" matches "harbor dental". */
export function companyKey(name: string) {
  return name
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/\b(llc|inc|co|corp|ltd|pllc|pa)\b\.?/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/** Drops rows already in the pipeline (by company or email) or repeated in the batch. */
export function dedupeLeads(drafts: LeadDraft[], existing: { company: string; email: string | null }[]) {
  const companies = new Set(existing.map((e) => companyKey(e.company)));
  const emails = new Set(existing.map((e) => e.email).filter(Boolean));
  const fresh: LeadDraft[] = [];
  const duplicates: string[] = [];
  for (const d of drafts) {
    const k = companyKey(d.company);
    if ((k && companies.has(k)) || (d.contactEmail && emails.has(d.contactEmail))) {
      duplicates.push(d.company);
      continue;
    }
    companies.add(k);
    if (d.contactEmail) emails.add(d.contactEmail);
    fresh.push(d);
  }
  return { fresh, duplicates };
}
