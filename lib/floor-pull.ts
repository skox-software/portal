import { and, eq, max } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { floorEvents } from "@/lib/db/schema";
import { floorEvent } from "@/lib/floor";

/**
 * Apps the Floor pulls from when someone opens it, instead of the app pushing on every job: the app never waits on
 * the portal, and nothing runs while nobody is looking. Each pull asks only for what's new (from a day before the
 * newest event we hold) and gives up after 4 seconds, falling back to what's stored.
 */
const PULLS: { app: string; url: string | undefined; secret: string | undefined }[] = [
  { app: "job-paperwork", url: process.env.FLOOR_JOB_PAPERWORK_URL, secret: process.env.FLOOR_PULL_SECRET },
];

export async function pullFloor(): Promise<{ app: string; ok: boolean; saved: number }[]> {
  const db = getDb();
  return Promise.all(
    PULLS.filter((p) => p.url && p.secret).map(async ({ app, url, secret }) => {
      try {
        const [{ newest }] = await db.select({ newest: max(floorEvents.at) }).from(floorEvents).where(and(eq(floorEvents.app, app), eq(floorEvents.kind, "job")));
        const since = newest ? new Date(new Date(newest).getTime() - 86_400_000) : new Date(Date.now() - 60 * 86_400_000);
        const res = await fetch(`${url}?since=${encodeURIComponent(since.toISOString())}`, {
          headers: { authorization: `Bearer ${secret}` },
          signal: AbortSignal.timeout(4000),
          cache: "no-store",
        });
        if (!res.ok) {
          console.error(`[floor] ${app} answered ${res.status}`);
          return { app, ok: false, saved: 0 };
        }
        const body = (await res.json()) as { events?: unknown[] };
        // Every event is checked against the same strict shape as pushed ones; anything else is dropped.
        const events = (body.events ?? []).flatMap((e) => {
          const parsed = floorEvent.safeParse(e);
          return parsed.success ? [parsed.data] : [];
        });
        if (!events.length) return { app, ok: true, saved: 0 };
        const saved = await db
          .insert(floorEvents)
          .values(events.map((e) => ({
            app, externalId: e.id, kind: e.kind, ok: e.ok, at: new Date(e.at), seconds: e.seconds ?? null,
            user: e.user ? e.user.toUpperCase() : null, detail: e.detail ?? null,
          })))
          .onConflictDoNothing({ target: [floorEvents.app, floorEvents.externalId] })
          .returning({ id: floorEvents.id });
        return { app, ok: true, saved: saved.length };
      } catch (e) {
        console.error(`[floor] ${app}: ${(e as Error).message}`);
        return { app, ok: false, saved: 0 };
      }
    }),
  );
}
