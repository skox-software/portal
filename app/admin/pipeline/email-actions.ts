"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaff } from "@/lib/access";
import { readBrief, type SavedEmailDraft } from "@/lib/call-brief";
import { getDb } from "@/lib/db";
import { deals, emailMessages, emailThreads } from "@/lib/db/schema";
import { eventInsert } from "@/lib/events";
import { FIRST_DEAL_STAGE, trackOf } from "@/lib/pipeline";
import { outreachSender } from "@/lib/lead-email";
import { outreachConfig, sendColdOutreach } from "@/lib/cold-outreach";

const fields = z.object({ dealId: z.uuid(), subject: z.string().trim().min(1).max(200), body: z.string().trim().min(1).max(20000), to: z.email() });

export async function updateLeadEmail(input: { dealId: string; to: string; subject: string; body: string; intent: "save" | "send" }) {
  const { viewer, staff } = await requireStaff();
  const parsed = fields.safeParse(input);
  if (!parsed.success || !["save", "send"].includes(input.intent)) return { error: "Check the recipient, subject and message." };
  const db = getDb();
  const where = and(eq(deals.id, parsed.data.dealId), eq(deals.workspaceId, staff.workspaceId));
  const [deal] = await db.select().from(deals).where(where).limit(1);
  if (!deal || deal.contactEmail !== parsed.data.to) return { error: "The contact changed. Reload this lead before continuing." };
  const previous = readBrief(deal.brief)?.emailDraft;
  if (previous?.status === "scheduled" || previous?.status === "scheduling") return { error: "This email is scheduled. Cancel it with the email provider before changing or sending it." };
  if (previous?.status === "sent") return { error: "This draft has already been sent. Open its conversation in the Inbox." };
  if (previous?.status === "sending") return { error: "This email is being processed. Check the Inbox before trying again." };
  // Whoever presses Send sends as themselves, from the outreach domain; replies come back to their own inbox.
  const sender = outreachSender(viewer.email);
  const draft: SavedEmailDraft = { id: crypto.randomUUID(), fromEmail: sender.fromEmail, subject: parsed.data.subject, body: parsed.data.body, status: "draft", updatedAt: new Date().toISOString() };
  const unchanged = previous
    ? sql`${deals.brief}->'emailDraft' = ${JSON.stringify(previous)}::jsonb`
    : sql`${deals.brief}->'emailDraft' is null`;
  const setDraft = (value: SavedEmailDraft) => sql`jsonb_set(coalesce(${deals.brief}, '{}'::jsonb), '{emailDraft}', ${JSON.stringify(value)}::jsonb)`;
  if (input.intent === "save") {
    const rows = await db.update(deals).set({ brief: setDraft(draft) }).where(and(where, unchanged)).returning({ id: deals.id });
    if (!rows.length) return { error: "This draft changed in another window. Reload before saving." };
    revalidatePath("/admin/pipeline");
    return { notice: "Draft saved. Nothing sent.", status: "draft" as const };
  }
  // Only Reiss can send using his identity, regardless of submitted form values.
  if (process.env.NODE_ENV !== "production" || !process.env.RESEND_API_KEY) return { error: "Sending is available only in production with email configured. Your draft is still unsent." };
  // An opt-out on any lead at this address counts: they asked us to stop, not one card.
  const optedOut = deal.doNotEmail || (await db.select({ id: deals.id }).from(deals).where(and(eq(deals.workspaceId, staff.workspaceId), sql`lower(${deals.contactEmail}) = ${parsed.data.to.toLowerCase()}`, eq(deals.doNotEmail, true))).limit(1)).length > 0;
  if (optedOut) return { error: "This contact asked not to be emailed. Nothing was sent." };
  try { outreachConfig(); } catch (e) {
    return { error: e instanceof Error ? e.message : "Cold outreach is blocked." };
  }
  const sending = { ...draft, status: "sending" as const };
  // One caller wins the claim. Retries cannot send a second message, even if
  // the provider accepted it but the subsequent database write failed.
  const claimed = await db.update(deals).set({ brief: setDraft(sending) }).where(and(where, unchanged)).returning({ id: deals.id });
  if (!claimed.length) return { error: "This draft changed or is already being sent. Reload this lead." };
  let accepted;
  try {
    accepted = await sendColdOutreach({ to: parsed.data.to, subject: draft.subject, body: draft.body, idempotencyKey: `lead-draft/${draft.id}`, sender });
  } catch {
    return { error: "Delivery could not be confirmed. Check the Inbox or email provider before retrying; this draft is locked to prevent a duplicate." };
  }
  if (accepted.error || !accepted.data?.id) {
    await db.update(deals).set({ brief: setDraft(draft) }).where(and(where, sql`${deals.brief}->'emailDraft'->>'id' = ${draft.id}`));
    return { error: "The email provider did not accept this message. Nothing was marked sent; your draft is saved." };
  }
  const sentAt = new Date();
  const threadId = crypto.randomUUID();
  try {
    await db.batch([
      db.insert(emailThreads).values({ id: threadId, workspaceId: staff.workspaceId, dealId: deal.id, clientId: deal.clientId, subject: draft.subject, counterpartEmail: parsed.data.to, counterpartName: deal.contactName, mailbox: sender.replyTo, readAt: sentAt }),
      db.insert(emailMessages).values({ workspaceId: staff.workspaceId, threadId, direction: "outbound", fromEmail: sender.fromEmail, fromName: sender.name, to: [parsed.data.to], subject: draft.subject, text: accepted.payload.text, providerId: `sent:${accepted.data.id}`, sentBy: viewer.userId, sentAt }),
      db.update(deals).set({ brief: setDraft({ ...draft, status: "sent", sentAt: sentAt.toISOString() }), lastContactedAt: sentAt, ...(trackOf(deal.stage) === "outreach" ? { stage: FIRST_DEAL_STAGE, stageChangedAt: sentAt } : {}) }).where(where),
      eventInsert({ workspaceId: staff.workspaceId, actorId: viewer.userId, verb: "deal.email_sent", subjectType: "deal", subjectId: deal.id, payload: { to: parsed.data.to, from: sender.fromEmail, replyTo: sender.replyTo, subject: draft.subject, providerId: accepted.data.id, threadId } }),
      // Sending is enough to make it a Potential Deal.
      ...(trackOf(deal.stage) === "outreach"
        ? [eventInsert({ workspaceId: staff.workspaceId, actorId: viewer.userId, verb: "deal.stage_changed", subjectType: "deal", subjectId: deal.id, payload: { company: deal.company, from: deal.stage, to: FIRST_DEAL_STAGE, via: "email" } })]
        : []),
    ]);
  } catch {
    return { error: "The email was accepted for delivery, but its activity could not be saved. Do not resend; check the email provider." };
  }
  revalidatePath("/admin/pipeline");
  revalidatePath("/admin/inbox");
  return { notice: `Sent from ${sender.fromEmail} to ${parsed.data.to}. Replies go to ${sender.replyTo}.`, status: "sent" as const };
}
