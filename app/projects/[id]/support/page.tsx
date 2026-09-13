import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { Metadata } from "next";
import { readMessage } from "@/components/Notice";
import { ProjectHeader } from "@/components/ProjectHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { getDb } from "@/lib/db";
import { comments, supportRequests } from "@/lib/db/schema";
import { formatDateTime, PRIORITY_LABEL, REQUEST_STATUS_LABEL } from "@/lib/format";
import { can } from "@/lib/permissions";
import { loadProjectShell } from "@/lib/project-shell";
import { createRequest, replyToRequest } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Requests" };

const STATUS_CHIP = { new: "chip chip-amber", in_progress: "chip chip-amber", waiting_on_client: "chip chip-danger", done: "chip chip-ok" } as const;

export default async function SupportPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const shell = await loadProjectShell(id);
  const { project, access } = shell;
  const db = getDb();
  const list = await db.select().from(supportRequests).where(eq(supportRequests.projectId, project.id)).orderBy(desc(supportRequests.createdAt));
  const thread = list.length
    ? await db
        .select()
        .from(comments)
        .where(and(eq(comments.parentType, "request"), inArray(comments.parentId, list.map((r) => r.id))))
        .orderBy(asc(comments.createdAt))
    : [];
  const openList = list.filter((r) => r.status !== "done");
  const doneList = list.filter((r) => r.status === "done");

  const card = (r: (typeof list)[number]) => {
    const messages = thread.filter((c) => c.parentId === r.id);
    return (
      <details key={r.id} id={`r-${r.id}`} className="request" open={r.status === "waiting_on_client" || undefined}>
        <summary>
          <span className="request-title">{r.title}</span>
          <span className="row">
            {r.priority === "urgent" && <span className="chip chip-danger">Urgent</span>}
            <span className={STATUS_CHIP[r.status]}>{r.status === "waiting_on_client" && access.isStaff ? "Waiting on client" : REQUEST_STATUS_LABEL[r.status]}</span>
          </span>
        </summary>
        <div className="request-body">
          <div className="message">
            <p className="small muted">
              {r.createdByEmail} · {formatDateTime(r.createdAt)} · {PRIORITY_LABEL[r.priority]} priority
            </p>
            <p>{r.body}</p>
          </div>
          {messages.map((m) => (
            <div key={m.id} className="message" data-skox={m.authorId.endsWith("@skoxsoftware.com") ? "true" : undefined}>
              <p className="small muted">
                {m.authorId} · {formatDateTime(m.createdAt)}
              </p>
              <p>{m.body}</p>
            </div>
          ))}
          <form action={replyToRequest} className="stack">
            <input type="hidden" name="projectId" value={project.id} />
            <input type="hidden" name="requestId" value={r.id} />
            <label className="sr-only" htmlFor={`reply-${r.id}`}>
              Reply
            </label>
            <textarea id={`reply-${r.id}`} name="body" maxLength={5000} placeholder="Write a reply" />
            <div className="row">
              {access.isStaff && (
                <select name="status" defaultValue="" aria-label="Set status" style={{ width: "auto" }}>
                  <option value="">Keep status ({REQUEST_STATUS_LABEL[r.status]})</option>
                  <option value="in_progress">In progress</option>
                  <option value="waiting_on_client">Waiting on client</option>
                  <option value="done">Done</option>
                </select>
              )}
              <button className="btn btn-primary btn-small" type="submit">
                Send
              </button>
            </div>
          </form>
        </div>
      </details>
    );
  };

  return (
    <>
      <ProjectHeader
        shell={shell}
        tab="support"
        title="Requests"
        intro="Need a change, found a bug, or have a question? Ask here and track it to done. No more lost texts."
        error={readMessage(sp.error)}
        notice={readMessage(sp.notice)}
      />
      <main className="shell page page-after-band">
        <div className="split">
          <div className="stack">
            <section className="card" aria-labelledby="open-title">
              <div className="card-head">
                <h2 id="open-title">Open</h2>
                <span className="muted small">{openList.length}</span>
              </div>
              {openList.length === 0 ? <p className="muted small">Nothing open. Everything you&apos;ve asked for is done.</p> : openList.map(card)}
            </section>
            {doneList.length > 0 && (
              <section className="card" aria-labelledby="done-title">
                <div className="card-head">
                  <h2 id="done-title">Done</h2>
                  <span className="muted small">{doneList.length}</span>
                </div>
                {doneList.map(card)}
              </section>
            )}
          </div>
          <aside>
            {can.requestSupport(access) ? (
              <section className="card" aria-labelledby="new-request">
                <div className="card-head">
                  <h2 id="new-request">Request a change</h2>
                </div>
                <form action={createRequest} className="stack">
                  <input type="hidden" name="projectId" value={project.id} />
                  <div className="field">
                    <label htmlFor="q-title">What do you need?</label>
                    <input id="q-title" name="title" required minLength={3} maxLength={160} placeholder="e.g. Update our opening hours" />
                  </div>
                  <div className="field">
                    <label htmlFor="q-body">Details</label>
                    <textarea id="q-body" name="body" required maxLength={5000} placeholder="Where it is, what it should say or do, any links" />
                  </div>
                  <div className="field">
                    <label htmlFor="q-priority">How urgent?</label>
                    <select id="q-priority" name="priority" defaultValue="normal">
                      <option value="low">Whenever you can</option>
                      <option value="normal">Normal</option>
                      <option value="urgent">Urgent: something is broken</option>
                    </select>
                  </div>
                  <SubmitButton className="btn btn-primary" pendingLabel="Sending…">
                    Send request
                  </SubmitButton>
                  <p className="small muted">Need to share a screenshot? Upload it in Files, then mention the file name here.</p>
                </form>
              </section>
            ) : (
              <section className="card">
                <p className="small muted">Clients raise requests here. Reply and set the status on each one.</p>
              </section>
            )}
          </aside>
        </div>
      </main>
    </>
  );
}
