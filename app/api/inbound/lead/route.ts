import { timingSafeEqual } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { deals } from "@/lib/db/schema";
import { eventInsert } from "@/lib/events";
import { FIRST_STAGE, OPEN_STAGES, trackOf } from "@/lib/pipeline";
import {
  attributionFor,
  companyFor,
  dealKind,
  inboundLeadSchema,
  leadSourceLabel,
  notesFor,
} from "@/lib/inbound-lead";
import { workspaceForAddresses } from "@/lib/inbox-server";
import { normalizeEmail } from "@/lib/permissions";

/**
 * Enquiries from skoxsoftware.com land here as Pipeline deals, in Lead.
 * The site sends every finished enquiry and every unfinished one (an address
 * typed, then the page left), with LEADS_INGEST_SECRET as a bearer token.
 *
 * One open website deal per address: an unfinished enquiry followed by the
 * real one becomes a single card, upgraded in place. A second real enquiry
 * from someone already in the pipeline is added to that card's notes.
 */

const ACTOR = "website";
const OPEN = OPEN_STAGES;

function authorised(request: Request): boolean {
  const secret = process.env.LEADS_INGEST_SECRET;
  if (!secret) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function POST(request: Request) {
  if (!process.env.LEADS_INGEST_SECRET) return new Response("Lead intake not configured", { status: 503 });
  if (!authorised(request)) return new Response("Unauthorised", { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }
  const parsed = inboundLeadSchema.safeParse(body);
  if (!parsed.success) return Response.json({ ok: false, error: "invalid" }, { status: 422 });
  const lead = { ...parsed.data, email: normalizeEmail(parsed.data.email) };

  const workspaceId = await workspaceForAddresses([]);
  if (!workspaceId) return new Response("No workspace", { status: 503 });

  const db = getDb();
  const now = new Date();
  const [existing] = await db
    .select()
    .from(deals)
    .where(
      and(
        eq(deals.workspaceId, workspaceId),
        sql`lower(${deals.contactEmail}) = ${lead.email}`,
        inArray(deals.stage, [...OPEN]),
      ),
    )
    .orderBy(desc(deals.createdAt))
    .limit(1);

  if (existing) {
    const wasUnfinished = existing.source === "website" && existing.leadSource?.startsWith("Unfinished");
    // Nothing new: they started the form again but didn't send it.
    if (lead.status === "unfinished") return Response.json({ ok: true, deal: existing.id, updated: false });

    const fresh = notesFor(lead, now);
    // They wrote to us: that's interest, so a lead still in Outreach is promoted to the Pipeline.
    const promote = trackOf(existing.stage) === "outreach";
    await db.batch([
      db
        .update(deals)
        .set({
          ...(wasUnfinished
            ? {
                // The real enquiry replaces the half-finished one.
                company: companyFor(lead),
                contactName: lead.name || existing.contactName,
                kind: dealKind(lead.projectType),
                leadSource: leadSourceLabel(lead),
                notes: fresh,
                attribution: attributionFor(lead),
              }
            : { notes: `${fresh}\n\n— Earlier —\n${existing.notes ?? ""}`.slice(0, 4000) }),
          ...(promote ? { stage: "replied" as const, promotedAt: now, promotedSignal: "inbound", closeReason: null, closeDetail: null } : {}),
          gclid: existing.gclid ?? lead.gclid ?? null,
          industry: existing.industry ?? lead.industry ?? null,
          location: existing.location ?? lead.location ?? null,
          website: existing.website ?? (lead.website ? `https://${lead.website}/` : null),
          stageChangedAt: now,
        })
        .where(eq(deals.id, existing.id)),
      eventInsert({
        workspaceId,
        actorId: ACTOR,
        verb: "deal.updated",
        subjectType: "deal",
        subjectId: existing.id,
        payload: { company: existing.company, via: "website", enquiry: wasUnfinished ? "completed" : "repeat" },
      }),
      ...(promote
        ? [eventInsert({ workspaceId, actorId: ACTOR, verb: "deal.promoted", subjectType: "deal", subjectId: existing.id, payload: { company: existing.company, from: existing.stage, to: "replied", signal: "inbound", via: "website" } })]
        : []),
    ]);
    return Response.json({ ok: true, deal: existing.id, updated: true });
  }

  const id = crypto.randomUUID();
  await db.batch([
    db.insert(deals).values({
      id,
      workspaceId,
      company: companyFor(lead),
      contactName: lead.name || null,
      contactEmail: lead.email,
      website: lead.website ? `https://${lead.website}/` : null,
      kind: dealKind(lead.projectType),
      // A sent enquiry is someone reaching out: a Pipeline deal. A half-filled form is only a lead to try.
      stage: lead.status === "unfinished" ? FIRST_STAGE : "replied",
      ...(lead.status === "unfinished" ? {} : { promotedAt: now, promotedSignal: "inbound" }),
      source: "website",
      leadSource: leadSourceLabel(lead),
      industry: lead.industry ?? null,
      location: lead.location ?? null,
      notes: notesFor(lead, now),
      gclid: lead.gclid ?? null,
      attribution: attributionFor(lead),
      createdBy: ACTOR,
    }),
    eventInsert({
      workspaceId,
      actorId: ACTOR,
      verb: "deal.created",
      subjectType: "deal",
      subjectId: id,
      payload: { company: companyFor(lead), from: "website", status: lead.status },
    }),
  ]);
  return Response.json({ ok: true, deal: id, created: true });
}
