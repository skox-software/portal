import { and, asc, desc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Notice, readMessage } from "@/components/Notice";
import { TopBar } from "@/components/TopBar";
import { requireStaff } from "@/lib/access";
import { getDb } from "@/lib/db";
import { clients, dateChanges, milestones, projects, tasks, updates } from "@/lib/db/schema";
import {
  daysUntil,
  describeDaysUntil,
  formatDate,
  formatDateTime,
  kindLabel,
  MILESTONE_STATE_LABEL,
  STATUS_LABEL,
} from "@/lib/format";
import {
  addMilestone,
  addTask,
  changeDeliveryDate,
  postUpdate,
  setMilestoneState,
  setProjectStatus,
  toggleTask,
} from "../../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Manage project" };

export default async function ProjectAdmin({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const { viewer, staff } = await requireStaff();
  const db = getDb();

  const [row] = /^[0-9a-f-]{36}$/i.test(id)
    ? await db
        .select({ project: projects, client: clients })
        .from(projects)
        .innerJoin(clients, eq(clients.id, projects.clientId))
        .where(and(eq(projects.id, id), eq(projects.workspaceId, staff.workspaceId)))
        .limit(1)
    : [];
  if (!row) notFound();
  const { project, client } = row;

  const [steps, allTasks, recent, changes] = await Promise.all([
    db.select().from(milestones).where(eq(milestones.projectId, project.id)).orderBy(asc(milestones.position), asc(milestones.dueOn)),
    db.select().from(tasks).where(eq(tasks.projectId, project.id)).orderBy(asc(tasks.doneAt), asc(tasks.dueOn)),
    db.select().from(updates).where(eq(updates.projectId, project.id)).orderBy(desc(updates.createdAt)).limit(3),
    db.select().from(dateChanges).where(eq(dateChanges.projectId, project.id)).orderBy(desc(dateChanges.createdAt)),
  ]);

  const hidden = <input type="hidden" name="projectId" value={project.id} />;

  return (
    <>
      <TopBar viewer={viewer} />
      <main className="shell page">
        <div className="page-head">
          <div>
            <p className="eyebrow">
              <Link href="/admin">Mission control</Link> / <Link href={`/admin/clients/${client.id}`}>{client.name}</Link>
            </p>
            <h1>{project.name}</h1>
            <p className="muted" style={{ marginTop: 6 }}>
              {kindLabel(project.kind)} · started {formatDate(project.startedOn)}
            </p>
          </div>
          <Link className="btn btn-ghost" href={`/projects/${project.id}`}>
            See what the client sees
          </Link>
        </div>
        <Notice error={readMessage(sp.error)} notice={readMessage(sp.notice)} />

        <div className="split">
          <div>
            <section className="card" aria-labelledby="post-update">
              <div className="card-head">
                <h2 id="post-update">Post this week&apos;s update</h2>
                {recent[0] && <span className="muted small">Last: {formatDateTime(recent[0].createdAt)}</span>}
              </div>
              <form action={postUpdate} className="stack">
                {hidden}
                <div className="field">
                  <label htmlFor="u-shipped">Shipped</label>
                  <textarea id="u-shipped" name="shipped" maxLength={4000} placeholder="What's now working that wasn't last week" />
                </div>
                <div className="field">
                  <label htmlFor="u-next">Next</label>
                  <textarea id="u-next" name="next" maxLength={4000} placeholder="What we're building before the next update" />
                </div>
                <div className="field">
                  <label htmlFor="u-needed">Needed from the client</label>
                  <textarea id="u-needed" name="needed" maxLength={4000} placeholder="Content, access or decisions we're waiting on" />
                  <span className="hint">Anything with a due date belongs in the tasks list too, so it shows under &ldquo;Waiting on you&rdquo;.</span>
                </div>
                <div className="form-grid">
                  <div className="field">
                    <label htmlFor="u-preview">Preview link</label>
                    <input id="u-preview" name="previewUrl" type="url" placeholder="https://" />
                  </div>
                  <div className="field">
                    <label htmlFor="u-label">Preview label</label>
                    <input id="u-label" name="previewLabel" maxLength={120} placeholder="e.g. Booking flow v2" />
                  </div>
                  <div className="field">
                    <label htmlFor="u-video">Walkthrough video</label>
                    <input id="u-video" name="videoUrl" type="url" placeholder="https://" />
                  </div>
                </div>
                <div>
                  <button className="btn btn-primary" type="submit">
                    Post update
                  </button>
                </div>
              </form>
            </section>

            <section className="card" aria-labelledby="tasks-title">
              <div className="card-head">
                <h2 id="tasks-title">Tasks</h2>
              </div>
              {allTasks.length === 0 ? (
                <p className="muted">No tasks yet.</p>
              ) : (
                <ul className="task-list">
                  {allTasks.map((t) => (
                    <li key={t.id}>
                      <span className={t.doneAt ? "task-done" : undefined}>
                        <span className={t.side === "client" ? "chip chip-amber" : "chip"} style={{ marginRight: 8 }}>
                          {t.side === "client" ? "Client" : "SKOX"}
                        </span>
                        {t.title}
                        {t.dueOn && <span className="when"> · due {formatDate(t.dueOn)}</span>}
                      </span>
                      <form action={toggleTask}>
                        {hidden}
                        <input type="hidden" name="taskId" value={t.id} />
                        <button className="btn btn-link small" type="submit">
                          {t.doneAt ? "Reopen" : "Mark done"}
                        </button>
                      </form>
                    </li>
                  ))}
                </ul>
              )}
              <form action={addTask} className="form-grid" style={{ marginTop: 16 }}>
                {hidden}
                <div className="field">
                  <label htmlFor="t-title">New task</label>
                  <input id="t-title" name="title" required maxLength={200} placeholder="e.g. Send logo files" />
                </div>
                <div className="field">
                  <label htmlFor="t-side">Who&apos;s it on</label>
                  <select id="t-side" name="side" defaultValue="client">
                    <option value="client">Client</option>
                    <option value="skox">SKOX</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="t-due">Due</label>
                  <input id="t-due" name="dueOn" type="date" />
                </div>
                <div>
                  <button className="btn btn-ghost" type="submit">
                    Add task
                  </button>
                </div>
              </form>
            </section>
          </div>

          <aside>
            <section className="card" aria-labelledby="date-title">
              <div className="card-head">
                <h2 id="date-title">Delivery date</h2>
                <span className="muted small">{describeDaysUntil(daysUntil(project.deliveryDate))}</span>
              </div>
              <p className="date-big" style={{ fontSize: 36 }}>
                {formatDate(project.deliveryDate)}
              </p>
              <form action={changeDeliveryDate} className="stack" style={{ marginTop: 14 }}>
                {hidden}
                <div className="field">
                  <label htmlFor="d-date">New date</label>
                  <input id="d-date" name="deliveryDate" type="date" required />
                </div>
                <div className="field">
                  <label htmlFor="d-reason">Why it&apos;s moving</label>
                  <input id="d-reason" name="reason" required minLength={3} maxLength={500} placeholder="The client sees this" />
                </div>
                <div>
                  <button className="btn btn-ghost" type="submit">
                    Move the date
                  </button>
                </div>
              </form>
              {changes.length > 0 && (
                <ul className="task-list" style={{ marginTop: 14 }}>
                  {changes.map((c) => (
                    <li key={c.id}>
                      <span className="small">
                        {formatDate(c.fromDate)} → {formatDate(c.toDate)}: {c.reason}
                      </span>
                      <span className="when">{formatDateTime(c.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="card" aria-labelledby="status-title">
              <div className="card-head">
                <h2 id="status-title">Status</h2>
              </div>
              <form action={setProjectStatus} className="inline-form">
                {hidden}
                <label className="sr-only" htmlFor="s-status">
                  Status
                </label>
                <select id="s-status" name="status" defaultValue={project.status}>
                  {Object.entries(STATUS_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <button className="btn btn-ghost btn-small" type="submit">
                  Save
                </button>
              </form>
            </section>

            <section className="card" aria-labelledby="milestones-title">
              <div className="card-head">
                <h2 id="milestones-title">Milestones</h2>
              </div>
              <ul className="task-list">
                {steps.map((m) => (
                  <li key={m.id} style={{ display: "grid", gap: 6 }}>
                    <div className="row" style={{ justifyContent: "space-between" }}>
                      <span>{m.title}</span>
                      <span className="when">{formatDate(m.dueOn)}</span>
                    </div>
                    <form action={setMilestoneState} className="inline-form">
                      {hidden}
                      <input type="hidden" name="milestoneId" value={m.id} />
                      <label className="sr-only" htmlFor={`ms-${m.id}`}>
                        State of {m.title}
                      </label>
                      <select id={`ms-${m.id}`} name="state" defaultValue={m.state}>
                        {Object.entries(MILESTONE_STATE_LABEL).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                      <button className="btn btn-ghost btn-small" type="submit">
                        Save
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
              <form action={addMilestone} className="stack" style={{ marginTop: 14 }}>
                {hidden}
                <div className="field">
                  <label htmlFor="ms-title">Add a milestone</label>
                  <input id="ms-title" name="title" required maxLength={140} placeholder="e.g. Content review" />
                </div>
                <div className="field">
                  <label htmlFor="ms-due">Due</label>
                  <input id="ms-due" name="dueOn" type="date" />
                </div>
                <div>
                  <button className="btn btn-ghost btn-small" type="submit">
                    Add milestone
                  </button>
                </div>
              </form>
            </section>
          </aside>
        </div>
      </main>
    </>
  );
}
