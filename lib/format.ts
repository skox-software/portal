/** Dates in the portal are calendar dates (YYYY-MM-DD), compared in UTC. */

const DAY_MS = 86_400_000;

function utcMidnight(date: Date) {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

export function daysUntil(isoDate: string, today: Date = new Date()) {
  return Math.round((Date.parse(`${isoDate}T00:00:00Z`) - utcMidnight(today)) / DAY_MS);
}

export function describeDaysUntil(days: number) {
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  return days > 0 ? `In ${days} days` : `${-days} days ago`;
}

export function formatDate(isoDate: string | null | undefined) {
  if (!isoDate) return "No date";
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatDateTime(value: Date) {
  return value.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
}

/** The midpoint between two calendar dates, used for the default halfway review. */
export function midpoint(startIso: string, endIso: string) {
  const start = Date.parse(`${startIso}T00:00:00Z`);
  const end = Date.parse(`${endIso}T00:00:00Z`);
  return new Date(start + Math.round((end - start) / 2 / DAY_MS) * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

export function todayIso(today: Date = new Date()) {
  return new Date(utcMidnight(today)).toISOString().slice(0, 10);
}

export const PROJECT_KINDS = [
  { value: "website", label: "Website" },
  { value: "web-app", label: "Web app" },
  { value: "portal", label: "Customer portal" },
  { value: "dashboard", label: "Dashboard" },
  { value: "internal-tool", label: "Internal tool" },
  { value: "other", label: "Other" },
] as const;

export function kindLabel(kind: string) {
  return PROJECT_KINDS.find((k) => k.value === kind)?.label ?? kind;
}

export const STATUS_LABEL = {
  kickoff: "Kickoff",
  building: "Building",
  review: "In review",
  launched: "Launched",
  paused: "Paused",
} as const;

export const MILESTONE_STATE_LABEL = {
  upcoming: "Upcoming",
  in_progress: "In progress",
  done: "Done",
} as const;

export const ROLE_LABEL = {
  staff_owner: "SKOX owner",
  staff: "SKOX team",
  client_approver: "Approver",
  client_member: "Team member",
} as const;
