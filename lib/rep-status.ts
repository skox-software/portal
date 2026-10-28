/**
 * What a sales rep sees of a deal. Reps never see UnBusy's internal stages,
 * prices or notes: just whether the lead is theirs to work, booked, with
 * UnBusy, or closed.
 */

import type { DealStage } from "./pipeline.ts";

export const REP_STATUSES = [
  { value: "working", label: "Working", hint: "Yours to call" },
  { value: "booked", label: "Call booked", hint: "Scope call set with UnBusy" },
  { value: "with_skox", label: "With UnBusy", hint: "UnBusy is quoting and closing" },
  { value: "won", label: "Won", hint: "Client signed. You earn on every payment" },
  { value: "lost", label: "Closed", hint: "Not moving forward" },
] as const;

export type RepStatus = (typeof REP_STATUSES)[number]["value"];

export function repStatus(deal: { stage: DealStage; meetingAt: Date | string | null; projectId?: string | null }): RepStatus {
  if (deal.stage === "won" || deal.projectId) return "won";
  if (deal.stage === "lost" || deal.stage === "outreach_closed") return "lost";
  if (deal.stage === "proposal_sent") return "with_skox";
  if (deal.stage === "meeting" || deal.meetingAt) return "booked";
  return "working";
}

export function repStatusLabel(status: RepStatus) {
  return REP_STATUSES.find((s) => s.value === status)!.label;
}

/** Reps can only log calls and book meetings while the lead is still theirs to work. */
export function repCanWork(status: RepStatus) {
  return status === "working" || status === "booked";
}
