import { timingSafeEqual } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { floorEvents } from "@/lib/db/schema";
import { floorBatch } from "@/lib/floor";

/**
 * Desks and apps report what they did: `Authorization: Bearer $FLOOR_INGEST_SECRET`.
 * This key can only add Floor events, so an app's server holds it, not the company key.
 * Events already received (same app and id) are ignored, which makes retries and backfills safe.
 */
function authorized(request: Request) {
  const secret = process.env.FLOOR_INGEST_SECRET;
  if (!secret) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function POST(request: Request) {
  if (!authorized(request)) return new Response("Unauthorized", { status: 401 });
  const body = floorBatch.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: body.error.issues[0]?.message ?? "Invalid events." }, { status: 400 });
  const { app, events } = body.data;
  const saved = await getDb()
    .insert(floorEvents)
    .values(events.map((e) => ({
      app, externalId: e.id, kind: e.kind, ok: e.ok, at: new Date(e.at), seconds: e.seconds ?? null,
      user: e.user ? e.user.toUpperCase() : null, detail: e.detail ?? null,
    })))
    .onConflictDoNothing({ target: [floorEvents.app, floorEvents.externalId] })
    .returning({ id: floorEvents.id });
  if (saved.length) revalidatePath("/admin/floor");
  return Response.json({ received: events.length, saved: saved.length }, { status: 201 });
}
