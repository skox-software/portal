import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { deals, emailThreads } from "@/lib/db/schema";
import { eventInsert } from "@/lib/events";
import { tokenDealId, verifyUnsubscribeToken } from "@/lib/unsubscribe";

/**
 * The opt-out link in every cold email, public (no sign-in). Opening it opts
 * out at once, and mail apps' one-click unsubscribe (RFC 8058) POSTs here.
 * Erring toward opting out is safe: a link scanner that opens it only stops
 * email we were not owed a reply to.
 */

export const dynamic = "force-dynamic";

async function optOut(token: string, via: "link" | "one-click") {
  const secret = process.env.UNSUBSCRIBE_SECRET ?? "";
  const dealId = tokenDealId(token);
  if (!dealId || !secret) return false;
  const db = getDb();
  const [deal] = await db.select({ id: deals.id, workspaceId: deals.workspaceId, contactEmail: deals.contactEmail, doNotEmail: deals.doNotEmail }).from(deals).where(eq(deals.id, dealId)).limit(1);
  if (!deal) return false;
  // The contact may have changed since we wrote; the addresses actually emailed still count.
  const threads = await db.select({ email: emailThreads.counterpartEmail }).from(emailThreads).where(and(eq(emailThreads.workspaceId, deal.workspaceId), eq(emailThreads.dealId, deal.id)));
  if (!verifyUnsubscribeToken(token, [deal.contactEmail, ...threads.map((t) => t.email)], secret)) return false;
  if (deal.doNotEmail) return true;
  const marked = await db.update(deals).set({ doNotEmail: true }).where(and(eq(deals.id, deal.id), eq(deals.doNotEmail, false))).returning({ id: deals.id });
  if (marked.length) await eventInsert({ workspaceId: deal.workspaceId, actorId: "recipient", verb: "deal.unsubscribed", subjectType: "deal", subjectId: deal.id, payload: { via } });
  return true;
}

function page(title: string, message: string, status: number) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title></head>`
    + `<body style="font-family:Arial,sans-serif;max-width:520px;margin:64px auto;padding:0 20px;color:#202124;line-height:1.5"><h1 style="font-size:22px">${title}</h1><p>${message}</p><p style="color:#80868b;font-size:13px">SKOX Software</p></body></html>`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (await optOut(token, "link"))
    ? page("You're unsubscribed", "We won't email you again. Sorry for the interruption.", 200)
    : page("Link not recognised", "This unsubscribe link didn't work. Reply to our email with “no thanks” and we'll take you off our list.", 404);
}

export async function POST(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (await optOut(token, "one-click")) ? new Response("Unsubscribed", { status: 200 }) : new Response("Not found", { status: 404 });
}
