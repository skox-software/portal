import { Resend } from "resend";
import { ingestEmail, workspaceForAddresses } from "@/lib/inbox-server";

/**
 * Resend calls this when mail arrives at the Inbox's receiving address (the
 * Workspace routing rule copies the team's mail there). The event only names
 * the email, so the body, headers and attachments are fetched with the API.
 * Signed with RESEND_WEBHOOK_SECRET; anything unsigned is refused.
 */

const MAX_ATTACHMENT = 15 * 1024 * 1024;

function header(headers: Record<string, string> | null | undefined, name: string) {
  if (!headers) return null;
  const hit = Object.entries(headers).find(([k]) => k.toLowerCase() === name);
  return hit?.[1] ?? null;
}

export async function POST(request: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  const key = process.env.RESEND_INBOUND_API_KEY ?? process.env.RESEND_API_KEY;
  if (!secret || !key) return new Response("Inbox not configured", { status: 503 });

  const payload = await request.text();
  const resend = new Resend(key);
  let event;
  try {
    event = resend.webhooks.verify({
      payload,
      headers: {
        id: request.headers.get("svix-id") ?? "",
        timestamp: request.headers.get("svix-timestamp") ?? "",
        signature: request.headers.get("svix-signature") ?? "",
      },
      webhookSecret: secret,
    });
  } catch {
    return new Response("Bad signature", { status: 401 });
  }
  if (event.type !== "email.received") return Response.json({ ignored: event.type });

  const { data: email, error } = await resend.emails.receiving.get(event.data.email_id);
  if (error || !email) {
    console.error("[inbox] could not fetch received email", { id: event.data.email_id, error });
    // A 5xx makes Resend retry later.
    return new Response("Could not fetch email", { status: 502 });
  }

  const workspaceId = await workspaceForAddresses([email.from, ...email.to, ...(email.cc ?? [])]);
  if (!workspaceId) return Response.json({ ignored: "no workspace" });

  const attachments: { name: string; contentType: string; bytes: Uint8Array }[] = [];
  for (const file of email.attachments ?? []) {
    if (file.content_disposition === "inline" && file.content_id) continue;
    if (file.size > MAX_ATTACHMENT) continue;
    const { data: meta } = await resend.emails.receiving.attachments.get({ emailId: email.id, id: file.id });
    if (!meta?.download_url) continue;
    const res = await fetch(meta.download_url);
    if (!res.ok) continue;
    attachments.push({
      name: file.filename ?? "attachment",
      contentType: file.content_type || "application/octet-stream",
      bytes: new Uint8Array(await res.arrayBuffer()),
    });
  }

  const text = email.text ?? (email.html ? email.html.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">") : "");
  const date = header(email.headers, "date");
  const result = await ingestEmail({
    workspaceId,
    providerId: email.id,
    from: email.from,
    to: email.to,
    cc: email.cc ?? [],
    subject: email.subject ?? "",
    text,
    messageId: email.message_id ?? header(email.headers, "message-id"),
    inReplyTo: header(email.headers, "in-reply-to"),
    references: header(email.headers, "references"),
    sentAt: date && !Number.isNaN(Date.parse(date)) ? new Date(date) : new Date(email.created_at),
    attachments,
  });
  return Response.json(result);
}
