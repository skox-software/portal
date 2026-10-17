"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { Resend } from "resend";
import { z } from "zod";
import { requireStaff } from "@/lib/access";
import { readBrief, type SavedEmailDraft } from "@/lib/call-brief";
import { getDb } from "@/lib/db";
import { deals, emailMessages, emailThreads } from "@/lib/db/schema";
import { eventInsert } from "@/lib/events";
import { LEAD_SENDER_EMAIL, leadEmailPayload } from "@/lib/lead-email";

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
  if (previous?.status === "sent") return { error: "This draft has already been sent. Open its conversation in the Inbox." };
  if (previous?.status === "sending") return { error: "This email is being processed. Check the Inbox before trying again." };
  const draft: SavedEmailDraft = { id: crypto.randomUUID(), fromEmail: LEAD_SENDER_EMAIL, subject: parsed.data.subject, body: parsed.data.body, status: "draft", updatedAt: new Date().toISOString() };
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
  if (viewer.email.toLowerCase() !== LEAD_SENDER_EMAIL) return { error: `Sign in as ${LEAD_SENDER_EMAIL} to send this email.` };
  if (process.env.NODE_ENV !== "production" || !process.env.RESEND_API_KEY) return { error: "Sending is available only in production with email configured. Your draft is still unsent." };
  const sending = { ...draft, status: "sending" as const };
  // One caller wins the claim. Retries cannot send a second message, even if
  // the provider accepted it but the subsequent database write failed.
  const claimed = await db.update(deals).set({ brief: setDraft(sending) }).where(and(where, unchanged)).returning({ id: deals.id });
  if (!claimed.length) return { error: "This draft changed or is already being sent. Reload this lead." };
  const resend = new Resend(process.env.RESEND_API_KEY);
  let accepted;
  try {
    accepted = await resend.emails.send(leadEmailPayload(parsed.data.to, draft.subject, draft.body), { idempotencyKey: `lead-draft/${draft.id}` });
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
      db.insert(emailThreads).values({ id: threadId, workspaceId: staff.workspaceId, dealId: deal.id, clientId: deal.clientId, subject: draft.subject, counterpartEmail: parsed.data.to, counterpartName: deal.contactName, mailbox: LEAD_SENDER_EMAIL, readAt: sentAt }),
      db.insert(emailMessages).values({ workspaceId: staff.workspaceId, threadId, direction: "outbound", fromEmail: LEAD_SENDER_EMAIL, fromName: "Reiss Skeen", to: [parsed.data.to], subject: draft.subject, text: draft.body, providerId: `sent:${accepted.data.id}`, sentBy: viewer.userId, sentAt }),
      db.update(deals).set({ brief: setDraft({ ...draft, status: "sent", sentAt: sentAt.toISOString() }), lastContactedAt: sentAt, ...(deal.stage === "lead" ? { stage: "initial_outreach" as const, stageChangedAt: sentAt } : {}) }).where(where),
      eventInsert({ workspaceId: staff.workspaceId, actorId: viewer.userId, verb: "deal.email_sent", subjectType: "deal", subjectId: deal.id, payload: { to: parsed.data.to, from: LEAD_SENDER_EMAIL, subject: draft.subject, providerId: accepted.data.id, threadId } }),
    ]);
  } catch {
    return { error: "The email was accepted for delivery, but its activity could not be saved. Do not resend; check the email provider." };
  }
  revalidatePath("/admin/pipeline");
  revalidatePath("/admin/inbox");
  return { notice: `Sent from ${LEAD_SENDER_EMAIL} to ${parsed.data.to}.`, status: "sent" as const };
}
