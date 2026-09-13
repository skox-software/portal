/**
 * The shape of the welcome flow: which steps a client sees, how far along
 * they are, and when onboarding counts as complete. Pure and tested.
 */

export type StepKey = "welcome" | "you" | "team" | "project" | "brand" | "access" | "agreement" | "kickoff";
export type StepState = "done" | "skipped";

export type StepDef = {
  key: StepKey;
  title: string;
  short: string;
  minutes: number;
  /** Required steps can't be skipped; onboarding isn't complete without them. */
  required: boolean;
};

// Order matters: the agreement comes right after the welcome. A signed,
// paid client is a committed client; the longer questions come after.
const ALL: StepDef[] = [
  { key: "welcome", title: "Welcome to SKOX", short: "Welcome", minutes: 1, required: true },
  { key: "agreement", title: "Your agreement", short: "Agreement", minutes: 2, required: false },
  { key: "you", title: "A little about you", short: "You", minutes: 2, required: true },
  { key: "team", title: "Your team", short: "Team", minutes: 1, required: false },
  { key: "project", title: "Your project", short: "Project", minutes: 5, required: true },
  { key: "brand", title: "Your brand", short: "Brand", minutes: 3, required: false },
  { key: "access", title: "Access we'll need", short: "Access", minutes: 2, required: false },
  { key: "kickoff", title: "Book your kickoff", short: "Kickoff", minutes: 1, required: false },
];

export function stepsFor({ hasAgreement }: { hasAgreement: boolean }) {
  return ALL.filter((s) => s.key !== "agreement" || hasAgreement);
}

export function isStepKey(value: unknown): value is StepKey {
  return typeof value === "string" && ALL.some((s) => s.key === value);
}

export function progress(states: Partial<Record<string, StepState>>, steps: StepDef[]) {
  const finished = steps.filter((s) => states[s.key] === "done" || states[s.key] === "skipped");
  const minutesLeft = steps.filter((s) => !states[s.key]).reduce((m, s) => m + s.minutes, 0);
  return {
    finished: finished.length,
    total: steps.length,
    percent: steps.length ? Math.round((finished.length / steps.length) * 100) : 0,
    minutesLeft,
  };
}

/** The first step not yet done or skipped; null when everything is through. */
export function nextStep(states: Partial<Record<string, StepState>>, steps: StepDef[]): StepKey | null {
  return steps.find((s) => !states[s.key])?.key ?? null;
}

export function neighbours(key: StepKey, steps: StepDef[]) {
  const i = steps.findIndex((s) => s.key === key);
  return { prev: i > 0 ? steps[i - 1].key : null, next: i >= 0 && i < steps.length - 1 ? steps[i + 1].key : null };
}

/** Complete when every required step is done and every other step is done or skipped. */
export function isComplete(states: Partial<Record<string, StepState>>, steps: StepDef[]) {
  return steps.every((s) => (s.required ? states[s.key] === "done" : Boolean(states[s.key])));
}

export function canSkip(key: StepKey) {
  return !ALL.find((s) => s.key === key)?.required;
}

/** Days since a timestamp, for "stuck" flags and reminders. */
export function idleDays(last: Date | null | undefined, now: Date = new Date()) {
  if (!last) return null;
  return Math.floor((now.getTime() - last.getTime()) / 86_400_000);
}

/** Should the client get a nudge? At most 3, two days idle, three days apart. */
export function shouldRemind(
  o: { status: string; lastActivityAt: Date | null; createdAt: Date; lastRemindedAt: Date | null; remindersSent: number },
  now: Date = new Date(),
) {
  if (o.status === "completed" || o.remindersSent >= 3) return false;
  const idle = idleDays(o.lastActivityAt ?? o.createdAt, now) ?? 0;
  const sinceReminder = idleDays(o.lastRemindedAt, now);
  return idle >= 2 && (sinceReminder === null || sinceReminder >= 3);
}
