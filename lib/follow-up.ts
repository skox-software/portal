/**
 * Calls, follow-ups and the Today queue. Pure rules, so they can be tested alone.
 *
 * Follow-up days are calendar dates in the sales team's time zone (Florida),
 * so "today" doesn't roll over at 8pm the way a UTC date would.
 */

import type { DealStage } from "./pipeline.ts";

export const SALES_TZ = "America/New_York";

/**
 * What can happen on a cold call, in the order of the one-tap buttons.
 * `followUpDays` are workdays until the next try; null means no follow-up.
 * "Sent email" isn't a call outcome button: the email draft logs it.
 */
export const OUTCOMES = [
  { value: "no_answer", label: "No answer", followUpDays: 1, button: true },
  { value: "voicemail", label: "Voicemail", followUpDays: 2, button: true },
  { value: "gatekeeper", label: "Gatekeeper", followUpDays: 1, button: true },
  { value: "spoke", label: "Talked", followUpDays: 3, button: true },
  { value: "not_interested", label: "Not interested", followUpDays: null, button: true },
  { value: "bad_number", label: "Bad number", followUpDays: null, button: true },
  { value: "emailed", label: "Sent email", followUpDays: 3, button: false },
] as const;

export type Outcome = (typeof OUTCOMES)[number]["value"];

export function outcomeLabel(value: string) {
  return OUTCOMES.find((o) => o.value === value)?.label ?? value;
}

/** Today as YYYY-MM-DD in the sales time zone. */
export function salesToday(now: Date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: SALES_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Skips Saturday and Sunday: a follow-up never lands on a weekend. */
export function addWorkdays(iso: string, days: number) {
  let out = iso;
  let left = days;
  while (left > 0) {
    out = addDays(out, 1);
    const dow = new Date(`${out}T12:00:00Z`).getUTCDay();
    if (dow !== 0 && dow !== 6) left--;
  }
  return out;
}

/** Quick picks for the follow-up date, from today. */
export function followUpChoices(today: string) {
  return [
    { label: "Tomorrow", value: addWorkdays(today, 1) },
    { label: "In 2 days", value: addWorkdays(today, 2) },
    { label: "Next week", value: addWorkdays(today, 5) },
    { label: "In 2 weeks", value: addWorkdays(today, 10) },
  ];
}

export function defaultFollowUp(outcome: Outcome, today: string) {
  const days = OUTCOMES.find((o) => o.value === outcome)?.followUpDays;
  return days ? addWorkdays(today, days) : null;
}

/**
 * Where a deal goes after a call. Any first attempt moves a fresh lead to
 * Initial outreach; "Not interested" closes it; a bad number leaves it where
 * it is (flagged); otherwise the stage stays put.
 */
export function stageAfterCall(stage: DealStage, outcome: Outcome): DealStage {
  if (outcome === "not_interested") return "lost";
  // Nobody was reached, so it hasn't really been worked yet.
  if (outcome === "bad_number") return stage;
  if (stage === "lead") return "initial_outreach";
  return stage;
}

export type FollowUpState = "overdue" | "today" | "upcoming" | "none";

export function followUpState(nextStepOn: string | null, today: string): FollowUpState {
  if (!nextStepOn) return "none";
  if (nextStepOn < today) return "overdue";
  if (nextStepOn === today) return "today";
  return "upcoming";
}

const DAY_MS = 86_400_000;
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

/** "Due today", "Overdue 3d", "Tomorrow", "Fri, Oct 23". */
export function describeFollowUp(nextStepOn: string | null, today: string) {
  if (!nextStepOn) return null;
  const diff = daysBetween(today, nextStepOn);
  if (diff < 0) return `Overdue ${-diff}d`;
  if (diff === 0) return "Due today";
  if (diff === 1) return "Tomorrow";
  return new Date(`${nextStepOn}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
}

/** True when nobody has touched the deal in `days` days (falls back to when it entered its stage). */
export function untouchedFor(lastContactedAt: Date | null, since: Date, now: Date, days: number) {
  const last = lastContactedAt && lastContactedAt > since ? lastContactedAt : since;
  return now.getTime() - last.getTime() >= days * DAY_MS;
}

/** The follow-up a call sets: the one picked, else the outcome's default. Never one for a closed or dead-number lead. */
export function followUpAfterCall(outcome: Outcome, picked: string, today: string) {
  if (outcome === "not_interested" || outcome === "bad_number") return null;
  return picked || defaultFollowUp(outcome, today);
}

/** What the call puts in "Next step" when the seller didn't type one. */
export function nextStepAfterCall(outcome: Outcome, gatekeeper: string) {
  if (outcome === "gatekeeper") return gatekeeper ? `Call back; ${gatekeeper} answered last time` : "Call back; a gatekeeper answered";
  if (outcome === "no_answer") return "Call again";
  if (outcome === "voicemail") return "Call again after the voicemail";
  return null;
}
