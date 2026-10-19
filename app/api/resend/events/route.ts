import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { deals, events } from "@/lib/db/schema";
import { blocksEmail, readStatusEvent } from "@/lib/resend-events";
import { suppressOutreach } from "@/lib/cold-outreach";
import { verifySvix } from "@/lib/svix";

/**
 * Resend's delivery reports for the email we send: delivered, delayed,
 * opened, clicked, bounced, marked as spam. Each one is matched to the lead
 * whose `deal.email_sent` event carries the same Resend id and recorded as a
 * `deal.email_status` event. A bounce or spam complaint also suppresses the
 * address for all outreach (`suppressOutreach`). Mail that isn't lead outreach (portal notices) is ignored.
 *
 * Signed with RESEND_EVENTS_SECRET; anything unsigned is refused. Resend
 * retries with the same Svix message id, which is recorded so a retry is a
 * no-op.
 */

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const secret = process.env.RESEND_EVENTS_SECRET;
  if (!secret) return new Response("Delivery reports not configured", { status: 503 });

  const payload = await request.text();
  const svixId = request.headers.get("svix-id");
  const signed = verifySvix(payload, { id: svixId, timestamp: request.headers.get("svix-timestamp"), signature: request.headers.get("svix-signature") }, secret);
  if (!signed || !svixId) return new Response("Bad signature", { status: 401 });

  let body: unknown;
  try {
    body = JSON.parse(payload);
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }
  const report = readStatusEvent(body);
  if (!report) return Response.json({ ignored: (body as { type?: string })?.type ?? "unknown" });

  const db = getDb();
  const [sent] = await db
    .select({ workspaceId: events.workspaceId, dealId: events.subjectId, to: sql<string | null>`${events.payload}->>'to'` })
    .from(events)
    .where(and(inArray(events.verb, ["deal.email_sent", "deal.email_scheduled"]), eq(events.subjectType, "deal"), sql`${events.payload}->>'providerId' = ${report.emailId}`))
    .limit(1);
  if (!sent?.dealId) return Response.json({ ignored: "not lead outreach" });

  // Suppress first: it is safe to repeat, so a failure before the event is written leaves nothing half-done for the retry.
  // A bounce or spam report blocks the address everywhere (every lead with it, and any lead added later), not just this one.
  let markedDoNotEmail = false;
  if (blocksEmail(report.status)) {
    const [deal] = await db.select({ email: deals.contactEmail }).from(deals).where(and(eq(deals.id, sent.dealId), eq(deals.workspaceId, sent.workspaceId))).limit(1);
    const address = sent.to ?? deal?.email;
    if (address) {
      await suppressOutreach(address);
      markedDoNotEmail = true;
    }
  }

  const eventPayload = {
    status: report.status,
    at: report.at,
    providerId: report.emailId,
    svixId,
    ...(report.reason ? { reason: report.reason } : {}),
    ...(report.link ? { link: report.link } : {}),
    ...(markedDoNotEmail ? { markedDoNotEmail: true } : {}),
  };
  // One statement, so two deliveries of the same message can't both insert.
  const inserted = await db.execute(sql`
    insert into ${events} (workspace_id, actor_id, verb, subject_type, subject_id, payload)
    select ${sent.workspaceId}::uuid, 'resend', 'deal.email_status', 'deal', ${sent.dealId}, ${JSON.stringify(eventPayload)}::jsonb
    where not exists (select 1 from ${events} where verb = 'deal.email_status' and payload->>'svixId' = ${svixId})
    returning id`);
  return Response.json({ recorded: inserted.rows.length > 0, status: report.status });
}
