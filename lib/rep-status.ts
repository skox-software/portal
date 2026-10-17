/**
 * What a sales rep sees of a deal. Reps never see SKOX's internal stages,
 * prices or notes: just whether the lead is theirs to work, booked, with
 * SKOX, or closed.
 */

import type { DealStage } from "./pipeline.ts";

export const REP_STATUSES = [
  { value: "working", label: "Working", hint: "Yours to call" },
  { value: "booked", label: "Call booked", hint: "Scope call set with SKOX" },
  { value: "with_skox", label: "With SKOX", hint: "SKOX is quoting and closing" },
  { value: "won", label: "Won", hint: "Client signed. You earn on every payment" },
  { value: "lost", label: "Closed", hint: "Not moving forward" },
] as const;

export type RepStatus = (typeof REP_STATUSES)[number]["value"];

export function repStatus(deal: { stage: DealStage; meetingAt: Date | string | null; projectId?: string | null }): RepStatus {
  if (deal.stage === "won" || deal.projectId) return "won";
  if (deal.stage === "lost") return "lost";
  if (deal.stage === "proposal_sent" || deal.stage === "negotiation") return "with_skox";
  if (deal.meetingAt) return "booked";
  return "working";
}

export function repStatusLabel(status: RepStatus) {
  return REP_STATUSES.find((s) => s.value === status)!.label;
}

/** Reps can only log calls and book meetings while the lead is still theirs to work. */
export function repCanWork(status: RepStatus) {
  return status === "working" || status === "booked";
}
