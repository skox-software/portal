import { and, asc, desc, eq, inArray, isNull, lt, or } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { AssignThread, type AssignOption } from "@/components/AssignThread";
import { Notice, readMessage } from "@/components/Notice";
import { SubmitButton } from "@/components/SubmitButton";
import { requireStaff } from "@/lib/access";
import { getDb } from "@/lib/db";
import { clients, deals, emailMessages, emailThreads, type EmailThread } from "@/lib/db/schema";
import { nowMs } from "@/lib/format";
import { replySubject, snippet, stripQuoted } from "@/lib/inbox";
import { inboxCopyAddress } from "@/lib/inbox-server";
import { formatBytes } from "@/lib/storage";
import { archiveThread, sendReply } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Inbox" };

const stamp = (d: Date) =>
  `${d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" })} · ${d
    .toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })
    .toLowerCase()}`;

const compactAgo = (d: Date, now: Date) => {
  const mins = Math.max(0, Math.round((now.getTime() - d.getTime()) / 60_000));
  if (mins < 60) return `${Math.max(1, mins)}m`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h`;
  return `${Math.round(mins / 1440)}d`;
};

export default async function InboxPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const { viewer, staff } = await requireStaff();
  const ws = staff.workspaceId;
  const db = getDb();

  const [threads, clientRows, dealRows] = await Promise.all([
    db
      .select()
      .from(emailThreads)
      .where(and(eq(emailThreads.workspaceId, ws), isNull(emailThreads.archivedAt)))
      .orderBy(desc(emailThreads.lastMessageAt))
      .limit(200),
    db.select({ id: clients.id, name: clients.name }).from(clients).where(eq(clients.workspaceId, ws)).orderBy(asc(clients.name)),
    db
      .select({ id: deals.id, company: deals.company, projectId: deals.projectId, stage: deals.stage })
      .from(deals)
      .where(eq(deals.workspaceId, ws))
      .orderBy(asc(deals.company)),
  ]);

  const latest = threads.length
    ? await db
        .select({ threadId: emailMessages.threadId, text: emailMessages.text, direction: emailMessages.direction, sentAt: emailMessages.sentAt })
        .from(emailMessages)
        .where(inArray(emailMessages.threadId, threads.map((t) => t.id)))
        .orderBy(desc(emailMessages.sentAt))
    : [];
  const lastBy = new Map<string, (typeof latest)[number]>();
  for (const m of latest) if (!lastBy.has(m.threadId)) lastBy.set(m.threadId, m);

  const clientName = new Map(clientRows.map((c) => [c.id, c.name]));
  const dealName = new Map(dealRows.map((d) => [d.id, d.company]));
  const labelOf = (t: EmailThread) => (t.clientId ? clientName.get(t.clientId) : null) ?? (t.dealId ? dealName.get(t.dealId) : null) ?? null;
  const clientOptions: AssignOption[] = clientRows.map((c) => ({ value: `client:${c.id}`, label: c.name }));
  // Deals that became projects are covered by their client.
  const dealOptions: AssignOption[] = dealRows.filter((d) => !d.projectId && d.stage !== "lost").map((d) => ({ value: `deal:${d.id}`, label: d.company }));

  const unassigned = threads.filter((t) => !t.clientId && !t.dealId);
  const assigned = threads.filter((t) => t.clientId || t.dealId);
  const selectedId = typeof sp.thread === "string" ? sp.thread : null;
  const chosen = threads.find((t) => t.id === selectedId) ?? null;
  // Desktop opens the most urgent conversation; phones start on the list.
  const selected = chosen ?? unassigned[0] ?? assigned[0] ?? null;
  const now = new Date(nowMs());

  const messages = selected
    ? await db.select().from(emailMessages).where(eq(emailMessages.threadId, selected.id)).orderBy(asc(emailMessages.sentAt))
    : [];
  // Opening a conversation marks its latest reply as read.
  if (chosen && selected && selected.lastInboundAt && (!selected.readAt || selected.readAt < selected.lastInboundAt)) {
    await db
      .update(emailThreads)
      .set({ readAt: now })
      .where(and(eq(emailThreads.id, selected.id), or(isNull(emailThreads.readAt), lt(emailThreads.readAt, selected.lastInboundAt))));
  }

  const configured = !!process.env.RESEND_WEBHOOK_SECRET;
  const copyAddress = inboxCopyAddress();
  const unread = (t: EmailThread) => !!t.lastInboundAt && (!t.readAt || t.readAt < t.lastInboundAt) && t.id !== chosen?.id;

  const item = (t: EmailThread) => {
    const last = lastBy.get(t.id);
    const label = labelOf(t);
    return (
      <li key={t.id} className="inbox-item" aria-current={selected?.id === t.id ? "true" : undefined} data-unread={unread(t) ? "" : undefined}>
        <Link href={`/admin/inbox?thread=${t.id}`} className="inbox-item-link">
          <span className="inbox-item-top">
            <strong>{t.counterpartName || t.counterpartEmail}</strong>
            <time dateTime={t.lastMessageAt.toISOString()} title={stamp(t.lastMessageAt)}>{compactAgo(t.lastMessageAt, now)}</time>
          </span>
          <span className="inbox-item-subject">{t.subject}</span>
          {last && <span className="inbox-item-snippet">{last.direction === "outbound" ? "You: " : ""}{snippet(last.text, 90)}</span>}
          {label && <span className="inbox-item-label">{label}</span>}
        </Link>
        {!label && <AssignThread threadId={t.id} clients={clientOptions} deals={dealOptions} compact />}
      </li>
    );
  };

  return (
    <main className="shell page inbox-page" data-open={chosen ? "" : undefined}>
      <div className="page-head inbox-head">
        <div>
          <p className="eyebrow">Email · {viewer.email}</p>
          <h1>Inbox</h1>
        </div>
      </div>
      <Notice error={readMessage(sp.error)} notice={readMessage(sp.notice)} />

      {!threads.length ? (
        <section className="card inbox-setup">
          <h2>{configured ? "No conversations yet" : "Connect your email"}</h2>
          {configured ? (
            <p className="muted">
              New emails with clients and leads appear here as they arrive{copyAddress ? <> (copied to <code>{copyAddress}</code>)</> : null}. Anything from a
              known contact files itself under their client; the rest waits under Needs a client.
            </p>
          ) : (
            <>
              <p className="muted">The Inbox fills itself from the team&apos;s mailboxes once email is connected. Until then there&apos;s nothing to show.</p>
              <ol className="inbox-steps">
                <li>Receive mail in Resend on a subdomain (for example <code>inbox.skoxsoftware.com</code>) and add its MX record.</li>
                <li>In Google Workspace, add a routing rule that also delivers the team&apos;s mail to <code>crm@inbox.skoxsoftware.com</code>.</li>
                <li>Add a Resend webhook for <code>email.received</code> pointing at <code>/portal/api/inbound/resend</code>, and set <code>RESEND_WEBHOOK_SECRET</code>, <code>RESEND_INBOUND_API_KEY</code> and <code>INBOX_COPY_ADDRESS</code> in Vercel.</li>
              </ol>
            </>
          )}
        </section>
      ) : (
        <div className="inbox">
          <aside className="inbox-list" aria-label="Conversations">
            {unassigned.length > 0 && (
              <section className="inbox-group inbox-group-needs">
                <h2><i aria-hidden="true" />Needs a client · {unassigned.length}</h2>
                <ul>{unassigned.map(item)}</ul>
              </section>
            )}
            {assigned.length > 0 && (
              <section className="inbox-group">
                <h2>Assigned</h2>
                <ul>{assigned.map(item)}</ul>
              </section>
            )}
          </aside>

          <section className="inbox-thread" aria-label="Conversation">
            {!selected ? (
              <div className="inbox-empty">
                <p>Pick a conversation to read it and reply.</p>
              </div>
            ) : (
              <>
                <Link className="inbox-back" href="/admin/inbox">← Inbox</Link>
                <header className="inbox-thread-head">
                  <div>
                    <h2>{selected.subject}</h2>
                    <p className="small muted">
                      With {selected.counterpartName ? `${selected.counterpartName} · ` : ""}{selected.counterpartEmail}
                    </p>
                  </div>
                  <div className="inbox-thread-tools">
                    {labelOf(selected) ? (
                      <span className="inbox-client-chip">{labelOf(selected)}</span>
                    ) : null}
                    <AssignThread threadId={selected.id} clients={clientOptions} deals={dealOptions} assigned={!!labelOf(selected)} />
                    <form action={archiveThread}>
                      <input type="hidden" name="threadId" value={selected.id} />
                      <button className="btn btn-ghost btn-small" title="Hide until they reply">Done</button>
                    </form>
                  </div>
                </header>

                <ol className="inbox-messages">
                  {messages.map((m) => (
                    <li key={m.id} className="inbox-message" data-direction={m.direction}>
                      <div className="inbox-message-head">
                        <span>
                          {m.direction === "outbound" ? (
                            <><strong>{m.fromName || m.fromEmail}</strong> → {m.to[0] ?? selected.counterpartEmail}</>
                          ) : (
                            <><strong>{m.fromName || m.fromEmail}</strong>{m.fromName && <span className="muted"> &lt;{m.fromEmail}&gt;</span>}</>
                          )}
                        </span>
                        <time dateTime={m.sentAt.toISOString()}>{stamp(m.sentAt)}</time>
                      </div>
                      <div className="inbox-message-body">{stripQuoted(m.text)}</div>
                      {m.attachments.length > 0 && (
                        <ul className="inbox-attachments">
                          {m.attachments.map((a, i) => (
                            <li key={i}>
                              {a.storageKey ? (
                                <a href={`/portal/api/inbox/attachments/${m.id}/${i}`} target="_blank" rel="noreferrer">
                                  📎 {a.name} · {formatBytes(a.size)}
                                </a>
                              ) : (
                                <span className="muted">📎 {a.name} (not saved)</span>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ol>

                <form action={sendReply} className="inbox-reply card">
                  <input type="hidden" name="threadId" value={selected.id} />
                  <div className="field">
                    <label htmlFor="reply-subject">Subject</label>
                    <input id="reply-subject" name="subject" defaultValue={replySubject(selected.subject)} maxLength={250} />
                  </div>
                  <div className="field">
                    <label htmlFor="reply-body">Reply</label>
                    <textarea id="reply-body" name="body" rows={6} required maxLength={20000} placeholder="Write a reply…" />
                  </div>
                  <div className="inbox-reply-foot">
                    <span className="small muted">Sends from {viewer.email} to {selected.counterpartEmail}.</span>
                    <SubmitButton className="btn btn-primary" pendingLabel="Sending…">Send reply</SubmitButton>
                  </div>
                </form>
              </>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
