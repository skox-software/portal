import { and, asc, eq, isNull, max, count } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { Notice, readMessage } from "@/components/Notice";
import { TopBar } from "@/components/TopBar";
import { requireStaff } from "@/lib/access";
import { getDb } from "@/lib/db";
import { clients, projects, tasks, updates } from "@/lib/db/schema";
import { daysUntil, describeDaysUntil, formatDate, kindLabel, STATUS_LABEL } from "@/lib/format";
import { createClient } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Mission control" };

const STALE_UPDATE_DAYS = 7;

export default async function MissionControl({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const { viewer, staff } = await requireStaff();
  const db = getDb();

  const [rows, waiting, lastUpdates] = await Promise.all([
    db
      .select({ client: clients, project: projects })
      .from(clients)
      .leftJoin(projects, eq(projects.clientId, clients.id))
      .where(eq(clients.workspaceId, staff.workspaceId))
      .orderBy(asc(clients.name), asc(projects.deliveryDate)),
    db
      .select({ projectId: tasks.projectId, n: count() })
      .from(tasks)
      .where(and(eq(tasks.workspaceId, staff.workspaceId), eq(tasks.side, "client"), isNull(tasks.doneAt)))
      .groupBy(tasks.projectId),
    db
      .select({ projectId: updates.projectId, last: max(updates.createdAt) })
      .from(updates)
      .where(eq(updates.workspaceId, staff.workspaceId))
      .groupBy(updates.projectId),
  ]);

  const waitingBy = new Map(waiting.map((w) => [w.projectId, Number(w.n)]));
  const lastBy = new Map(lastUpdates.map((u) => [u.projectId, u.last]));
  const grouped = new Map<string, { client: (typeof rows)[number]["client"]; projects: NonNullable<(typeof rows)[number]["project"]>[] }>();
  for (const { client, project } of rows) {
    const entry = grouped.get(client.id) ?? { client, projects: [] };
    if (project) entry.projects.push(project);
    grouped.set(client.id, entry);
  }

  return (
    <>
      <TopBar viewer={viewer} />
      <main className="shell page">
        <div className="page-head">
          <div>
            <p className="eyebrow">SKOX team</p>
            <h1>Mission control</h1>
          </div>
        </div>
        <Notice error={readMessage(sp.error)} notice={readMessage(sp.notice)} />

        <section className="card" aria-labelledby="new-client">
          <div className="card-head">
            <h2 id="new-client">Add a client</h2>
          </div>
          <form action={createClient} className="form-grid">
            <div className="field">
              <label htmlFor="client-name">Company name</label>
              <input id="client-name" name="name" required maxLength={120} placeholder="e.g. Harbor Dental Group" />
            </div>
            <div>
              <button className="btn btn-primary" type="submit">
                Add client
              </button>
            </div>
          </form>
        </section>

        {grouped.size === 0 ? (
          <p className="empty" style={{ marginTop: 16 }}>
            No clients yet. Add your first one above.
          </p>
        ) : (
          [...grouped.values()].map(({ client, projects: list }) => (
            <section key={client.id} className="card client-block" aria-labelledby={`client-${client.id}`}>
              <div className="card-head">
                <h2 id={`client-${client.id}`}>
                  <Link href={`/admin/clients/${client.id}`}>{client.name}</Link>
                </h2>
                <Link className="btn btn-ghost btn-small" href={`/admin/clients/${client.id}`}>
                  People &amp; projects
                </Link>
              </div>
              {list.length === 0 ? (
                <p className="muted">No projects yet.</p>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Project</th>
                        <th>Status</th>
                        <th>Delivery</th>
                        <th>Needs attention</th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.map((p) => {
                        const waitingOnClient = waitingBy.get(p.id) ?? 0;
                        const last = lastBy.get(p.id);
                        const stale =
                          p.status !== "launched" &&
                          p.status !== "paused" &&
                          (!last || Date.now() - new Date(last).getTime() > STALE_UPDATE_DAYS * 86_400_000);
                        const days = daysUntil(p.deliveryDate);
                        return (
                          <tr key={p.id}>
                            <td>
                              <Link href={`/admin/projects/${p.id}`}>{p.name}</Link>
                              <div className="muted small">{kindLabel(p.kind)}</div>
                            </td>
                            <td>
                              <span className="chip">{STATUS_LABEL[p.status]}</span>
                            </td>
                            <td className="num">
                              {formatDate(p.deliveryDate)}
                              <div className="muted small">{describeDaysUntil(days)}</div>
                            </td>
                            <td>
                              <div className="row">
                                {stale && <span className="chip chip-danger">No update in {STALE_UPDATE_DAYS}+ days</span>}
                                {waitingOnClient > 0 && (
                                  <span className="chip chip-amber">{waitingOnClient} waiting on client</span>
                                )}
                                {days < 0 && p.status !== "launched" && <span className="chip chip-danger">Past delivery date</span>}
                                {!stale && waitingOnClient === 0 && !(days < 0 && p.status !== "launched") && (
                                  <span className="chip chip-ok">On track</span>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          ))
        )}
      </main>
    </>
  );
}
