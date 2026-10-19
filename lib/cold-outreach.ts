import { eq, sql } from "drizzle-orm";
import { Resend } from "resend";
import { getDb } from "@/lib/db";
import { deals, outreachRecipients } from "@/lib/db/schema";
import { leadEmailPayload } from "@/lib/lead-email";
import { unsubscribeUrl } from "@/lib/unsubscribe";

export function outreachConfig() {
  const postalAddress = process.env.SKOX_POSTAL_ADDRESS?.trim();
  const secret = process.env.UNSUBSCRIBE_SECRET?.trim();
  if (!postalAddress || !secret) throw new Error("Cold outreach is blocked: SKOX_POSTAL_ADDRESS and UNSUBSCRIBE_SECRET must be configured.");
  if (process.env.COLD_OUTREACH_ENABLED !== "true" || !process.env.OUTREACH_RESEND_API_KEY || process.env.NODE_ENV !== "production") {
    throw new Error("Cold outreach is disabled until its address, unsubscribe route and sending domain have been verified.");
  }
  return { postalAddress, secret, key: process.env.OUTREACH_RESEND_API_KEY };
}

export async function suppressOutreach(email: string) {
  const normalized = email.trim().toLowerCase();
  if (!normalized) throw new Error("No recipient address to suppress.");
  const db = getDb();
  await db.insert(outreachRecipients).values({ email: normalized, suppressed: true })
    .onConflictDoUpdate({ target: outreachRecipients.email, set: { suppressed: true } });
  await db.update(deals).set({ doNotEmail: true }).where(sql`lower(trim(${deals.contactEmail})) = ${normalized}`);
}

/** All prospect sends (including Inbox replies) use this immediate-only gateway.
 * Never pre-schedule provider messages: opt-outs must be checked at dispatch.
 */
export async function sendColdOutreach(input: { to: string; subject: string; body: string; idempotencyKey: string }) {
  const config = outreachConfig(); // Before any database claim/provider call.
  const db = getDb();
  const email = input.to.trim().toLowerCase();
  await db.insert(outreachRecipients).values({ email }).onConflictDoNothing();
  const [recipient] = await db.select().from(outreachRecipients).where(eq(outreachRecipients.email, email)).limit(1);
  const legacy = await db.select({ id: deals.id }).from(deals).where(sql`lower(trim(${deals.contactEmail})) = ${email} and ${deals.doNotEmail} = true`).limit(1);
  if (!recipient || recipient.suppressed || legacy.length) throw new Error("This contact asked not to be emailed. Nothing was sent.");
  const payload = leadEmailPayload(email, input.subject, input.body, {
    postalAddress: config.postalAddress,
    unsubscribeUrl: unsubscribeUrl(process.env.PORTAL_URL ?? "https://www.skoxsoftware.com/portal", recipient.id, email, config.secret),
  });
  const result = await new Resend(config.key).emails.send(payload, { idempotencyKey: input.idempotencyKey });
  return { ...result, payload };
}
