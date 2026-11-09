import type { Metadata } from "next";
import { count, desc, eq, gte } from "drizzle-orm";
import { requireStaff } from "@/lib/access";
import { getDb } from "@/lib/db";
import { floorEvents } from "@/lib/db/schema";
import { FLOOR_APPS, statsFor } from "@/lib/floor";
import { checkSites, pullFloor } from "@/lib/floor-pull";
import { FloorBoard, type FeedLine, type TileView } from "@/components/floor/FloorBoard";
import "./floor.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Control Center" };

/**
 * The Control Center: the live desks, apps and websites we built for clients, and nothing internal.
 * Apps are listed in lib/floor.ts; pulled apps (lib/floor-pull.ts) are read when the page opens,
 * pushed ones arrive on /api/floor/events.
 */
export default async function FloorPage() {
  await requireStaff();
  const db = getDb();
  const now = new Date();
  const since = new Date(now.getTime() - 30 * 86_400_000);
  // Fresh numbers from the apps that are pulled, before reading what's stored.
  await Promise.all([pullFloor(), checkSites(now)]);

  const [events, totals] = await Promise.all([
    db.select().from(floorEvents).where(gte(floorEvents.at, since)).orderBy(desc(floorEvents.at)).limit(5000),
    db.select({ app: floorEvents.app, n: count() }).from(floorEvents).where(eq(floorEvents.kind, "job")).groupBy(floorEvents.app),
  ]);
  const total = new Map(totals.map((t) => [t.app, t.n]));
  const tiles: TileView[] = FLOOR_APPS.map((app) => {
    const rows = events.filter((e) => e.app === app.key);
    return { app, reporting: rows.length > 0 || (total.get(app.key) ?? 0) > 0, stats: statsFor(app, rows, now, total.get(app.key) ?? 0) };
  });

  const fmt = new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/New_York" });
  const name = (key: string) => FLOOR_APPS.find((a) => a.key === key)?.name ?? key;
  const feed: FeedLine[] = events.slice(0, 40).map((e) => {
      const d = (e.detail ?? {}) as { county?: string; type?: string; found?: number; failed?: number; failedCounties?: string[] };
      const what =
        e.kind === "heartbeat"
          ? `${e.ok ? "live" : "DOWN"} · ${(d as { status?: number }).status || "no answer"} · ${(d as { ms?: number }).ms ?? 0} ms`
          : e.kind === "selftest"
          ? e.ok ? "self-test passed" : `self-test failed: ${(d.failedCounties ?? []).join(", ") || "see logs"}`
          : e.kind === "job"
            ? [d.county && `${d.county}`, d.type, e.ok ? "done" : (d as { result?: string }).result === "stopped" ? "stopped" : "failed", e.seconds ? `${e.seconds}s` : null, d.found !== undefined ? `${d.found} found` : null, d.failed ? `${d.failed} missed` : null].filter(Boolean).join(" · ")
            : e.kind;
      return { at: e.at.toISOString(), text: `${fmt.format(e.at)}  ${name(e.app).toUpperCase()} › ${what}`, ok: e.ok };
    }).slice(0, 12);

  return (
    <main className="shell page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Control Center</p>
          <h1>What we&rsquo;ve built for clients, live</h1>
          <p className="muted">Every live desk, app and website. Counts only: no client documents, addresses or names leave their systems.</p>
        </div>
      </div>
      <FloorBoard now={now.toISOString()} tiles={tiles} feed={feed} />
    </main>
  );
}
