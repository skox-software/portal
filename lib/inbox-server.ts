import { isOptOutReply } from "@/lib/reply-opt-out";
import { sendColdOutreach, suppressOutreach } from "@/lib/cold-outreach";
import { outreachSender } from "@/lib/lead-email";
import { previewSentQueries } from "@/lib/preview-open";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { Resend } from "resend";
import { getDb } from "@/lib/db";
import { deals, emailMessages, emailThreads, memberships, workspaces } from "@/lib/db/schema";
import {
  bareMessageId,
  counterpartOf,
  matchOwner,
  messageIds,
  parseAddress,
  parseAddresses,
  replySubject,
  subjectKey,
  type Address,
  type KnownContact,
} from "@/lib/inbox";
import { putPrivate } from "@/lib/storage";
import { promotionWrites } from "@/lib/promotion-server";
import { trackOf } from "@/lib/pipeline";
import { staffOf, staffRow } from "@/lib/staff-filter";

/** The address the Workspace routing rule copies mail to; never a counterpart. */
export function inboxCopyAddress() {
  return (process.env.INBOX_COPY_ADDRESS ?? "").trim().toLowerCase() || null;
}

async function staffEmails(workspaceId: string) {
  const rows = await getDb()
    .select({ email: memberships.email })
    .from(memberships)
    .where(staffOf(workspaceId));
  return rows.map((r) => r.email.toLowerCase());
}

/** Our own domains, old and new: mail from either is internal, never a lead conversation. */
const TEAM_DOMAINS = ["gounbusy.com", "skoxsoftware.com"];

/** Staff addresses, plus anyone else at their (non-free) domains or ours, e.g. founders@gounbusy.com. */
function staffMatcher(staff: string[]) {
  const domains = new Set([...TEAM_DOMAINS, ...staff.map((e) => e.split("@")[1]).filter((d) => d && !/gmail|outlook|yahoo|icloud|hotmail/.test(d))]);
  return (email: string) => staff.includes(email) || domains.has(email.split("@")[1]);
}

/** Every address the portal already knows, and who it belongs to. */
export async function knownContacts(workspaceId: string): Promise<KnownContact[]> {
  const db = getDb();
  const [people, dealRows, threads] = await Promise.all([
    db
      .select({ email: memberships.email, clientId: memberships.clientId })
      .from(memberships)
      .where(eq(memberships.workspaceId, workspaceId)),
    db
      .select({ email: deals.contactEmail, id: deals.id, clientId: deals.clientId })
      .from(deals)
      .where(eq(deals.workspaceId, workspaceId)),
    db
      .select({ email: emailThreads.counterpartEmail, clientId: emailThreads.clientId, dealId: emailThreads.dealId })
      .from(emailThreads)
      .where(eq(emailThreads.workspaceId, workspaceId))
      .orderBy(desc(emailThreads.lastMessageAt)),
  ]);
  return [
    // Threads someone already assigned teach the Inbox new addresses.
    ...threads.filter((t) => t.clientId || t.dealId).map((t) => ({ email: t.email, clientId: t.clientId, dealId: t.dealId })),
    ...people.filter((p) => p.clientId).map((p) => ({ email: p.email, clientId: p.clientId, dealId: null })),
    ...dealRows.filter((d) => d.email).map((d) => ({ email: d.email!, clientId: d.clientId, dealId: d.id })),
  ];
}

export type IncomingEmail = {
  workspaceId: string;
  providerId: string | null;
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  text: string;
  messageId: string | null;
  inReplyTo: string | null;
  references: string | null;
  sentAt: Date;
  attachments: { name: string; contentType: string; bytes: Uint8Array }[];
};

/**
 * Files one email into the Inbox: finds its thread (reply headers first, then
 * the same person and subject within 45 days), creates one if needed, and
 * assigns new threads to a client or deal when the address is known.
 */
export async function ingestEmail(mail: IncomingEmail) {
  const db = getDb();
  const from = parseAddress(mail.from);
  if (!from) return { skipped: "no sender" as const };
  const recipients = [...parseAddresses(mail.to), ...parseAddresses(mail.cc)];
  const staff = await staffEmails(mail.workspaceId);
  const copy = inboxCopyAddress();
  const side = counterpartOf(from, recipients, staffMatcher(staff), copy ? [copy] : []);
  if (!side) return { skipped: "internal" as const };

  // Persist before deduplication/storage: retries repair a partial failure and
  // quoted copies of our footer cannot suppress an interested prospect.
  const optOut = side.direction === "inbound" && isOptOutReply(mail.subject, mail.text);
  if (optOut) {
    await suppressOutreach(from.email);
  }

  const messageId = bareMessageId(mail.messageId);
  if (mail.providerId) {
    const [seen] = await db.select({ id: emailMessages.id }).from(emailMessages).where(eq(emailMessages.providerId, mail.providerId)).limit(1);
    if (seen) return { skipped: "duplicate" as const };
  }
  if (messageId) {
    const [seen] = await db
      .select({ id: emailMessages.id })
      .from(emailMessages)
      .where(and(eq(emailMessages.workspaceId, mail.workspaceId), eq(emailMessages.messageId, messageId)))
      .limit(1);
    if (seen) return { skipped: "duplicate" as const };
  }

  const threadId = await findOrCreateThread(mail, side.counterpart, from);
  // A reply sent from the portal comes back through the mailbox copy rule. If
  // the provider rewrote its Message-ID, match it on sender, subject and time.
  if (side.direction === "outbound") {
    const recent = await db
      .select({ subject: emailMessages.subject, text: emailMessages.text })
      .from(emailMessages)
      .where(
        and(
          eq(emailMessages.threadId, threadId),
          eq(emailMessages.direction, "outbound"),
          eq(emailMessages.fromEmail, from.email),
          gte(emailMessages.sentAt, new Date(mail.sentAt.getTime() - 15 * 60_000)),
        ),
      );
    const head = (t: string) => t.replace(/\s+/g, " ").trim().slice(0, 160);
    if (recent.some((m) => subjectKey(m.subject) === subjectKey(mail.subject) && head(mail.text).startsWith(head(m.text).slice(0, 80)))) {
      return { skipped: "duplicate" as const };
    }
  }
  const id = crypto.randomUUID();
  const attachments = [];
  for (const file of mail.attachments.slice(0, 20)) {
    const safe = file.name.replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "attachment";
    let storageKey: string | null = null;
    try {
      storageKey = (await putPrivate(`inbox/${threadId}/${id}/${safe}`, file.bytes, file.contentType)).pathname;
    } catch (error) {
      console.error("[inbox] attachment upload failed", { name: file.name, error });
    }
    attachments.push({ name: file.name, size: file.bytes.byteLength, contentType: file.contentType, storageKey });
  }

  const inbound = side.direction === "inbound";
  await db.batch([
    db.insert(emailMessages).values({
      id,
      workspaceId: mail.workspaceId,
      threadId,
      direction: side.direction,
      fromEmail: from.email,
      fromName: from.name,
      to: parseAddresses(mail.to).map((a) => a.email),
      cc: parseAddresses(mail.cc).map((a) => a.email),
      subject: mail.subject || "(no subject)",
      text: mail.text.slice(0, 200_000),
      messageId,
      inReplyTo: bareMessageId(mail.inReplyTo),
      references: mail.references,
      providerId: mail.providerId,
      attachments,
      sentAt: mail.sentAt,
    }),
    db
      .update(emailThreads)
      .set({
        lastMessageAt: mail.sentAt,
        ...(inbound ? { lastInboundAt: mail.sentAt, archivedAt: null } : {}),
        ...(side.counterpart.name ? { counterpartName: side.counterpart.name } : {}),
      })
      .where(eq(emailThreads.id, threadId)),
  ]);
  // A reply is the clearest signal there is: a lead still in Outreach becomes a Pipeline deal.
  // A "stop emailing me" reply isn't interest, and neither is anything after an opt-out.
  if (inbound && !optOut) await promoteOnReply(threadId, id).catch((error) => console.error("[inbox] reply promotion failed", error));
  return { threadId, messageId: id };
}

async function promoteOnReply(threadId: string, messageId: string) {
  const db = getDb();
  const [row] = await db
    .select({ deal: deals })
    .from(emailThreads)
    .innerJoin(deals, eq(deals.id, emailThreads.dealId))
    .where(eq(emailThreads.id, threadId))
    .limit(1);
  const deal = row?.deal;
  if (!deal || deal.doNotEmail || trackOf(deal.stage) !== "outreach") return;
  const { writes } = promotionWrites(deal, "replied", "inbox", new Date(), { via: "email", threadId, messageId });
  if (writes.length) await db.batch([writes[0], ...writes.slice(1)]);
}

async function findOrCreateThread(mail: IncomingEmail, counterpart: Address, from: Address) {
  const db = getDb();
  const ids = [...messageIds(mail.references), ...messageIds(mail.inReplyTo), bareMessageId(mail.inReplyTo)].filter(
    (v): v is string => !!v,
  );
  if (ids.length) {
    const [hit] = await db
      .select({ threadId: emailMessages.threadId })
      .from(emailMessages)
      .where(and(eq(emailMessages.workspaceId, mail.workspaceId), inArray(emailMessages.messageId, [...new Set(ids)])))
      .limit(1);
    if (hit) return hit.threadId;
  }

  const since = new Date(mail.sentAt.getTime() - 45 * 86_400_000);
  const recent = await db
    .select({ id: emailThreads.id, subject: emailThreads.subject })
    .from(emailThreads)
    .where(
      and(
        eq(emailThreads.workspaceId, mail.workspaceId),
        eq(emailThreads.counterpartEmail, counterpart.email),
        gte(emailThreads.lastMessageAt, since),
      ),
    )
    .orderBy(desc(emailThreads.lastMessageAt));
  const key = subjectKey(mail.subject);
  const same = recent.find((t) => subjectKey(t.subject) === key);
  if (same) return same.id;

  const owner = matchOwner(counterpart.email, await knownContacts(mail.workspaceId));
  const staffSide = from.email !== counterpart.email ? from.email : parseAddresses(mail.to)[0]?.email ?? null;
  const [thread] = await db
    .insert(emailThreads)
    .values({
      workspaceId: mail.workspaceId,
      // A forward keeps its "Fwd:"; only reply prefixes are dropped.
      subject: key ? mail.subject.replace(/^(\s*re\s*:\s*)+/i, "") || mail.subject : "(no subject)",
      counterpartEmail: counterpart.email,
      counterpartName: counterpart.name,
      mailbox: staffSide,
      clientId: owner?.clientId ?? null,
      dealId: owner?.dealId ?? null,
      lastMessageAt: mail.sentAt,
    })
    .returning({ id: emailThreads.id });
  return thread.id;
}

/** Which workspace a received email is for: the one whose staff it was sent to or from. */
export async function workspaceForAddresses(addresses: string[]) {
  const db = getDb();
  const emails = [...new Set(addresses.map((a) => parseAddress(a)?.email).filter((e): e is string => !!e))];
  if (emails.length) {
    const [hit] = await db
      .select({ workspaceId: memberships.workspaceId })
      .from(memberships)
      .where(and(inArray(memberships.email, emails), staffRow()))
      .limit(1);
    if (hit) return hit.workspaceId;
  }
  const slug = process.env.INBOX_WORKSPACE_SLUG;
  const [fallback] = slug
    ? await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.slug, slug)).limit(1)
    : await db.select({ id: workspaces.id }).from(workspaces).orderBy(workspaces.createdAt).limit(1);
  return fallback?.id ?? null;
}

let resend: Resend | null = null;

/**
 * Sends a reply from the staff member's own address, threaded onto the
 * conversation, and files it in the thread. In development it is filed but
 * not sent (as with every portal email) unless EMAIL_SEND_IN_DEV=1.
 */
export async function sendThreadReply({
  threadId,
  workspaceId,
  subject,
  body,
  sender,
}: {
  threadId: string;
  workspaceId: string;
  subject: string;
  body: string;
  sender: { userId: string; email: string; name: string | null };
}) {
  const db = getDb();
  const [thread] = await db
    .select()
    .from(emailThreads)
    .where(and(eq(emailThreads.id, threadId), eq(emailThreads.workspaceId, workspaceId)))
    .limit(1);
  if (!thread) return { ok: false as const, error: "That conversation doesn't exist." };
  const history = await db
    .select({ messageId: emailMessages.messageId })
    .from(emailMessages)
    .where(eq(emailMessages.threadId, thread.id))
    .orderBy(emailMessages.sentAt);
  const chain = history.map((m) => m.messageId).filter((m): m is string => !!m);
  const last = chain.at(-1) ?? null;
  const domain = sender.email.split("@")[1] || "skoxsoftware.com";
  const messageId = `${crypto.randomUUID()}@${domain}`;
  const finalSubject = subject.trim() || replySubject(thread.subject);
  const displayName = sender.name || sender.email.split("@")[0].replace(/^./, (c) => c.toUpperCase());

  const key = process.env.RESEND_API_KEY;
  const live = process.env.NODE_ENV === "production" || process.env.EMAIL_SEND_IN_DEV === "1";
  let providerId: string | null = null;
  if (thread.dealId || !thread.clientId) {
    try {
      const result = await sendColdOutreach({ to: thread.counterpartEmail, subject: finalSubject, body, idempotencyKey: `outreach-reply/${messageId}`, sender: outreachSender(sender.email) });
      if (result.error || !result.data?.id) return { ok: false as const, error: "Outreach was not accepted by the provider." };
      providerId = `sent:${result.data.id}`;
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : "Cold outreach is blocked." };
    }
  } else if (key && live) {
    resend ??= new Resend(key);
    const { data, error } = await resend.emails.send({
      from: `${displayName} <${sender.email}>`,
      to: thread.counterpartEmail,
      // A copy lands in the sender's own mailbox, so the conversation reads
      // the same in Gmail when the client replies there.
      bcc: sender.email,
      replyTo: sender.email,
      subject: finalSubject,
      text: body,
      headers: {
        "Message-ID": `<${messageId}>`,
        ...(last ? { "In-Reply-To": `<${last}>`, References: chain.slice(-10).map((m) => `<${m}>`).join(" ") } : {}),
      },
    });
    if (error) {
      console.error("[inbox] reply failed", { threadId, error });
      return { ok: false as const, error: "The email couldn't be sent. Try again in a minute." };
    }
    providerId = data?.id ? `sent:${data.id}` : null;
  } else {
    console.info("[inbox] (reply not sent in development)", { to: thread.counterpartEmail, subject: finalSubject });
  }

  const now = new Date();
  await db.batch([
    db.insert(emailMessages).values({
      workspaceId,
      threadId: thread.id,
      direction: "outbound",
      fromEmail: sender.email,
      fromName: displayName,
      to: [thread.counterpartEmail],
      subject: finalSubject,
      text: body,
      messageId,
      inReplyTo: last,
      references: chain.length ? chain.slice(-10).map((m) => `<${m}>`).join(" ") : null,
      providerId,
      sentBy: sender.userId,
      sentAt: now,
    }),
    db.update(emailThreads).set({ lastMessageAt: now, readAt: now }).where(eq(emailThreads.id, thread.id)),
  ]);
  // A reply carrying the lead's preview link sends the preview: from here, its views count.
  if (providerId && thread.dealId) {
    const [deal] = await db.select().from(deals).where(eq(deals.id, thread.dealId)).limit(1);
    if (deal) for (const q of previewSentQueries(deal, body, sender.userId, now)) await q.catch((e) => console.error("[preview] mark sent failed", e));
  }
  return { ok: true as const, sent: !!providerId };
}
