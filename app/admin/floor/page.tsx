import type { Metadata } from "next";
import { count, desc, eq, gte } from "drizzle-orm";
import { requireStaff } from "@/lib/access";
import { getDb } from "@/lib/db";
import { companyRuns, floorEvents } from "@/lib/db/schema";
import { FLOOR_APPS, statsFor } from "@/lib/floor";
import { pullFloor } from "@/lib/floor-pull";
import { FloorBoard, type FeedLine, type TileView } from "@/components/floor/FloorBoard";
import "./floor.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "The Floor" };

/**
 * The Floor: every desk and app UnBusy runs, live. Apps are listed in
 * lib/floor.ts; pulled apps (lib/floor-pull.ts) are read when the page opens, pushed ones arrive on
 * /api/floor/events. The company's
 * seats report through their own runs table and are shown here too.
 */
export default async function FloorPage() {
  const { staff } = await requireStaff();
  const db = getDb();
  const now = new Date();
  const since = new Date(now.getTime() - 30 * 86_400_000);
  // Fresh numbers from the apps that are pulled, before reading what's stored.
  await pullFloor();

  const [events, totals, runs, runTotal] = await Promise.all([
    db.select().from(floorEvents).where(gte(floorEvents.at, since)).orderBy(desc(floorEvents.at)).limit(5000),
    db.select({ app: floorEvents.app, n: count() }).from(floorEvents).where(eq(floorEvents.kind, "job")).groupBy(floorEvents.app),
    db.select().from(companyRuns).where(gte(companyRuns.createdAt, since)).orderBy(desc(companyRuns.createdAt)).limit(2000),
    db.select({ n: count() }).from(companyRuns).where(eq(companyRuns.workspaceId, staff.workspaceId)),
  ]);
  const total = new Map(totals.map((t) => [t.app, t.n]));
  const companyRows = runs
    .filter((r) => r.workspaceId === staff.workspaceId)
    .map((r) => ({ kind: "job", ok: r.outcome === "ok", at: r.createdAt, seconds: null, user: null, detail: { type: r.seat } }));

  const tiles: TileView[] = FLOOR_APPS.map((app) => {
    const rows = app.key === "company" ? companyRows : events.filter((e) => e.app === app.key);
    const reporting = rows.length > 0 || (app.key === "company" ? runTotal[0].n > 0 : (total.get(app.key) ?? 0) > 0);
    return { app, reporting, stats: statsFor(app, rows, now, app.key === "company" ? runTotal[0].n : total.get(app.key) ?? 0) };
  });

  const fmt = new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/New_York" });
  const name = (key: string) => FLOOR_APPS.find((a) => a.key === key)?.name ?? key;
  const feed: FeedLine[] = [
    ...events.slice(0, 40).map((e) => {
      const d = (e.detail ?? {}) as { county?: string; type?: string; found?: number; failed?: number; failedCounties?: string[] };
      const what =
        e.kind === "selftest"
          ? e.ok ? "self-test passed" : `self-test failed: ${(d.failedCounties ?? []).join(", ") || "see logs"}`
          : e.kind === "job"
            ? [d.county && `${d.county}`, d.type, e.ok ? "done" : (d as { result?: string }).result === "stopped" ? "stopped" : "failed", e.seconds ? `${e.seconds}s` : null, d.found !== undefined ? `${d.found} found` : null, d.failed ? `${d.failed} missed` : null].filter(Boolean).join(" · ")
            : e.kind;
      return { at: e.at.toISOString(), text: `${fmt.format(e.at)}  ${name(e.app).toUpperCase()} › ${what}`, ok: e.ok };
    }),
    ...runs.filter((r) => r.workspaceId === staff.workspaceId).slice(0, 20).map((r) => ({
      at: r.createdAt.toISOString(), text: `${fmt.format(r.createdAt)}  COMPANY › ${r.seat}: ${r.summary}`, ok: r.outcome === "ok",
    })),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 12);

  return (
    <main className="shell page">
      <div className="page-head">
        <div>
          <p className="eyebrow">The Floor</p>
          <h1>Everything we&rsquo;ve built, working</h1>
          <p className="muted">Live from each desk and app. Counts only: no client documents, addresses or names leave their systems.</p>
        </div>
      </div>
      <FloorBoard now={now.toISOString()} tiles={tiles} feed={feed} />
    </main>
  );
}
