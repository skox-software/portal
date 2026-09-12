import { and, asc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Notice, readMessage } from "@/components/Notice";
import { TopBar } from "@/components/TopBar";
import { requireStaff } from "@/lib/access";
import { getDb } from "@/lib/db";
import { clients, memberships, projects } from "@/lib/db/schema";
import { formatDate, kindLabel, PROJECT_KINDS, ROLE_LABEL, STATUS_LABEL, todayIso } from "@/lib/format";
import { createProject, inviteMember, removeMember, sendSignInLink } from "../../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Client" };

export default async function ClientAdmin({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const { viewer, staff } = await requireStaff();
  const db = getDb();

  const [client] = /^[0-9a-f-]{36}$/i.test(id)
    ? await db
        .select()
        .from(clients)
        .where(and(eq(clients.id, id), eq(clients.workspaceId, staff.workspaceId)))
        .limit(1)
    : [];
  if (!client) notFound();

  const [people, list] = await Promise.all([
    db.select().from(memberships).where(eq(memberships.clientId, client.id)).orderBy(asc(memberships.createdAt)),
    db.select().from(projects).where(eq(projects.clientId, client.id)).orderBy(asc(projects.deliveryDate)),
  ]);

  return (
    <>
      <TopBar viewer={viewer} />
      <main className="shell page">
        <div className="page-head">
          <div>
            <p className="eyebrow">
              <Link href="/admin">Mission control</Link> / Client
            </p>
            <h1>{client.name}</h1>
          </div>
        </div>
        <Notice error={readMessage(sp.error)} notice={readMessage(sp.notice)} />

        <div className="split">
          <div>
            <section className="card" aria-labelledby="projects-title">
              <div className="card-head">
                <h2 id="projects-title">Projects</h2>
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
                      </tr>
                    </thead>
                    <tbody>
                      {list.map((p) => (
                        <tr key={p.id}>
                          <td>
                            <Link href={`/admin/projects/${p.id}`}>{p.name}</Link>
                            <div className="muted small">{kindLabel(p.kind)}</div>
                          </td>
                          <td>
                            <span className="chip">{STATUS_LABEL[p.status]}</span>
                          </td>
                          <td className="num">{formatDate(p.deliveryDate)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="card" aria-labelledby="new-project">
              <div className="card-head">
                <h2 id="new-project">New project</h2>
              </div>
              <form action={createProject} className="stack">
                <input type="hidden" name="clientId" value={client.id} />
                <div className="form-grid">
                  <div className="field">
                    <label htmlFor="p-name">Project name</label>
                    <input id="p-name" name="name" required maxLength={140} placeholder="e.g. Patient booking portal" />
                  </div>
                  <div className="field">
                    <label htmlFor="p-kind">Type</label>
                    <select id="p-kind" name="kind" defaultValue="web-app">
                      {PROJECT_KINDS.map((k) => (
                        <option key={k.value} value={k.value}>
                          {k.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="p-start">Start date</label>
                    <input id="p-start" name="startedOn" type="date" required defaultValue={todayIso()} />
                  </div>
                  <div className="field">
                    <label htmlFor="p-delivery">Delivery date</label>
                    <input id="p-delivery" name="deliveryDate" type="date" required />
                  </div>
                </div>
                <p className="muted small">
                  Kickoff, halfway review and launch milestones are created for you from these dates.
                </p>
                <div>
                  <button className="btn btn-primary" type="submit">
                    Create project
                  </button>
                </div>
              </form>
            </section>
          </div>

          <aside>
            <section className="card" aria-labelledby="people-title">
              <div className="card-head">
                <h2 id="people-title">People</h2>
              </div>
              {people.length === 0 ? (
                <p className="muted">Nobody from {client.name} has access yet.</p>
              ) : (
                <ul className="task-list">
                  {people.map((m) => (
                    <li key={m.id} style={{ display: "grid", gap: 6 }}>
                      <div className="row" style={{ justifyContent: "space-between" }}>
                        <strong style={{ fontWeight: 500 }}>{m.email}</strong>
                        <span className="chip">{ROLE_LABEL[m.role]}</span>
                      </div>
                      <div className="row">
                        <span className={m.userId ? "chip chip-ok" : "chip chip-amber"}>
                          {m.userId ? "Signed in" : "Invited"}
                        </span>
                        <form action={sendSignInLink}>
                          <input type="hidden" name="membershipId" value={m.id} />
                          <button className="btn btn-link small" type="submit">
                            Email sign-in link
                          </button>
                        </form>
                        <form action={removeMember}>
                          <input type="hidden" name="membershipId" value={m.id} />
                          <button className="btn btn-link small" type="submit">
                            Remove access
                          </button>
                        </form>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="card" aria-labelledby="invite-title">
              <div className="card-head">
                <h2 id="invite-title">Give someone access</h2>
              </div>
              <form action={inviteMember} className="stack">
                <input type="hidden" name="clientId" value={client.id} />
                <div className="field">
                  <label htmlFor="m-email">Email</label>
                  <input id="m-email" name="email" type="email" required placeholder="name@company.com" />
                </div>
                <div className="field">
                  <label htmlFor="m-role">Role</label>
                  <select id="m-role" name="role" defaultValue="client_approver">
                    <option value="client_approver">Approver: can approve reviews and launch</option>
                    <option value="client_member">Team member: can view and comment</option>
                  </select>
                </div>
                <div>
                  <button className="btn btn-primary" type="submit">
                    Add person
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
