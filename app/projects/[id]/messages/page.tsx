import { and, desc, eq, or, sql } from "drizzle-orm";
import { ProjectHeader } from "@/components/ProjectHeader";
import { loadProjectShell } from "@/lib/project-shell";
import { getDb } from "@/lib/db";
import { emailMessages, emailThreads } from "@/lib/db/schema";
import { formatDateTime } from "@/lib/format";
export const dynamic = "force-dynamic";
export const metadata = { title: "Emails" };
export default async function MessagesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const shell = await loadProjectShell(id);
  // A client sees only messages they sent or received, on threads explicitly
  // assigned to their client. Linking a thread never exposes internal mail.
  const participant = shell.access.isStaff ? undefined : or(eq(emailMessages.fromEmail, shell.viewer.email), sql`${emailMessages.to} @> ${JSON.stringify([shell.viewer.email])}::jsonb`, sql`${emailMessages.cc} @> ${JSON.stringify([shell.viewer.email])}::jsonb`);
  const messages = await getDb().select({ id: emailMessages.id, subject: emailMessages.subject, from: emailMessages.fromEmail, text: emailMessages.text, sentAt: emailMessages.sentAt }).from(emailMessages).innerJoin(emailThreads, eq(emailThreads.id, emailMessages.threadId)).where(and(eq(emailMessages.workspaceId, shell.project.workspaceId), eq(emailThreads.workspaceId, shell.project.workspaceId), eq(emailThreads.clientId, shell.client.id), participant)).orderBy(desc(emailMessages.sentAt)).limit(100);
  return <><ProjectHeader shell={shell} tab="messages" title="Emails" intro="Conversations with SKOX linked to your client account." /><main className="shell page stack">{messages.length ? messages.map(m=><article className="card stack" key={m.id}><h2>{m.subject}</h2><p className="small muted">{m.from} · {formatDateTime(m.sentAt)}</p><p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{m.text}</p></article>) : <section className="card"><h2>No emails here yet</h2><p className="muted">Conversations appear here once SKOX links them to your account. Project updates remain on your Overview.</p></section>}</main></>;
}
