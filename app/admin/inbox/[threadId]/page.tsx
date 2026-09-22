import { and, asc, eq, inArray } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { InboxThreads } from "@/components/InboxThreads";
import { Notice, readMessage } from "@/components/Notice";
import { TopBar } from "@/components/TopBar";
import { requireStaff } from "@/lib/access";
import { plainText, replySubject } from "@/lib/crm";
import { clientOptions } from "@/lib/crm-data";
import { getDb } from "@/lib/db";
import { clients, emailAttachments, emailMessages, emailThreads } from "@/lib/db/schema";
import { formatDateTime } from "@/lib/format";
import { formatBytes } from "@/lib/storage";
import { archiveThread, assignThread, sendReply } from "../../crm-actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Inbox" };

export default async function Thread({
  params,
  searchParams,
}: {
  params: Promise<{ threadId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ threadId }, sp] = await Promise.all([params, searchParams]);
  const { viewer, staff } = await requireStaff();
  const db = getDb();

  const [row] = /^[0-9a-f-]{36}$/i.test(threadId)
    ? await db
        .select({ thread: emailThreads, client: clients })
        .from(emailThreads)
        .leftJoin(clients, eq(clients.id, emailThreads.clientId))
        .where(and(eq(emailThreads.id, threadId), eq(emailThreads.workspaceId, staff.workspaceId)))
        .limit(1)
    : [];
  if (!row) notFound();
  const { thread, client } = row;

  const [messages, clientList] = await Promise.all([
    db.select().from(emailMessages).where(eq(emailMessages.threadId, thread.id)).orderBy(asc(emailMessages.createdAt)),
    thread.clientId ? Promise.resolve([]) : clientOptions(staff.workspaceId),
  ]);
  const files = messages.length
    ? await db
        .select()
        .from(emailAttachments)
        .where(inArray(emailAttachments.messageId, messages.map((m) => m.id)))
    : [];
  if (thread.unread) await db.update(emailThreads).set({ unread: false }).where(eq(emailThreads.id, thread.id));

  const guessCompany = thread.counterpartEmail?.split("@")[1] ?? "";
  const freeMail = /^(gmail|googlemail|yahoo|hotmail|outlook|icloud|me|aol|proton(mail)?)\./i.test(guessCompany);

  return (
    <>
      <TopBar viewer={viewer} current="inbox" />
      <main className="shell page" style={{ width: "min(1320px, calc(100% - 48px))" }}>
        <div className="page-head">
          <div>
            <p className="eyebrow">
              <Link href="/admin/inbox">Inbox</Link>
            </p>
            <h1 style={{ fontSize: "clamp(28px, 3vw, 38px)" }}>{thread.subject || "(no subject)"}</h1>
          </div>
          <div className="row">
            {client ? (
              <Link className="chip chip-amber" href={`/admin/clients/${client.id}${thread.dealId ? `?deal=${thread.dealId}` : ""}`}>
                {client.name}
              </Link>
            ) : (
              <span className="chip chip-danger">Needs a client</span>
            )}
            <form action={archiveThread}>
              <input type="hidden" name="threadId" value={thread.id} />
              <button className="btn btn-ghost btn-small" type="submit">
                Archive
              </button>
            </form>
          </div>
        </div>
        <Notice error={readMessage(sp.error)} notice={readMessage(sp.notice)} />

        <div className="inbox-layout">
          <InboxThreads workspaceId={staff.workspaceId} currentId={thread.id} />
          <div>
            {!thread.clientId && (
              <section className="card" aria-labelledby="assign-title" style={{ marginBottom: 16 }}>
                <div className="card-head">
                  <h2 id="assign-title">Which client is this?</h2>
                </div>
                <p className="small muted" style={{ marginBottom: 12 }}>
                  {thread.counterpartEmail} becomes a contact, so their next email files itself.
                </p>
                <form action={assignThread} className="inline-form">
                  <input type="hidden" name="threadId" value={thread.id} />
                  <label className="sr-only" htmlFor="assign-client">
                    Client
                  </label>
                  <select id="assign-client" name="clientId" required defaultValue="">
                    <option value="" disabled>
                      Pick a client…
                    </option>
                    {clientList.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <button className="btn btn-primary btn-small" type="submit">
                    File it
                  </button>
                </form>
                <form action={assignThread} className="inline-form" style={{ marginTop: 10 }}>
                  <input type="hidden" name="threadId" value={thread.id} />
                  <input type="hidden" name="clientId" value="new" />
                  <label className="sr-only" htmlFor="assign-company">
                    Company name
                  </label>
                  <input
                    id="assign-company"
                    name="companyName"
                    maxLength={120}
                    placeholder="Company name"
                    defaultValue={freeMail ? "" : guessCompany}
                  />
                  <button className="btn btn-ghost btn-small" type="submit">
                    New lead from this email
                  </button>
                </form>
              </section>
            )}

            {messages.length === 0 && <p className="empty" style={{ marginBottom: 12 }}>No messages yet. Write the first one below.</p>}
            {messages.map((m) => {
              const mine = files.filter((f) => f.messageId === m.id);
              return (
                <article key={m.id} className="message" data-direction={m.direction}>
                  <div className="message-meta">
                    <span>
                      <strong>{m.fromName ?? m.fromEmail}</strong> {m.direction === "outbound" ? `→ ${m.toEmails.join(", ")}` : `<${m.fromEmail}>`}
                    </span>
                    <span className="money">{formatDateTime(m.createdAt)}</span>
                  </div>
                  <div className="message-body">{plainText(m.textBody, m.htmlBody) || m.snippet || ""}</div>
                  {mine.length > 0 && (
                    <div className="message-files">
                      {mine.map((f) =>
                        f.storageKey ? (
                          <a key={f.id} href={`/api/email-attachments/${f.id}`}>
                            {f.name} · {formatBytes(f.sizeBytes)}
                          </a>
                        ) : (
                          <span key={f.id} title="Too large to copy; it's still in Gmail">
                            {f.name} · not copied
                          </span>
                        ),
                      )}
                    </div>
                  )}
                </article>
              );
            })}

            {thread.counterpartEmail && (
              <form action={sendReply} className="card stack" style={{ marginTop: 16 }}>
                <input type="hidden" name="threadId" value={thread.id} />
                <div className="field">
                  <label htmlFor="r-subject">Subject</label>
                  <input
                    id="r-subject"
                    name="subject"
                    required
                    maxLength={200}
                    defaultValue={messages.length ? replySubject(thread.subject) : (thread.subject ?? "")}
                  />
                </div>
                <div className="field">
                  <label htmlFor="r-body">{messages.length ? "Reply" : "Message"}</label>
                  <textarea id="r-body" name="body" required maxLength={20000} style={{ minHeight: 140 }} />
                </div>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <span className="small muted">To {thread.counterpartEmail}</span>
                  <button className="btn btn-primary" type="submit">
                    Send
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      </main>
    </>
  );
}
