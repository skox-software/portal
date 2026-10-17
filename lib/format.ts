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

/**
 * "2 hours ago", for the moments staff read as a signal: when a client opened
 * the agreement, when they were last in the portal. Rounds down, so it never
 * claims more time has passed than actually has.
 */
export function timeAgo(value: Date | null | undefined, now: Date = new Date()) {
  if (!value) return null;
  const ms = now.getTime() - value.getTime();
  if (ms < 0) return "just now";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} ${months === 1 ? "month" : "months"} ago`;
  const years = Math.floor(days / 365);
  return `${years} ${years === 1 ? "year" : "years"} ago`;
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

export function formatMoney(cents: number, currency = "usd") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

/** "2026-09-01" → "September 2026" */
export function formatMonth(isoDate: string) {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  });
}

/** Percentage change, rounded; null when there's nothing to compare with. */
export function percentChange(current: number | null | undefined, previous: number | null | undefined) {
  if (current == null || previous == null || previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

export function firstName(nameOrEmail: string | null | undefined) {
  if (!nameOrEmail) return "there";
  const base = nameOrEmail.includes("@") ? nameOrEmail.split("@")[0] : nameOrEmail;
  const word = base.split(/[\s._-]+/)[0] ?? base;
  return word.charAt(0).toUpperCase() + word.slice(1);
}

export function greeting(now: Date = new Date()) {
  const hour = Number(
    now.toLocaleString("en-US", { hour: "numeric", hour12: false, timeZone: "America/New_York" }),
  );
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export const DOCUMENT_KIND_LABEL = {
  proposal: "Proposal",
  sow: "Statement of work",
  contract: "Contract",
  nda: "NDA",
  change_order: "Change order",
  other: "Document",
} as const;

export const REQUEST_STATUS_LABEL = {
  new: "New",
  in_progress: "In progress",
  waiting_on_client: "Waiting on you",
  done: "Done",
} as const;

export const PRIORITY_LABEL = { low: "Low", normal: "Normal", urgent: "Urgent" } as const;

export const IDEA_STATUS_LABEL = {
  proposed: "New idea",
  interested: "You're interested",
  not_now: "Not now",
  planned: "Planned",
} as const;

export const RESOURCE_KIND_LABEL = {
  video: "Video",
  guide: "Guide",
  link: "Link",
  login_note: "Access note",
} as const;

export const ROLE_LABEL = {
  staff_owner: "SKOX owner",
  staff: "SKOX team",
  client_approver: "Approver",
  client_member: "Team member",
  rep: "Sales rep",
} as const;

/** Current time in ms. Lives here so server components read the clock through one place. */
export function nowMs() {
  return Date.now();
}
