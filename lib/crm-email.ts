import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { Resend } from "resend";
import {
  domainOf,
  headerValue,
  newMessageId,
  normalizeSubject,
  parseAddress,
  parseMessageIds,
  snippetOf,
} from "@/lib/crm";
import { getDb } from "@/lib/db";
import {
  contacts,
  crmActivities,
  deals,
  emailAttachments,
  emailMessages,
  emailThreads,
  workspaces,
} from "@/lib/db/schema";
import { escapeHtml } from "@/lib/email";
import { putPrivate } from "@/lib/storage";

/*
 * CRM email. Outbound goes through Resend as CRM_FROM_EMAIL. Inbound does not
 * use an MX record: Google Workspace forwards a copy of the mailbox to a
 * Resend receiving address, Resend fires `email.received`, and
 * app/api/webhooks/resend calls ingestReceivedEmail() here.
 */

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

let client: Resend | null = null;
function resend() {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is not set");
  client ??= new Resend(key);
  return client;
}

/** "Reiss at SKOX <reiss@skoxsoftware.com>" — the From line for CRM mail. */
export function crmFrom() {
  const from = process.env.CRM_FROM_EMAIL;
  if (!from) throw new Error("CRM_FROM_EMAIL is not set");
  return from;
}

/**
 * Addresses whose mail is ours. Google forwards everything in the mailbox,
 * including what the portal itself sent (CRM replies and staff notifications),
 * and none of that belongs in the inbox.
 */
function ownAddresses() {
  return new Set(
    [process.env.CRM_FROM_EMAIL, process.env.EMAIL_FROM ?? "portal@skoxsoftware.com"]
      .filter((v): v is string => Boolean(v))
      .map((v) => parseAddress(v).email),
  );
}

/** SKOX is one workspace. CRM_WORKSPACE_SLUG picks it if there are ever more. */
async function inboundWorkspaceId() {
  const db = getDb();
  const slug = process.env.CRM_WORKSPACE_SLUG;
  const rows = slug
    ? await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.slug, slug)).limit(1)
    : await db.select({ id: workspaces.id }).from(workspaces).limit(2);
  if (rows.length !== 1) {
    throw new Error(slug ? `No workspace with slug ${slug}` : "Set CRM_WORKSPACE_SLUG: more than one workspace exists");
  }
  return rows[0].id;
}

type Received = {
  id: string;
  from: string;
  subject: string;
  text: string | null;
  html: string | null;
  headers: Record<string, string> | null;
  message_id: string;
  to: string[];
  cc: string[] | null;
  attachments: { id: string }[];
};

/**
 * Which thread an inbound message belongs to, most certain first:
 * 1. In-Reply-To / References naming a message we hold.
 * 2. Sender is a known contact (or an unassigned thread's sender) and the
 *    subject matches an open thread.
 * 3. Sender is a known contact: new thread on that client.
 * 4. Nothing matches: new unassigned thread, triaged in the inbox.
 */
async function resolveThread(workspaceId: string, email: Received, sender: { email: string; name: string | null }) {
  const db = getDb();
  const referenced = [
    ...parseMessageIds(headerValue(email.headers, "in-reply-to")),
    ...parseMessageIds(headerValue(email.headers, "references")),
  ];
  if (referenced.length > 0) {
    const [hit] = await db
      .select({ threadId: emailMessages.threadId })
      .from(emailMessages)
      .where(and(eq(emailMessages.workspaceId, workspaceId), inArray(emailMessages.rfcMessageId, referenced)))
      .limit(1);
    if (hit) return hit.threadId;
  }

  const subject = normalizeSubject(email.subject);
  const [contact] = await db
    .select({ clientId: contacts.clientId })
    .from(contacts)
    .where(and(eq(contacts.workspaceId, workspaceId), eq(contacts.email, sender.email)))
    .limit(1);

  const open = await db
    .select({ id: emailThreads.id, subject: emailThreads.subject })
    .from(emailThreads)
    .where(
      and(
        eq(emailThreads.workspaceId, workspaceId),
        eq(emailThreads.archived, false),
        contact
          ? eq(emailThreads.clientId, contact.clientId)
          : and(isNull(emailThreads.clientId), eq(emailThreads.counterpartEmail, sender.email)),
      ),
    )
    .orderBy(desc(emailThreads.lastMessageAt))
    .limit(25);
  const match = subject ? open.find((t) => normalizeSubject(t.subject) === subject) : undefined;
  if (match) return match.id;

  let dealId: string | null = null;
  if (contact) {
    const [deal] = await db
      .select({ id: deals.id })
      .from(deals)
      .where(and(eq(deals.clientId, contact.clientId), inArray(deals.stage, ["lead", "proposal_sent", "negotiation", "won", "in_build"])))
      .orderBy(desc(deals.createdAt))
      .limit(1);
    dealId = deal?.id ?? null;
  }

  const [created] = await db
    .insert(emailThreads)
    .values({
      workspaceId,
      clientId: contact?.clientId ?? null,
      dealId,
      subject: email.subject || "(no subject)",
      counterpartEmail: sender.email,
      counterpartName: sender.name,
    })
    .returning({ id: emailThreads.id });
  return created.id;
}

async function mirrorAttachments(workspaceId: string, messageId: string, emailId: string) {
  const db = getDb();
  const { data, error } = await resend().emails.receiving.attachments.list({ emailId });
  if (error) throw new Error(`Resend attachments: ${error.message}`);

  for (const attachment of data?.data ?? []) {
    const name = attachment.filename || "attachment";
    let storageKey: string | null = null;
    if (attachment.size <= MAX_ATTACHMENT_BYTES) {
      try {
        const res = await fetch(attachment.download_url);
        if (res.ok) {
          const bytes = new Uint8Array(await res.arrayBuffer());
          const safe = name.replace(/[^\w.-]+/g, "_").slice(0, 120);
          const blob = await putPrivate(`crm/email/${messageId}/${safe}`, bytes, attachment.content_type || "application/octet-stream");
          storageKey = blob.pathname;
        }
      } catch (err) {
        // The row is still written, so the inbox shows the file existed.
        console.error("[crm-email] attachment copy failed", { messageId, name, err });
      }
    }
    await db.insert(emailAttachments).values({
      workspaceId,
      messageId,
      name,
      contentType: attachment.content_type,
      sizeBytes: attachment.size,
      storageKey,
    });
  }
}

export type IngestOutcome = "stored" | "duplicate" | "own-mail";

/** Fetches a received email from Resend and files it. Safe to call twice for one id. */
export async function ingestReceivedEmail(emailId: string): Promise<IngestOutcome> {
  const db = getDb();
  const [existing] = await db.select({ id: emailMessages.id }).from(emailMessages).where(eq(emailMessages.resendId, emailId)).limit(1);
  if (existing) return "duplicate";

  // The webhook carries metadata only; the body and headers come from here.
  const { data: email, error } = await resend().emails.receiving.get(emailId);
  if (error || !email) throw new Error(`Resend receiving.get: ${error?.message ?? "no data"}`);

  const sender = parseAddress(email.from);
  if (ownAddresses().has(sender.email)) return "own-mail";

  const workspaceId = await inboundWorkspaceId();
  const threadId = await resolveThread(workspaceId, email, sender);
  const messageId = crypto.randomUUID();
  const receivedAt = new Date(email.created_at);

  const inserted = await db
    .insert(emailMessages)
    .values({
      id: messageId,
      workspaceId,
      threadId,
      direction: "inbound",
      resendId: email.id,
      rfcMessageId: email.message_id || null,
      inReplyTo: headerValue(email.headers, "in-reply-to"),
      references: parseMessageIds(headerValue(email.headers, "references")),
      fromEmail: sender.email,
      fromName: sender.name,
      toEmails: (email.to ?? []).map((a) => parseAddress(a).email),
      ccEmails: (email.cc ?? []).map((a) => parseAddress(a).email),
      subject: email.subject,
      textBody: email.text,
      htmlBody: email.html,
      snippet: snippetOf(email.text, email.html),
      createdAt: Number.isNaN(receivedAt.getTime()) ? new Date() : receivedAt,
    })
    .onConflictDoNothing({ target: emailMessages.resendId })
    .returning({ id: emailMessages.id });
  // A concurrent delivery of the same email got there first.
  if (inserted.length === 0) return "duplicate";

  const [thread] = await db
    .update(emailThreads)
    .set({ lastMessageAt: new Date(), unread: true, archived: false })
    .where(eq(emailThreads.id, threadId))
    .returning({ clientId: emailThreads.clientId, dealId: emailThreads.dealId });

  if (thread?.clientId) {
    await db.insert(crmActivities).values({
      workspaceId,
      clientId: thread.clientId,
      dealId: thread.dealId,
      type: "email",
      body: email.subject,
      meta: { direction: "inbound", threadId, messageId, from: sender.email },
    });
  }

  if ((email.attachments ?? []).length > 0) await mirrorAttachments(workspaceId, messageId, email.id);
  return "stored";
}

/** Verifies a Resend (Svix) webhook against the raw body. Throws when it doesn't check out. */
export function verifyResendWebhook(rawBody: string, headers: Headers) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) throw new Error("RESEND_WEBHOOK_SECRET is not set");
  return new Resend("re_unused").webhooks.verify({
    payload: rawBody,
    headers: {
      id: headers.get("svix-id") ?? "",
      timestamp: headers.get("svix-timestamp") ?? "",
      signature: headers.get("svix-signature") ?? "",
    },
    webhookSecret: secret,
  });
}

function toHtml(body: string) {
  return body
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px;font:400 15px/1.55 -apple-system,'Segoe UI',Helvetica,Arial,sans-serif;white-space:pre-line">${escapeHtml(p)}</p>`)
    .join("");
}

/**
 * Sends one CRM email and records it on the thread. Sets its own Message-ID
 * and In-Reply-To / References, so the client's mail app threads it and their
 * reply comes back to this thread. In development it records without sending
 * unless EMAIL_SEND_IN_DEV=1, the same rule as lib/email.ts.
 */
export async function sendThreadEmail(opts: {
  workspaceId: string;
  threadId: string;
  to: string;
  subject: string;
  body: string;
  sentBy: string;
}) {
  const db = getDb();
  const from = crmFrom();
  const fromAddress = parseAddress(from);

  const history = await db
    .select({ rfcMessageId: emailMessages.rfcMessageId, references: emailMessages.references })
    .from(emailMessages)
    .where(eq(emailMessages.threadId, opts.threadId))
    .orderBy(desc(emailMessages.createdAt))
    .limit(1);
  const last = history[0];
  const inReplyTo = last?.rfcMessageId ?? null;
  const references = [...new Set([...(last?.references ?? []), ...(inReplyTo ? [inReplyTo] : [])])].slice(-20);
  let rfcMessageId = newMessageId(domainOf(fromAddress.email));

  const headers: Record<string, string> = { "Message-ID": rfcMessageId };
  if (inReplyTo) headers["In-Reply-To"] = inReplyTo;
  if (references.length) headers["References"] = references.join(" ");

  let resendId: string | null = null;
  const live = process.env.NODE_ENV === "production" || process.env.EMAIL_SEND_IN_DEV === "1";
  if (live) {
    const { data, error } = await resend().emails.send({
      from,
      to: opts.to,
      replyTo: fromAddress.email,
      subject: opts.subject,
      text: opts.body,
      html: toHtml(opts.body),
      headers,
    });
    if (error || !data) throw new Error(error?.message ?? "Resend did not accept the email");
    resendId = data.id;
    // If Resend replaced our Message-ID, store the one the client will actually reply to.
    const sent = await resend().emails.get(data.id);
    if (sent.data?.message_id) {
      const id = sent.data.message_id.trim();
      rfcMessageId = id.startsWith("<") ? id : `<${id}>`;
    }
  } else {
    console.info("[crm-email] (not sent)", { to: opts.to, subject: opts.subject });
  }

  const messageId = crypto.randomUUID();
  await db.batch([
    db.insert(emailMessages).values({
      id: messageId,
      workspaceId: opts.workspaceId,
      threadId: opts.threadId,
      direction: "outbound",
      resendId,
      rfcMessageId,
      inReplyTo,
      references,
      fromEmail: fromAddress.email,
      fromName: fromAddress.name,
      toEmails: [parseAddress(opts.to).email],
      subject: opts.subject,
      textBody: opts.body,
      snippet: snippetOf(opts.body, null),
      sentBy: opts.sentBy,
    }),
    db.update(emailThreads).set({ lastMessageAt: new Date(), unread: false }).where(eq(emailThreads.id, opts.threadId)),
  ]);
  return { messageId, sent: live };
}
