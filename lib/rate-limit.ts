import { and, count, eq, gt, lt } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { rateEvents } from "@/lib/db/schema";

/**
 * A small database-backed throttle (serverless instances don't share memory).
 * Returns true and records the attempt when under the limit; false otherwise.
 */
export async function allow(key: string, limit: number, windowMs: number) {
  const db = getDb();
  const since = new Date(Date.now() - windowMs);
  const [row] = await db
    .select({ n: count() })
    .from(rateEvents)
    .where(and(eq(rateEvents.key, key), gt(rateEvents.createdAt, since)));
  if (Number(row?.n ?? 0) >= limit) return false;
  await db.insert(rateEvents).values({ key: key.slice(0, 300) });
  return true;
}

/** Old throttle rows are only useful for a day. Called by the daily cron. */
export async function pruneRateEvents() {
  await getDb().delete(rateEvents).where(lt(rateEvents.createdAt, new Date(Date.now() - 2 * 86_400_000)));
}
