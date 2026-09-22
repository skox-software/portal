import { and, desc, eq, inArray } from "drizzle-orm";
import Link from "next/link";
import { formatShortDate } from "@/lib/crm";
import { getDb } from "@/lib/db";
import { clients, emailMessages, emailThreads } from "@/lib/db/schema";

/**
 * The inbox's thread list. Unassigned threads sit on top under their own
 * heading: that queue is what keeps the CRM honest, so it never scrolls away.
 */
export async function InboxThreads({ workspaceId, currentId }: { workspaceId: string; currentId?: string }) {
  const db = getDb();
  const threads = await db
    .select({ thread: emailThreads, clientName: clients.name })
    .from(emailThreads)
    .leftJoin(clients, eq(clients.id, emailThreads.clientId))
    .where(and(eq(emailThreads.workspaceId, workspaceId), eq(emailThreads.archived, false)))
    .orderBy(desc(emailThreads.lastMessageAt))
    .limit(80);

  const ids = threads.map((t) => t.thread.id);
  const latest = ids.length
    ? await db
        .select({ threadId: emailMessages.threadId, snippet: emailMessages.snippet, createdAt: emailMessages.createdAt })
        .from(emailMessages)
        .where(inArray(emailMessages.threadId, ids))
        .orderBy(desc(emailMessages.createdAt))
    : [];
  const snippetBy = new Map<string, string | null>();
  for (const m of latest) if (!snippetBy.has(m.threadId)) snippetBy.set(m.threadId, m.snippet);

  const unassigned = threads.filter((t) => !t.thread.clientId);
  const assigned = threads.filter((t) => t.thread.clientId);

  const item = ({ thread: t, clientName }: (typeof threads)[number]) => (
    <Link key={t.id} className="thread-item" href={`/admin/inbox/${t.id}`} aria-current={t.id === currentId ? "page" : undefined}>
      <span>{t.unread && <span className="thread-unread" role="img" aria-label="Unread" />}</span>
      <span className="thread-from">{t.counterpartName ?? t.counterpartEmail ?? "Unknown sender"}</span>
      <span className="thread-when">{formatShortDate(t.lastMessageAt)}</span>
      <span className="thread-subject">{t.subject || "(no subject)"}</span>
      {snippetBy.get(t.id) && <span className="thread-snippet">{snippetBy.get(t.id)}</span>}
      {clientName && <span className="thread-client">{clientName}</span>}
    </Link>
  );

  return (
    <nav className="card thread-list" aria-label="Email threads">
      {threads.length === 0 && (
        <p className="small muted" style={{ padding: 16 }}>
          No email yet. Mail forwarded from Gmail shows up here.
        </p>
      )}
      {unassigned.length > 0 && (
        <>
          <h2 className="thread-group" data-kind="unassigned">
            Needs a client · {unassigned.length}
          </h2>
          {unassigned.map(item)}
        </>
      )}
      {assigned.length > 0 && (
        <>
          <h2 className="thread-group">Clients</h2>
          {assigned.map(item)}
        </>
      )}
    </nav>
  );
}
