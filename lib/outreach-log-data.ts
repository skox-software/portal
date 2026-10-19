import { and, eq, inArray, isNotNull, isNull, like, or, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { deals, emailMessages, emailThreads, events, memberships } from "@/lib/db/schema";
import { bareProviderId, buildOutreachRows, type SentEmail, type StatusEvent } from "@/lib/outreach-log";

type SendPayload = { to?: unknown; from?: unknown; replyTo?: unknown; sentBy?: unknown; subject?: unknown; providerId?: unknown; scheduledAt?: unknown; sendAt?: unknown };

const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const isoOr = (fallback: Date, ...values: unknown[]) => {
  for (const v of values) if (typeof v === "string" && !Number.isNaN(Date.parse(v))) return new Date(v).toISOString();
  return fallback.toISOString();
};

/**
 * Every outreach email the workspace sent to a lead: lead-panel sends, the
 * 2026-10-19 scheduled campaign, and Inbox replies on prospect threads (the
 * ones `sendThreadReply` sends through the cold-outreach gateway), each with
 * its delivery reports.
 */
export async function loadOutreachLog(workspaceId: string) {
  const db = getDb();
  const [sends, replies, reports, staff] = await Promise.all([
    db
      .select({ id: events.id, verb: events.verb, dealId: events.subjectId, actorId: events.actorId, payload: events.payload, createdAt: events.createdAt, lead: deals.company, contactEmail: deals.contactEmail })
      .from(events)
      // subject_id is text; deals.id a uuid.
      .leftJoin(deals, sql`${deals.id}::text = ${events.subjectId}`)
      .where(and(eq(events.workspaceId, workspaceId), eq(events.subjectType, "deal"), inArray(events.verb, ["deal.email_sent", "deal.email_scheduled"]))),
    db
      .select({ id: emailMessages.id, dealId: emailThreads.dealId, lead: deals.company, to: emailMessages.to, fromEmail: emailMessages.fromEmail, subject: emailMessages.subject, providerId: emailMessages.providerId, sentAt: emailMessages.sentAt, sentBy: emailMessages.sentBy, counterpart: emailThreads.counterpartEmail })
      .from(emailMessages)
      .innerJoin(emailThreads, eq(emailThreads.id, emailMessages.threadId))
      .leftJoin(deals, eq(deals.id, emailThreads.dealId))
      .where(
        and(
          eq(emailMessages.workspaceId, workspaceId),
          eq(emailMessages.direction, "outbound"),
          like(emailMessages.providerId, "sent:%"),
          // The threads sendThreadReply sends through the cold-outreach gateway.
          or(isNotNull(emailThreads.dealId), isNull(emailThreads.clientId)),
        ),
      ),
    db.select({ payload: events.payload }).from(events).where(and(eq(events.workspaceId, workspaceId), eq(events.verb, "deal.email_status"))),
    db.select({ userId: memberships.userId, email: memberships.email }).from(memberships).where(and(eq(memberships.workspaceId, workspaceId), isNull(memberships.clientId), isNotNull(memberships.userId))),
  ]);
  const staffEmail = new Map(staff.map((m) => [m.userId!, m.email]));

  const sent: SentEmail[] = [
    ...sends.map((e): SentEmail => {
      const p = (e.payload ?? {}) as SendPayload;
      const sentBy = text(p.sentBy);
      return {
        key: `event:${e.id}`,
        kind: e.verb === "deal.email_scheduled" ? "scheduled" : "lead",
        dealId: e.dealId,
        lead: e.lead ?? null,
        sentAt: isoOr(e.createdAt, p.scheduledAt, p.sendAt),
        to: text(p.to) ?? e.contactEmail ?? null,
        subject: text(p.subject),
        from: text(p.from),
        replyTo: text(p.replyTo),
        senderEmail: (sentBy?.includes("@") ? sentBy : null) ?? (sentBy ? staffEmail.get(sentBy) : null) ?? (e.actorId ? staffEmail.get(e.actorId) : null) ?? null,
        providerId: bareProviderId(text(p.providerId)),
      };
    }),
    ...replies.map((m): SentEmail => ({
      key: `message:${m.id}`,
      kind: "reply",
      dealId: m.dealId,
      lead: m.lead ?? null,
      sentAt: m.sentAt.toISOString(),
      to: m.to[0] ?? m.counterpart,
      subject: m.subject,
      from: m.fromEmail,
      replyTo: null,
      senderEmail: (m.sentBy ? staffEmail.get(m.sentBy) : null) ?? m.fromEmail,
      providerId: bareProviderId(m.providerId),
    })),
  ];
  return buildOutreachRows(sent, reports.map((r) => r.payload as StatusEvent));
}
