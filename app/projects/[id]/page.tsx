import { and, asc, desc, eq, isNull } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { TopBar } from "@/components/TopBar";
import { requireProjectAccess } from "@/lib/access";
import { getDb } from "@/lib/db";
import { dateChanges, milestones, previews, tasks, updates } from "@/lib/db/schema";
import {
  daysUntil,
  describeDaysUntil,
  formatDate,
  formatDateTime,
  kindLabel,
  MILESTONE_STATE_LABEL,
  STATUS_LABEL,
} from "@/lib/format";
import { can } from "@/lib/permissions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Project" };

export default async function ProjectHome({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { viewer, project, client, access } = await requireProjectAccess(id);
  const db = getDb();

  const [steps, openTasks, recentUpdates, changes] = await Promise.all([
    db
      .select()
      .from(milestones)
      .where(eq(milestones.projectId, project.id))
      .orderBy(asc(milestones.position), asc(milestones.dueOn)),
    db
      .select()
      .from(tasks)
      .where(and(eq(tasks.projectId, project.id), isNull(tasks.doneAt)))
      .orderBy(asc(tasks.dueOn)),
    db
      .select({ update: updates, preview: previews })
      .from(updates)
      .leftJoin(previews, eq(previews.id, updates.previewId))
      .where(eq(updates.projectId, project.id))
      .orderBy(desc(updates.createdAt))
      .limit(5),
    db
      .select()
      .from(dateChanges)
      .where(eq(dateChanges.projectId, project.id))
      .orderBy(desc(dateChanges.createdAt))
      .limit(3),
  ]);

  const days = daysUntil(project.deliveryDate);
  const waitingOnClient = openTasks.filter((t) => t.side === "client");
  const onOurSide = openTasks.filter((t) => t.side === "skox");
  const [latest, ...older] = recentUpdates;

  return (
    <>
      <TopBar viewer={viewer} />
      <main className="shell page">
        <div className="page-head">
          <div>
            <p className="eyebrow">
              {client.name} · {kindLabel(project.kind)}
            </p>
            <h1>{project.name}</h1>
          </div>
          <div className="row">
            <span className={project.status === "launched" ? "chip chip-ok" : "chip chip-amber"}>
              {STATUS_LABEL[project.status]}
            </span>
            {can.manageProject(access) && (
              <Link className="btn btn-ghost btn-small" href={`/admin/projects/${project.id}`}>
                Manage project
              </Link>
            )}
          </div>
        </div>

        <section className="date-panel" aria-label="Delivery date">
          <div>
            <p className="label">Delivery date</p>
            <p className="date-big">{formatDate(project.deliveryDate)}</p>
            {changes[0] && (
              <p className="date-history">
                Moved from {formatDate(changes[0].fromDate)} on{" "}
                {formatDateTime(changes[0].createdAt)}: {changes[0].reason}
              </p>
            )}
          </div>
          <p className="date-countdown">
            {project.status === "launched" ? "Launched" : describeDaysUntil(days)}
          </p>
        </section>

        <div className="split">
          <div>
            <section className="card" aria-labelledby="update-title">
              <div className="card-head">
                <h2 id="update-title">Latest update</h2>
                {latest && <span className="muted small">{formatDateTime(latest.update.createdAt)}</span>}
              </div>
              {latest ? (
                <>
                  <div className="update-grid">
                    <div className="stack">
                      <h3>Shipped</h3>
                      <p>{latest.update.shipped || "Nothing new this time."}</p>
                    </div>
                    <div className="stack">
                      <h3>Next</h3>
                      <p>{latest.update.next || "To be confirmed."}</p>
                    </div>
                    <div className="stack">
                      <h3>Needed from you</h3>
                      <p>{latest.update.needed || "Nothing right now."}</p>
                    </div>
                  </div>
                  {(latest.preview || latest.update.videoUrl) && (
                    <div className="update-meta">
                      {latest.preview && (
                        <a href={latest.preview.url} target="_blank" rel="noopener noreferrer">
                          Open the preview{latest.preview.label ? `: ${latest.preview.label}` : ""} ↗
                        </a>
                      )}
                      {latest.update.videoUrl && (
                        <a href={latest.update.videoUrl} target="_blank" rel="noopener noreferrer">
                          Watch the walkthrough ↗
                        </a>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <p className="empty">Your first update arrives after kickoff.</p>
              )}
            </section>

            {older.length > 0 && (
              <section className="card" aria-labelledby="older-title">
                <div className="card-head">
                  <h2 id="older-title">Earlier updates</h2>
                </div>
                {older.map(({ update, preview }) => (
                  <details key={update.id} className="update-older">
                    <summary>{formatDateTime(update.createdAt)}</summary>
                    <div className="update-grid" style={{ marginTop: 12 }}>
                      <p>{update.shipped}</p>
                      <p>{update.next}</p>
                      <p>{update.needed}</p>
                    </div>
                    {preview && (
                      <p className="small" style={{ marginTop: 8 }}>
                        <a href={preview.url} target="_blank" rel="noopener noreferrer">
                          Preview ↗
                        </a>
                      </p>
                    )}
                  </details>
                ))}
              </section>
            )}
          </div>

          <aside>
            <section className="card" aria-labelledby="waiting-title">
              <div className="card-head">
                <h2 id="waiting-title">Waiting on you</h2>
                {waitingOnClient.length > 0 && (
                  <span className="chip chip-amber">{waitingOnClient.length}</span>
                )}
              </div>
              {waitingOnClient.length ? (
                <ul className="task-list">
                  {waitingOnClient.map((t) => (
                    <li key={t.id}>
                      <span>{t.title}</span>
                      <span className="when">{t.dueOn ? `Due ${formatDate(t.dueOn)}` : ""}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">Nothing needed from you right now.</p>
              )}
            </section>

            <section className="card" aria-labelledby="progress-title">
              <div className="card-head">
                <h2 id="progress-title">Progress</h2>
              </div>
              {steps.length ? (
                <ol className="timeline">
                  {steps.map((m) => (
                    <li key={m.id} data-state={m.state}>
                      <span className="dot" aria-hidden="true" />
                      <span>
                        {m.title}
                        <span className="sr-only"> ({MILESTONE_STATE_LABEL[m.state]})</span>
                      </span>
                      <span className="when">{formatDate(m.dueOn)}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="muted">Milestones appear here once the plan is set.</p>
              )}
            </section>

            {onOurSide.length > 0 && (
              <section className="card" aria-labelledby="ours-title">
                <div className="card-head">
                  <h2 id="ours-title">On our side</h2>
                </div>
                <ul className="task-list">
                  {onOurSide.map((t) => (
                    <li key={t.id}>
                      <span>{t.title}</span>
                      <span className="when">{t.dueOn ? formatDate(t.dueOn) : ""}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </aside>
        </div>
      </main>
    </>
  );
}
