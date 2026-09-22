import { and, asc, desc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Notice, readMessage } from "@/components/Notice";
import { TopBar } from "@/components/TopBar";
import { requireStaff } from "@/lib/access";
import {
  ALL_STAGES,
  BOARD_STAGES,
  daysInStage,
  formatDealValue,
  formatShortDate,
  initialsFor,
  PRICING_LABEL,
  STAGE_LABEL,
} from "@/lib/crm";
import { staffList } from "@/lib/crm-data";
import { getDb } from "@/lib/db";
import { clients, contacts, crmActivities, deals, emailThreads, memberships, milestones, projects } from "@/lib/db/schema";
import { formatDate, kindLabel, PROJECT_KINDS, ROLE_LABEL, STATUS_LABEL, todayIso } from "@/lib/format";
import { createProject, inviteMember, removeMember } from "../../actions";
import {
  addContact,
  addNote,
  completeNextAction,
  createDeal,
  makePrimaryContact,
  moveDealStageForm,
  saveClientProfile,
  startThread,
  updateDeal,
} from "../../crm-actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Client" };

const ACTIVITY_LABEL = { note: "Note", call: "Call", meeting: "Meeting", stage_change: "Stage", email: "Email" } as const;

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

  const [people, list, dealList, contactList, activity, threads, team] = await Promise.all([
    db.select().from(memberships).where(eq(memberships.clientId, client.id)).orderBy(asc(memberships.createdAt)),
    db.select().from(projects).where(eq(projects.clientId, client.id)).orderBy(asc(projects.deliveryDate)),
    db.select().from(deals).where(eq(deals.clientId, client.id)).orderBy(desc(deals.createdAt)),
    db.select().from(contacts).where(eq(contacts.clientId, client.id)).orderBy(desc(contacts.isPrimary), asc(contacts.createdAt)),
    db.select().from(crmActivities).where(eq(crmActivities.clientId, client.id)).orderBy(desc(crmActivities.createdAt)).limit(100),
    db.select().from(emailThreads).where(eq(emailThreads.clientId, client.id)).orderBy(desc(emailThreads.lastMessageAt)).limit(10),
    staffList(staff.workspaceId),
  ]);

  // Pages take a deal id; with none, show the newest deal that is still live.
  const wanted = typeof sp.deal === "string" ? sp.deal : null;
  const deal = dealList.find((d) => d.id === wanted) ?? dealList.find((d) => d.stage !== "lost") ?? dealList[0] ?? null;
  const project = deal?.projectId ? list.find((p) => p.id === deal.projectId) ?? null : null;
  const build = project
    ? await db.select().from(milestones).where(eq(milestones.projectId, project.id)).orderBy(asc(milestones.position), asc(milestones.dueOn))
    : [];
  const primary = contactList.find((c) => c.isPrimary) ?? contactList[0] ?? null;
  const stageIndex = deal ? BOARD_STAGES.indexOf(deal.stage as (typeof BOARD_STAGES)[number]) : -1;
  const days = deal ? daysInStage(deal.stageEnteredAt) : 0;
  const shownActivity = activity.filter((a) => !deal || !a.dealId || a.dealId === deal.id);
  const here = deal ? `/admin/clients/${client.id}?deal=${deal.id}` : `/admin/clients/${client.id}`;

  return (
    <>
      <TopBar viewer={viewer} current="clients" />
      <main className="shell page" style={{ width: "min(1320px, calc(100% - 48px))" }}>
        <div className="page-head">
          <div>
            <p className="eyebrow">
              <Link href="/admin/clients">Clients</Link>
              {client.industry ? ` / ${client.industry}` : ""}
            </p>
            <h1>{client.name}</h1>
          </div>
          {dealList.length > 1 && (
            <nav className="crm-filters" aria-label="Deals for this client">
              {dealList.map((d) => (
                <Link key={d.id} href={`/admin/clients/${client.id}?deal=${d.id}`} aria-current={d.id === deal?.id ? "page" : undefined}>
                  {d.title} · {STAGE_LABEL[d.stage]}
                </Link>
              ))}
            </nav>
          )}
        </div>
        <Notice error={readMessage(sp.error)} notice={readMessage(sp.notice)} />

        <div className="crm-detail">
          {/* ---- Left: who and what ---- */}
          <aside>
            <section className="card" aria-labelledby="contacts-title">
              <div className="card-head">
                <h2 id="contacts-title">Contacts</h2>
              </div>
              {contactList.length === 0 ? (
                <p className="small muted">No contacts yet. Add one so their email files itself here.</p>
              ) : (
                <ul className="contact-list">
                  {contactList.map((c) => (
                    <li key={c.id}>
                      <div className="row" style={{ justifyContent: "space-between" }}>
                        <strong style={{ fontWeight: 600 }}>{c.name}</strong>
                        {c.isPrimary ? (
                          <span className="chip chip-amber">Main</span>
                        ) : (
                          <form action={makePrimaryContact}>
                            <input type="hidden" name="contactId" value={c.id} />
                            <input type="hidden" name="dealId" value={deal?.id ?? ""} />
                            <button className="btn btn-link small" type="submit">
                              Make main
                            </button>
                          </form>
                        )}
                      </div>
                      {c.role && <div className="small muted">{c.role}</div>}
                      {c.email && <div className="small">{c.email}</div>}
                      {c.phone && <div className="small money">{c.phone}</div>}
                    </li>
                  ))}
                </ul>
              )}
              <details className="crm-edit" style={{ marginTop: 12 }}>
                <summary>Add a contact</summary>
                <form action={addContact} className="stack">
                  <input type="hidden" name="clientId" value={client.id} />
                  <input type="hidden" name="dealId" value={deal?.id ?? ""} />
                  <div className="field">
                    <label htmlFor="c-name">Name</label>
                    <input id="c-name" name="name" required maxLength={120} />
                  </div>
                  <div className="field">
                    <label htmlFor="c-role">Role</label>
                    <input id="c-role" name="role" maxLength={120} />
                  </div>
                  <div className="field">
                    <label htmlFor="c-email">Email</label>
                    <input id="c-email" name="email" type="email" maxLength={254} />
                  </div>
                  <div className="field">
                    <label htmlFor="c-phone">Phone</label>
                    <input id="c-phone" name="phone" maxLength={40} />
                  </div>
                  <div>
                    <button className="btn btn-ghost btn-small" type="submit">
                      Add contact
                    </button>
                  </div>
                </form>
              </details>
            </section>

            {deal && (
              <section className="card" aria-labelledby="deal-title">
                <p className="label" id="deal-title">
                  Engagement
                </p>
                <p className="deal-value">{formatDealValue(deal.valueCents)}</p>
                <dl className="kv">
                  <dt>Deal</dt>
                  <dd>{deal.title}</dd>
                  <dt>Type</dt>
                  <dd>{deal.kind ?? "—"}</dd>
                  <dt>Pricing</dt>
                  <dd>{PRICING_LABEL[deal.pricing]}</dd>
                  <dt>Scope</dt>
                  <dd>{deal.scope ?? "—"}</dd>
                  <dt>Owner</dt>
                  <dd>{deal.ownerEmail ?? "—"}</dd>
                  <dt>Project</dt>
                  <dd>{project ? <Link href={`/admin/projects/${project.id}`}>{project.name}</Link> : "Not linked"}</dd>
                  <dt>Delivery</dt>
                  <dd className="money">{project ? formatDate(project.deliveryDate) : "—"}</dd>
                  {deal.stage === "lost" && (
                    <>
                      <dt>Lost</dt>
                      <dd>{deal.lostReason ?? "No reason noted"}</dd>
                    </>
                  )}
                </dl>
                <details className="crm-edit" style={{ marginTop: 14 }}>
                  <summary>Edit deal</summary>
                  <form action={updateDeal} className="stack">
                    <input type="hidden" name="dealId" value={deal.id} />
                    <div className="field">
                      <label htmlFor="d-title">Deal</label>
                      <input id="d-title" name="title" required maxLength={140} defaultValue={deal.title} />
                    </div>
                    <div className="field">
                      <label htmlFor="d-kind">Type</label>
                      <input id="d-kind" name="kind" maxLength={60} defaultValue={deal.kind ?? ""} />
                    </div>
                    <div className="field">
                      <label htmlFor="d-value">Value ($)</label>
                      <input id="d-value" name="value" inputMode="decimal" maxLength={20} defaultValue={String(deal.valueCents / 100)} />
                    </div>
                    <div className="field">
                      <label htmlFor="d-pricing">Pricing</label>
                      <select id="d-pricing" name="pricing" defaultValue={deal.pricing}>
                        {Object.entries(PRICING_LABEL).map(([k, v]) => (
                          <option key={k} value={k}>
                            {v}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="field">
                      <label htmlFor="d-scope">Scope</label>
                      <textarea id="d-scope" name="scope" maxLength={2000} defaultValue={deal.scope ?? ""} />
                    </div>
                    <div className="field">
                      <label htmlFor="d-owner">Owner</label>
                      <select id="d-owner" name="ownerId" defaultValue={deal.ownerId ?? ""}>
                        <option value="">No owner</option>
                        {team.map((m) => (
                          <option key={m.userId} value={m.userId}>
                            {m.email}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="field">
                      <label htmlFor="d-project">Portal project</label>
                      <select id="d-project" name="projectId" defaultValue={deal.projectId ?? ""}>
                        <option value="">Not linked</option>
                        {list.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                      <span className="hint">Once won, link the project so milestones and delivery show here.</span>
                    </div>
                    <div className="field">
                      <label htmlFor="d-next">Next action</label>
                      <input id="d-next" name="nextAction" maxLength={300} defaultValue={deal.nextAction ?? ""} />
                    </div>
                    <div className="field">
                      <label htmlFor="d-next-on">Next action due</label>
                      <input id="d-next-on" name="nextActionOn" type="date" defaultValue={deal.nextActionOn ?? ""} />
                    </div>
                    <div className="field">
                      <label htmlFor="d-lost">Lost reason</label>
                      <input id="d-lost" name="lostReason" maxLength={300} defaultValue={deal.lostReason ?? ""} />
                    </div>
                    <div>
                      <button className="btn btn-primary btn-small" type="submit">
                        Save deal
                      </button>
                    </div>
                  </form>
                </details>
              </section>
            )}

            <section className="card" aria-labelledby="profile-title">
              <div className="card-head">
                <h2 id="profile-title">Company</h2>
              </div>
              <dl className="kv">
                <dt>Industry</dt>
                <dd>{client.industry ?? "—"}</dd>
                <dt>Location</dt>
                <dd>{client.location ?? "—"}</dd>
                <dt>Website</dt>
                <dd>
                  {client.website ? (
                    <a href={client.website} target="_blank" rel="noreferrer">
                      {client.website.replace(/^https?:\/\//, "")}
                    </a>
                  ) : (
                    "—"
                  )}
                </dd>
                <dt>Source</dt>
                <dd>{client.source ?? "—"}</dd>
              </dl>
              <details className="crm-edit" style={{ marginTop: 14 }}>
                <summary>Edit company</summary>
                <form action={saveClientProfile} className="stack">
                  <input type="hidden" name="clientId" value={client.id} />
                  <input type="hidden" name="dealId" value={deal?.id ?? ""} />
                  <div className="field">
                    <label htmlFor="cp-industry">Industry</label>
                    <input id="cp-industry" name="industry" maxLength={120} defaultValue={client.industry ?? ""} />
                  </div>
                  <div className="field">
                    <label htmlFor="cp-location">Location</label>
                    <input id="cp-location" name="location" maxLength={120} defaultValue={client.location ?? ""} />
                  </div>
                  <div className="field">
                    <label htmlFor="cp-website">Website</label>
                    <input id="cp-website" name="website" type="url" maxLength={2048} defaultValue={client.website ?? ""} placeholder="https://" />
                  </div>
                  <div className="field">
                    <label htmlFor="cp-source">Source</label>
                    <input id="cp-source" name="source" maxLength={120} defaultValue={client.source ?? ""} />
                  </div>
                  <div>
                    <button className="btn btn-ghost btn-small" type="submit">
                      Save
                    </button>
                  </div>
                </form>
              </details>
            </section>
          </aside>

          {/* ---- Centre: where it stands and what happened ---- */}
          <div>
            {deal ? (
              <section className="card" aria-label="Stage">
                <ol className="stage-track">
                  {BOARD_STAGES.map((s, i) => (
                    <li key={s} data-state={deal.stage === "lost" ? undefined : i < stageIndex ? "done" : i === stageIndex ? "now" : undefined}>
                      {STAGE_LABEL[s]}
                      {i === stageIndex ? ` · ${days}d` : ""}
                    </li>
                  ))}
                </ol>
                <form action={moveDealStageForm} className="inline-form" style={{ marginTop: 14 }}>
                  <input type="hidden" name="dealId" value={deal.id} />
                  <label className="small" htmlFor="move-stage">
                    Stage
                  </label>
                  <select id="move-stage" name="stage" defaultValue={deal.stage}>
                    {ALL_STAGES.map((s) => (
                      <option key={s} value={s}>
                        {STAGE_LABEL[s]}
                      </option>
                    ))}
                  </select>
                  <button className="btn btn-ghost btn-small" type="submit">
                    Move
                  </button>
                  {deal.stage === "lost" && <span className="chip chip-danger">Lost</span>}
                </form>
              </section>
            ) : (
              <section className="card" aria-labelledby="first-deal">
                <div className="card-head">
                  <h2 id="first-deal">No deal yet</h2>
                </div>
                <form action={createDeal} className="form-grid">
                  <input type="hidden" name="clientId" value={client.id} />
                  <input type="hidden" name="back" value={here} />
                  <div className="field">
                    <label htmlFor="fd-title">Deal</label>
                    <input id="fd-title" name="title" required maxLength={140} placeholder="What are we selling them?" />
                  </div>
                  <div className="field">
                    <label htmlFor="fd-value">Value ($)</label>
                    <input id="fd-value" name="value" inputMode="decimal" maxLength={20} />
                  </div>
                  <div>
                    <button className="btn btn-primary" type="submit">
                      Start deal
                    </button>
                  </div>
                </form>
              </section>
            )}

            <section className="card" aria-labelledby="activity-title">
              <div className="card-head">
                <h2 id="activity-title">Activity</h2>
                <span className="small muted">Notes, email and stage moves</span>
              </div>
              <form action={addNote} className="stack" style={{ marginBottom: 18 }}>
                <input type="hidden" name="clientId" value={client.id} />
                <input type="hidden" name="dealId" value={deal?.id ?? ""} />
                <div className="field">
                  <label htmlFor="note-body">Add to the timeline</label>
                  <textarea id="note-body" name="body" required maxLength={5000} placeholder="Call notes, decisions, anything the other founder should know" />
                </div>
                <div className="inline-form" style={{ justifyContent: "space-between" }}>
                  <label className="sr-only" htmlFor="note-type">
                    Type
                  </label>
                  <select id="note-type" name="type" defaultValue="note">
                    <option value="note">Note</option>
                    <option value="call">Call</option>
                    <option value="meeting">Meeting</option>
                  </select>
                  <button className="btn btn-primary btn-small" type="submit">
                    Save
                  </button>
                </div>
              </form>
              {shownActivity.length === 0 ? (
                <p className="small muted">Nothing yet.</p>
              ) : (
                <ol className="timeline">
                  {shownActivity.map((a) => {
                    const threadId = typeof a.meta.threadId === "string" ? a.meta.threadId : null;
                    const direction = a.meta.direction === "outbound" ? "Sent" : a.meta.direction === "inbound" ? "Received" : null;
                    return (
                      <li key={a.id}>
                        <div className="timeline-when">{formatShortDate(a.createdAt)}</div>
                        <div className="timeline-body" data-type={a.type}>
                          <div className="timeline-type">
                            {ACTIVITY_LABEL[a.type]}
                            {direction ? ` · ${direction}` : ""}
                            {a.actorEmail ? ` · ${initialsFor(a.actorEmail)}` : ""}
                          </div>
                          <div className="timeline-text">
                            {threadId ? <Link href={`/admin/inbox/${threadId}`}>{a.body || "(no subject)"}</Link> : a.body}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </section>

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
              <details className="crm-edit" style={{ marginTop: 14 }}>
                <summary>New project</summary>
                <form action={createProject} className="stack">
                  <input type="hidden" name="clientId" value={client.id} />
                  <div className="form-grid">
                    <div className="field">
                      <label htmlFor="p-name">Project name</label>
                      <input id="p-name" name="name" required maxLength={140} placeholder="e.g. Patient booking portal" defaultValue={deal?.title ?? ""} />
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
                    Kickoff, halfway review and launch milestones are created for you from these dates. Then link it to the deal
                    under Edit deal.
                  </p>
                  <div>
                    <button className="btn btn-primary" type="submit">
                      Create project
                    </button>
                  </div>
                </form>
              </details>
            </section>
          </div>

          {/* ---- Right: what's next ---- */}
          <aside>
            {deal && (
              <section className="card next-action" aria-labelledby="next-title">
                <p className="label" id="next-title">
                  Next action
                </p>
                <p className="next-text">{deal.nextAction ?? "Nothing set. Add one under Edit deal."}</p>
                {deal.nextActionOn && <p className="small" style={{ marginTop: -6, marginBottom: 12 }}>Due {formatDate(deal.nextActionOn)}</p>}
                {deal.nextAction && (
                  <form action={completeNextAction}>
                    <input type="hidden" name="dealId" value={deal.id} />
                    <button className="btn btn-primary btn-small" type="submit">
                      Mark done
                    </button>
                  </form>
                )}
              </section>
            )}

            {project && (
              <section className="card" aria-labelledby="build-title">
                <div className="card-head">
                  <h2 id="build-title">Build</h2>
                  <span className="small money">
                    {build.filter((m) => m.state === "done").length}/{build.length}
                  </span>
                </div>
                {build.length > 0 && (
                  <div className="deal-progress">
                    <span style={{ width: `${(build.filter((m) => m.state === "done").length / build.length) * 100}%` }} />
                  </div>
                )}
                <ul className="checklist">
                  {build.map((m) => (
                    <li key={m.id} data-done={m.state === "done"}>
                      <span aria-hidden="true">{m.state === "done" ? "✓" : m.state === "in_progress" ? "◐" : "○"}</span>
                      <span>{m.title}</span>
                      {m.dueOn && <span className="small muted money" style={{ marginLeft: "auto" }}>{formatDate(m.dueOn)}</span>}
                    </li>
                  ))}
                </ul>
                <p className="small muted" style={{ marginTop: 12 }}>
                  The client sees these in the portal. <Link href={`/admin/projects/${project.id}`}>Update milestones</Link>
                  {project.liveUrl && (
                    <>
                      {" · "}
                      <a href={project.liveUrl} target="_blank" rel="noreferrer">
                        Live site
                      </a>
                    </>
                  )}
                </p>
              </section>
            )}

            <section className="card" aria-labelledby="email-title">
              <div className="card-head">
                <h2 id="email-title">Email</h2>
              </div>
              {threads.length === 0 ? (
                <p className="small muted">No email yet.</p>
              ) : (
                <ul className="contact-list">
                  {threads.map((t) => (
                    <li key={t.id}>
                      <Link href={`/admin/inbox/${t.id}`}>{t.subject || "(no subject)"}</Link>
                      <div className="small muted">
                        {t.counterpartName ?? t.counterpartEmail} · {formatShortDate(t.lastMessageAt)}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {contactList.some((c) => c.email) && (
                <details className="crm-edit" style={{ marginTop: 12 }}>
                  <summary>New email</summary>
                  <form action={startThread} className="stack">
                    <input type="hidden" name="dealId" value={deal?.id ?? ""} />
                    <div className="field">
                      <label htmlFor="t-to">To</label>
                      <select id="t-to" name="contactId" defaultValue={primary?.email ? primary.id : undefined}>
                        {contactList
                          .filter((c) => c.email)
                          .map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name} ({c.email})
                            </option>
                          ))}
                      </select>
                    </div>
                    <div className="field">
                      <label htmlFor="t-subject">Subject</label>
                      <input id="t-subject" name="subject" maxLength={200} required />
                    </div>
                    <div>
                      <button className="btn btn-ghost btn-small" type="submit">
                        Write it
                      </button>
                    </div>
                  </form>
                </details>
              )}
            </section>

            <section className="card" aria-labelledby="people-title">
              <div className="card-head">
                <h2 id="people-title">Portal access</h2>
              </div>
              {people.length === 0 ? (
                <p className="muted small">Nobody from {client.name} can sign in yet.</p>
              ) : (
                <ul className="task-list">
                  {people.map((m) => (
                    <li key={m.id} style={{ display: "grid", gap: 6 }}>
                      <div className="row" style={{ justifyContent: "space-between" }}>
                        <strong style={{ fontWeight: 500, overflowWrap: "anywhere" }}>{m.email}</strong>
                        <span className="chip">{ROLE_LABEL[m.role]}</span>
                      </div>
                      <div className="row">
                        <span className={m.userId ? "chip chip-ok" : "chip chip-amber"}>{m.userId ? "Signed in" : "Invited"}</span>
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
              <details className="crm-edit" style={{ marginTop: 12 }}>
                <summary>Give someone access</summary>
                <form action={inviteMember} className="stack">
                  <input type="hidden" name="clientId" value={client.id} />
                  <div className="field">
                    <label htmlFor="m-email">Email</label>
                    <input id="m-email" name="email" type="email" required placeholder="name@company.com" defaultValue={primary?.email ?? ""} />
                  </div>
                  <div className="field">
                    <label htmlFor="m-role">Role</label>
                    <select id="m-role" name="role" defaultValue="client_approver">
                      <option value="client_approver">Approver: can approve reviews and launch</option>
                      <option value="client_member">Team member: can view and comment</option>
                    </select>
                  </div>
                  <div>
                    <button className="btn btn-primary btn-small" type="submit">
                      Add person
                    </button>
                  </div>
                </form>
              </details>
            </section>
          </aside>
        </div>
      </main>
    </>
  );
}
