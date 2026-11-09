/**
 * The Command view's judgment calls, kept pure so they're tested: which desks need a look and why, and the
 * one sentence at the top. Everything shown comes from portal data; nothing here invents a number.
 */
import { deskHealth, type AppStats, type FloorApp } from "./floor.ts";

export type DeskIssue = { key: string; name: string; client: string; level: "down" | "look"; why: string; lastAt: string | null };

/** A desk is down when its self-test fails, and needs a look when it has gone quiet on a workday or misses too often. */
export function deskIssues(desks: { app: FloorApp; stats: AppStats; reporting: boolean }[], now: Date): DeskIssue[] {
  const issues: DeskIssue[] = [];
  const weekday = ![0, 6].includes(new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" })).getDay());
  for (const { app, stats, reporting } of desks) {
    const base = { key: app.key, name: app.name, client: app.client, lastAt: stats.lastAt };
    if (!reporting) { issues.push({ ...base, level: "look", why: "Not reporting to the Control Center" }); continue; }
    const health = deskHealth(stats, now);
    if (health.level !== "ok") { issues.push({ ...base, level: health.level, why: health.why! }); continue; }
    const quietH = stats.lastAt ? (now.getTime() - new Date(stats.lastAt).getTime()) / 3_600_000 : Infinity;
    if (weekday && quietH > 26) { issues.push({ ...base, level: "look", why: `No jobs in ${Math.round(quietH / 24)} days` }); continue; }
    const tried = stats.month + stats.failedMonth;
    if (tried >= 10 && stats.failedMonth / tried > 0.15) issues.push({ ...base, level: "look", why: `${stats.failedMonth} of ${tried} jobs failed in 30 days` });
  }
  return issues.sort((a, b) => (a.level === b.level ? 0 : a.level === "down" ? -1 : 1));
}


/** "Good morning, Josh. 2 decisions are waiting. 1 desk needs a look." */
export function headline(name: string, hourET: number, decisions: number, issues: DeskIssue[]): { greeting: string; rest: string[] } {
  const greeting = `${hourET < 12 ? "Good morning" : hourET < 18 ? "Good afternoon" : "Good evening"}, ${name}.`;
  const rest: string[] = [];
  if (decisions) rest.push(`${decisions} ${decisions === 1 ? "decision is" : "decisions are"} waiting.`);
  const down = issues.filter((i) => i.level === "down").length;
  const look = issues.length - down;
  if (down) rest.push(`${down} ${down === 1 ? "desk is" : "desks are"} down.`);
  else if (look) rest.push(`${look} ${look === 1 ? "desk needs" : "desks need"} a look.`);
  if (!rest.length) rest.push("Nothing needs you right now.");
  return { greeting, rest };
}
