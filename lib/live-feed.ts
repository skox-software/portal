/**
 * The finance page's activity feed: which audit-trail events count as money
 * moving, and one line of plain English for each. Pure, so it can be tested
 * alone; lib/finance-data.ts reads the rows and the client only renders them.
 */

import { outcomeLabel } from "./follow-up.ts";
import { COLUMNS } from "./pipeline.ts";

/** Verbs the feed shows. `deal.updated` only when it moved stage (its payload has `to`). */
export const LIVE_VERBS = [
  "invoice.paid",
  "invoice.created",
  "deal.stage_changed",
  "deal.updated",
  "deal.call_logged",
  "deal.created",
  "commission.earned",
  "statement.paid",
] as const;

export type LiveIcon = "paid" | "invoice" | "won" | "stage" | "lost" | "call" | "deal" | "commission" | "statement";

export type LiveLine = { icon: LiveIcon; text: string; amountCents?: number };

/** A feed row as the live route sends it. `at` is an ISO timestamp. */
export type LiveEvent = LiveLine & { id: string; at: string; verb: string };

type Payload = Record<string, unknown>;

const str = (p: Payload, key: string) => (typeof p[key] === "string" && (p[key] as string).trim() ? (p[key] as string).trim() : null);
const cents = (p: Payload, key: string) => (typeof p[key] === "number" && Number.isFinite(p[key]) ? Math.round(p[key] as number) : undefined);

export function stageName(stage: string) {
  if (stage === "lost") return "Lost";
  return COLUMNS.find((c) => c.key === stage)?.label ?? stage.replace(/_/g, " ");
}

/** A stage move, worded for who reads it: a win is news, a loss is a fact. */
function moved(company: string, to: string): LiveLine {
  if (to === "won") return { icon: "won", text: `${company} won` };
  if (to === "lost") return { icon: "lost", text: `${company} marked lost` };
  return { icon: "stage", text: `${company} moved to ${stageName(to)}` };
}

/**
 * One line for an event, or null when the feed should skip it. `client` is
 * not in any stored payload: the route adds it from the event's project.
 */
export function describeEvent(verb: string, payload: Payload | null | undefined): LiveLine | null {
  const p = payload ?? {};
  const company = str(p, "company") ?? str(p, "client");
  switch (verb) {
    case "invoice.paid": {
      const title = str(p, "title");
      const who = str(p, "client");
      return { icon: "paid", text: who ? `${who} paid${title ? ` · ${title}` : ""}` : `Invoice paid${title ? ` · ${title}` : ""}`, amountCents: cents(p, "amountCents") };
    }
    case "invoice.created": {
      const title = str(p, "title");
      const who = str(p, "client");
      return { icon: "invoice", text: `New invoice${who ? ` for ${who}` : ""}${title ? ` · ${title}` : ""}`, amountCents: cents(p, "amountCents") };
    }
    case "deal.stage_changed":
    case "deal.updated": {
      const to = str(p, "to");
      if (!to) return null;
      return moved(company ?? "A deal", to);
    }
    case "deal.call_logged": {
      const outcome = str(p, "outcome");
      const to = str(p, "to");
      const base = `Call with ${company ?? "a lead"}${outcome ? ` · ${outcomeLabel(outcome)}` : ""}`;
      return { icon: "call", text: to && to !== "initial_outreach" ? `${base} · ${stageName(to)}` : base };
    }
    case "deal.created": {
      const stage = str(p, "stage");
      const from = str(p, "from") ?? str(p, "source");
      if (!company) return { icon: "deal", text: from === "project" ? "New deal from a project" : "New deal added" };
      const via = from === "website" ? " from the website" : from === "referral" ? " by referral" : from === "rep" ? " by a rep" : "";
      return { icon: "deal", text: `New ${stage && stage !== "lead" ? `${stageName(stage).toLowerCase()} deal` : "lead"}: ${company}${via}` };
    }
    case "commission.earned": {
      const rep = str(p, "rep") ?? "A rep";
      const invoice = str(p, "invoice");
      return { icon: "commission", text: `${rep} earned commission${invoice ? ` on ${invoice}` : ""}`, amountCents: cents(p, "amountCents") };
    }
    case "statement.paid": {
      const rep = str(p, "rep");
      return { icon: "statement", text: rep ? `Statement paid to ${rep}` : "Commission statement paid", amountCents: cents(p, "totalCents") };
    }
    default:
      return null;
  }
}

/** Ids in `next` that weren't in `prev`: what slides in, and whether to celebrate. */
export function newEvents(prev: readonly { id: string }[], next: readonly LiveEvent[]) {
  const seen = new Set(prev.map((e) => e.id));
  return next.filter((e) => !seen.has(e.id));
}
