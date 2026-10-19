/**
 * The admin Overview's rules: how the "Needs you" queue is ranked and
 * filtered, the week's sales activity per person, the revenue pace line and
 * which commission flags are still open.
 *
 * Pure, with no Node or database imports, so it can be tested alone.
 * lib/overview-data.ts reads the rows; app/admin/page.tsx only renders.
 */

import { addDays } from "./follow-up.ts";
import { calendarProgress, paceToDate } from "./forecast-math.ts";

/** Now: money or a person is waiting. Today: due today. Week: worth doing this week. */
export type Tier = "now" | "today" | "week";

export const TIER_LABEL: Record<Tier, string> = { now: "Now", today: "Today", week: "This week" };
const TIER_RANK: Record<Tier, number> = { now: 0, today: 1, week: 2 };

/** Where an item comes from, for its icon. */
export type QueueSource =
  | "follow_up"
  | "invoice"
  | "commission"
  | "deal"
  | "outreach"
  | "meeting"
  | "inbox"
  | "request"
  | "approval"
  | "document"
  | "idea"
  | "feedback"
  | "onboarding"
  | "referral"
  | "contact";

export type QueueItem = {
  key: string;
  tier: Tier;
  source: QueueSource;
  /** A staff email (lowercased) when one person owns it; null when it's the team's. */
  owner: string | null;
  text: string;
  detail?: string | null;
  href: string;
  /** ISO timestamp or date the item became due or arrived; older ranks first within a tier. */
  at?: string | null;
};

export type Who = "me" | "all";

export function parseWho(value: unknown): Who {
  return value === "all" ? "all" : "me";
}

/**
 * "Mine" keeps what the viewer owns plus everything nobody owns (requests,
 * invoices, client setup): it hides only what is clearly someone else's.
 */
export function visibleTo(item: Pick<QueueItem, "owner">, who: Who, me: string) {
  return who === "all" || item.owner === null || item.owner === me.toLowerCase();
}

/** Tier first, then the oldest item first; undated items after dated ones. */
export function rankQueue<T extends Pick<QueueItem, "tier" | "at" | "key">>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const t = TIER_RANK[a.tier] - TIER_RANK[b.tier];
    if (t) return t;
    if (a.at && b.at) return a.at < b.at ? -1 : a.at > b.at ? 1 : a.key.localeCompare(b.key);
    if (a.at) return -1;
    if (b.at) return 1;
    return a.key.localeCompare(b.key);
  });
}

/** The ranked queue for one viewer, and how many items the rest of the team has. */
export function buildQueue(items: QueueItem[], who: Who, me: string) {
  const mine = items.filter((i) => visibleTo(i, "me", me));
  const shown = rankQueue(who === "all" ? items : mine);
  return { items: shown, mineCount: mine.length, teamCount: items.length, othersCount: items.length - mine.length };
}

/** Days a YYYY-MM-DD date is past `today` (0 when due today or later). */
export function daysLate(dueOn: string, today: string) {
  const ms = Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10)) - Date.UTC(+dueOn.slice(0, 4), +dueOn.slice(5, 7) - 1, +dueOn.slice(8, 10));
  return Math.max(0, Math.round(ms / 86_400_000));
}

/** An overdue follow-up is Now; one due today is Today. */
export function followUpTier(dueOn: string, today: string): Tier {
  return dueOn < today ? "now" : "today";
}

export function lateLabel(dueOn: string, today: string) {
  const n = daysLate(dueOn, today);
  return n === 0 ? "Due today" : n === 1 ? "1 day overdue" : `${n} days overdue`;
}

/** Is a YYYY-MM-DD date within the next `days` days, today included? */
export function withinDays(iso: string, today: string, days: number) {
  return iso >= today && iso <= addDays(today, days - 1);
}

export type ActivityCount = { verb: string; actor: string | null; n: number };
export type ActivityRow = { person: string; calls: number; emails: number; created: number; won: number; total: number };

const ACTIVITY_COLUMN: Record<string, keyof Omit<ActivityRow, "person" | "total">> = {
  "deal.call_logged": "calls",
  "deal.email_sent": "emails",
  "deal.created": "created",
  "deal.won": "won",
};

/**
 * One row per person from counts grouped by verb and actor. `deal.won` is
 * the data layer's name for a stage move to Won. Actors without a staff
 * email (imports, the website, scripts) are left out: they aren't anyone's
 * work this week.
 */
export function weeklyActivity(counts: ActivityCount[]): ActivityRow[] {
  const rows = new Map<string, ActivityRow>();
  for (const c of counts) {
    const column = ACTIVITY_COLUMN[c.verb];
    if (!column || !c.actor || !c.n) continue;
    const row = rows.get(c.actor) ?? { person: c.actor, calls: 0, emails: 0, created: 0, won: 0, total: 0 };
    row[column] += c.n;
    row.total += c.n;
    rows.set(c.actor, row);
  }
  return [...rows.values()].sort((a, b) => b.won - a.won || b.total - a.total || a.person.localeCompare(b.person));
}

/**
 * The month's collected line against the yearly goal: where the year lands
 * at today's pace, and the share of the goal that is. Null without a goal
 * for this year.
 */
export function goalPace(ytdCents: number, goalCents: number | null, today: string) {
  if (!goalCents || goalCents <= 0) return null;
  const { dayOfYear, daysInYear } = calendarProgress(today);
  const projectedCents = paceToDate(ytdCents, dayOfYear, daysInYear);
  const expectedCents = Math.round((goalCents * dayOfYear) / daysInYear);
  return {
    projectedCents,
    percentOfGoal: Math.round((ytdCents / goalCents) * 100),
    onTrack: ytdCents >= expectedCents,
  };
}

export type CommissionFlag = { invoiceId: string; number: string | null; reason: string | null; at: string };

/**
 * `commission.needs_attention` flags nobody has fixed yet: the latest flag
 * per invoice, dropped once the ledger has an entry for that invoice dated
 * after it (an adjustment or a corrected earning).
 */
export function openCommissionFlags(flags: CommissionFlag[], ledgerAt: Map<string, string>): CommissionFlag[] {
  const latest = new Map<string, CommissionFlag>();
  for (const f of flags) {
    const prev = latest.get(f.invoiceId);
    if (!prev || f.at > prev.at) latest.set(f.invoiceId, f);
  }
  return [...latest.values()].filter((f) => {
    const fixedAt = ledgerAt.get(f.invoiceId);
    return !fixedAt || fixedAt < f.at;
  });
}
