import { z } from "zod";

/**
 * The Control Center: every live desk, app and website we built for a client, and what each one did. Apps are
 * listed here in code; their activity arrives as events on /api/floor/events
 * (floor_events). Hours saved is only ever jobs × a measured by-hand time:
 * until a desk's timing study sets `baselineMinutes`, the page says so.
 *
 * Events carry counts and labels only, never a client's documents, addresses
 * or people's emails (docs/FLOOR.md).
 */

export type FloorApp = {
  key: string;
  name: string;
  /** Who it's for. Internal tools say "UnBusy". */
  client: string;
  kind: "desk" | "app" | "internal" | "website";
  /** What one unit of work is called on this app. */
  unit: string;
  /** Measured minutes the same job takes by hand; null until a timing study measures it. */
  baselineMinutes: number | null;
  /** Measured minutes of staff time per job with the desk (checking, approving); null until measured. */
  withDeskMinutes: number | null;
  /** What it costs us a month to run, in dollars, when known. */
  monthlyCost: number | null;
  url?: string;
  /** A public website to check for live/down each time the Control Center opens. */
  siteUrl?: string;
  /** Where its numbers come from, in words. */
  source: string;
};

export const FLOOR_APPS: FloorApp[] = [
  {
    key: "job-paperwork", name: "Job Paperwork", client: "Ireland Surveying", kind: "desk", unit: "job",
    baselineMinutes: null, withDeskMinutes: null, monthlyCost: null, source: "Its own activity log, read when the Control Center opens",
  },
];

export const FLOOR_APP_KEYS = FLOOR_APPS.map((a) => a.key) as [string, ...string[]];
export const floorAppByKey = new Map(FLOOR_APPS.map((a) => [a.key, a]));

const label = z.string().trim().max(60);

/** One thing an app did. `id` is the app's own id for it, so a backfill never counts a job twice. */
export const floorEvent = z
  .object({
    /** Letters, digits and : . _ - only, so an email can never ride along in an id. */
    id: z.string().regex(/^[A-Za-z0-9:._-]{1,100}$/),
    at: z.iso.datetime({ offset: true }).refine((t) => Date.parse(t) < Date.now() + 10 * 60_000, "Event time is in the future."),
    kind: z.enum(["job", "selftest", "heartbeat", "error"]),
    ok: z.boolean(),
    seconds: z.number().int().min(0).max(86_400).optional(),
    /** Initials only. */
    user: z.string().trim().max(4).regex(/^[A-Za-z]{0,4}$/).optional(),
    detail: z
      .object({
        county: label.optional(),
        type: label.optional(),
        result: z.enum(["done", "stopped", "error"]).optional(),
        found: z.number().int().min(0).max(1000).optional(),
        oneClick: z.number().int().min(0).max(1000).optional(),
        failed: z.number().int().min(0).max(1000).optional(),
        files: z.number().int().min(0).max(1000).optional(),
        /** Website checks: the HTTP status and how long the page took. */
        status: z.number().int().min(0).max(999).optional(),
        ms: z.number().int().min(0).max(60_000).optional(),
        /** Self-test: the counties that failed. */
        failedCounties: z.array(label).max(40).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const floorBatch = z.object({ app: z.enum(FLOOR_APP_KEYS), events: z.array(floorEvent).min(1).max(500) }).strict();
export type FloorEvent = z.infer<typeof floorEvent>;

export type AppStats = {
  today: number;
  week: number;
  month: number;
  total: number;
  failedMonth: number;
  /** Jobs stopped on purpose ("Which lot?", no parcel): not failures. */
  stoppedMonth: number;
  medianSeconds: number | null;
  /** Distinct users (by initials) in the last 30 days. */
  users: string[];
  activeNow: boolean;
  lastAt: string | null;
  selftest: { at: string; ok: boolean; failed: string[] } | null;
  /** Websites: the latest check, and the share of checks in 30 days that found it up. */
  site: { up: boolean; status: number; ms: number; at: string; uptime: number; checks: number } | null;
  /** jobs per day, oldest first, last 14 days. */
  spark: number[];
  hoursSavedMonth: number | null;
  troubleCounties: { county: string; failed: number }[];
};

type Row = { kind: string; ok: boolean; at: Date; seconds: number | null; user: string | null; detail: unknown };

const DAY = 86_400_000;

/** Staff hours a month the desk gave back: jobs × (by hand − with the desk), both measured. Null until both are. */
export function hoursSaved(app: Pick<FloorApp, "baselineMinutes" | "withDeskMinutes">, jobs: number): number | null {
  if (app.baselineMinutes === null || app.withDeskMinutes === null) return null;
  return Math.round(((jobs * Math.max(0, app.baselineMinutes - app.withDeskMinutes)) / 60) * 10) / 10;
}

/** A day key in Eastern time, which is where every client works today. */
function dayKey(d: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d);
}

export function statsFor(app: FloorApp, rows: Row[], now: Date, total: number): AppStats {
  const jobs = rows.filter((r) => r.kind === "job");
  const done = jobs.filter((r) => r.ok);
  const today = dayKey(now);
  const inLast = (ms: number) => (r: Row) => now.getTime() - r.at.getTime() < ms;
  const month = done.filter(inLast(30 * DAY));
  const secs = month.map((r) => r.seconds ?? 0).filter((s) => s > 0).sort((a, b) => a - b);
  const mid = secs.length ? (secs.length % 2 ? secs[(secs.length - 1) / 2] : (secs[secs.length / 2 - 1] + secs[secs.length / 2]) / 2) : null;
  const spark = Array.from({ length: 14 }, (_, i) => {
    const key = dayKey(new Date(now.getTime() - (13 - i) * DAY));
    return done.filter((r) => dayKey(r.at) === key).length;
  });
  const tests = rows.filter((r) => r.kind === "selftest").sort((a, b) => b.at.getTime() - a.at.getTime());
  const lastTest = tests[0];
  const trouble = new Map<string, number>();
  for (const r of jobs.filter(inLast(30 * DAY))) {
    const d = (r.detail ?? {}) as { county?: string; failed?: number };
    if (d.county && (d.failed ?? 0) > 0) trouble.set(d.county, (trouble.get(d.county) ?? 0) + (d.failed ?? 0));
  }
  const checks = rows.filter((r) => r.kind === "heartbeat" && inLast(30 * DAY)(r)).sort((a, b) => b.at.getTime() - a.at.getTime());
  const lastCheck = checks[0];
  const last = rows.reduce<Date | null>((m, r) => (r.kind === "job" && (!m || r.at > m) ? r.at : m), null);
  return {
    today: done.filter((r) => dayKey(r.at) === today).length,
    week: done.filter(inLast(7 * DAY)).length,
    month: month.length,
    total,
    failedMonth: jobs.filter(inLast(30 * DAY)).filter((r) => !r.ok && (r.detail as { result?: string } | null)?.result !== "stopped").length,
    stoppedMonth: jobs.filter(inLast(30 * DAY)).filter((r) => (r.detail as { result?: string } | null)?.result === "stopped").length,
    medianSeconds: mid,
    users: [...new Set(jobs.filter(inLast(30 * DAY)).map((r) => r.user).filter((u): u is string => !!u))],
    activeNow: !!last && now.getTime() - last.getTime() < 15 * 60_000,
    lastAt: last?.toISOString() ?? null,
    selftest: lastTest ? { at: lastTest.at.toISOString(), ok: lastTest.ok, failed: ((lastTest.detail ?? {}) as { failedCounties?: string[] }).failedCounties ?? [] } : null,
    site: lastCheck
      ? {
          up: lastCheck.ok,
          status: ((lastCheck.detail ?? {}) as { status?: number }).status ?? 0,
          ms: ((lastCheck.detail ?? {}) as { ms?: number }).ms ?? 0,
          at: lastCheck.at.toISOString(),
          uptime: Math.round((checks.filter((c) => c.ok).length / checks.length) * 1000) / 10,
          checks: checks.length,
        }
      : null,
    spark,
    hoursSavedMonth: hoursSaved(app, month.length),
    troubleCounties: [...trouble.entries()].map(([county, failed]) => ({ county, failed })).sort((a, b) => b.failed - a.failed).slice(0, 3),
  };
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Is the desk itself working? A failed self-test usually means a county's own website isn't answering, which
 * isn't our app being down: if staff jobs have finished in the last day, the desk is working and only the named
 * counties need a look. It's down only when the self-test fails and no job has finished in a day.
 */
export function deskHealth(stats: AppStats, now: Date): { level: "ok" | "look" | "down"; why: string | null } {
  const finishedRecently = !!stats.lastAt && now.getTime() - new Date(stats.lastAt).getTime() < 26 * 3_600_000 && stats.week > 0;
  if (stats.selftest && !stats.selftest.ok) {
    const where = stats.selftest.failed.map(cap).join(", ");
    if (finishedRecently) return { level: "look", why: `${where || "A county"} not answering in this morning's self-test. Jobs are still finishing.` };
    return { level: "down", why: `Self-test failed${where ? `: ${where}` : ""}, and no job has finished in a day` };
  }
  return { level: "ok", why: null };
}
