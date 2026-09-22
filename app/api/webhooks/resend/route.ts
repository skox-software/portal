import { eq, sql } from "drizzle-orm";
import { ingestReceivedEmail, verifyResendWebhook } from "@/lib/crm-email";
import { getDb } from "@/lib/db";
import { inboundEvents } from "@/lib/db/schema";

// node:crypto for the signature check; attachment copying can take a while.
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Resend `email.received` webhook. Public (see proxy.ts), so it trusts nothing
 * until the Svix signature checks out against the raw body.
 *
 * Idempotency: one inbound_events row per Resend email id. A repeat delivery of
 * an email that was already processed is a no-op; a repeat of one that failed
 * is processed again, which is what Resend's retry is for.
 */
export async function POST(request: Request) {
  if (!process.env.RESEND_WEBHOOK_SECRET) {
    console.error("[resend-webhook] RESEND_WEBHOOK_SECRET is not set");
    return new Response("Not configured", { status: 500 });
  }

  // Must be the exact bytes Resend signed: parsing and re-stringifying breaks it.
  const rawBody = await request.text();
  try {
    verifyResendWebhook(rawBody, request.headers);
  } catch (error) {
    console.warn("[resend-webhook] rejected:", (error as Error).message);
    return new Response("Invalid signature", { status: 400 });
  }

  let event: { type?: string; data?: { email_id?: string } };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  if (event.type !== "email.received") {
    return Response.json({ ok: true, ignored: event.type ?? null });
  }
  const emailId = event.data?.email_id;
  if (!emailId) return new Response("Missing email_id", { status: 400 });

  const db = getDb();
  const [row] = await db
    .insert(inboundEvents)
    .values({ resendId: emailId, eventType: event.type, payload: event })
    .onConflictDoUpdate({
      target: inboundEvents.resendId,
      set: { attempts: sql`${inboundEvents.attempts} + 1` },
    })
    .returning({ processedAt: inboundEvents.processedAt });
  if (row?.processedAt) return Response.json({ ok: true, duplicate: true });

  try {
    const outcome = await ingestReceivedEmail(emailId);
    await db
      .update(inboundEvents)
      .set({ processedAt: new Date(), outcome, error: null })
      .where(eq(inboundEvents.resendId, emailId));
    return Response.json({ ok: true, outcome });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[resend-webhook] ingest failed:", message);
    await db.update(inboundEvents).set({ error: message.slice(0, 2000) }).where(eq(inboundEvents.resendId, emailId));
    // 500 makes Resend retry; the row above lets the retry through.
    return new Response("Ingest failed", { status: 500 });
  }
}
