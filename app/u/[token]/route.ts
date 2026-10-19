import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { outreachRecipients } from "@/lib/db/schema";
import { suppressOutreach } from "@/lib/cold-outreach";
import { tokenDealId, verifyUnsubscribeToken } from "@/lib/unsubscribe";

export const dynamic = "force-dynamic";

async function optOut(token: string) {
  const secret = process.env.UNSUBSCRIBE_SECRET ?? "";
  const id = tokenDealId(token);
  if (!id || !secret) return false;
  const [recipient] = await getDb().select().from(outreachRecipients).where(eq(outreachRecipients.id, id)).limit(1);
  if (!recipient || !verifyUnsubscribeToken(token, [recipient.email], secret)) return false;
  await suppressOutreach(recipient.email);
  return true;
}

function page(title: string, message: string, status: number) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title></head>`
    + `<body style="font-family:Arial,sans-serif;max-width:520px;margin:64px auto;padding:0 20px;color:#202124;line-height:1.5"><h1 style="font-size:22px">${title}</h1><p>${message}</p><p style="color:#80868b;font-size:13px">SKOX Software</p></body></html>`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (await optOut(token))
    ? page("You're unsubscribed", "You won't receive further marketing emails from SKOX Software. Sorry for the interruption.", 200)
    : page("Link not recognised", "This unsubscribe link didn't work. Reply to our email with “no thanks” and we'll take you off our list.", 404);
}

export async function POST(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (await optOut(token)) ? new Response("Unsubscribed", { status: 200 }) : new Response("Not found", { status: 404 });
}
