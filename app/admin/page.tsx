import { and, asc, count, desc, eq, inArray, isNull, lt, max, ne } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { Notice, readMessage } from "@/components/Notice";
import { TopBar } from "@/components/TopBar";
import { requireStaff } from "@/lib/access";
import { getDb } from "@/lib/db";
import {
  approvals,
  clients,
  documents,
  documentSigners,
  feedback,
  ideas,
  invoices,
  memberships,
  onboardings,
  projects,
  referrals,
  supportRequests,
  tasks,
  updates,
  workspaces,
} from "@/lib/db/schema";
import { daysUntil, describeDaysUntil, formatDate, formatDateTime, formatMoney, kindLabel, nowMs, STATUS_LABEL, todayIso } from "@/lib/format";
import { createClient, saveWorkspaceSettings, setReferralStatus } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Mission control" };

const STALE_UPDATE_DAYS = 7;
const DAY = 86_400_000;

type Attention = { key: string; level: "high" | "normal"; text: string; href: string; when?: Date };

export default async function MissionControl({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const { viewer, staff } = await requireStaff();
  const db = getDb();
  const ws = staff.workspaceId;
  const now = nowMs();
  const today = todayIso();
  const threeDaysAgo = new Date(now - 3 * DAY);

  const [rows, waiting, lastUpdates, clientVisits, openInvoices, unsigned, newRequests, pendingApprovals, openMustFix, warmIdeas, referralList, [workspace]] =
    await Promise.all([
      db
        .select({ client: clients, project: projects })
        .from(clients)
        .leftJoin(projects, eq(projects.clientId, clients.id))
        .where(eq(clients.workspaceId, ws))
        .orderBy(asc(clients.name), asc(projects.deliveryDate)),
      db
        .select({ projectId: tasks.projectId, n: count() })
        .from(tasks)
        .where(and(eq(tasks.workspaceId, ws), eq(tasks.side, "client"), isNull(tasks.doneAt)))
        .groupBy(tasks.projectId),
      db.select({ projectId: updates.projectId, last: max(updates.createdAt) }).from(updates).where(eq(updates.workspaceId, ws)).groupBy(updates.projectId),
      db
        .select({ clientId: memberships.clientId, last: max(memberships.lastSeenAt), people: count() })
        .from(memberships)
        .where(and(eq(memberships.workspaceId, ws), ne(memberships.role, "staff"), ne(memberships.role, "staff_owner")))
        .groupBy(memberships.clientId),
      db.select({ invoice: invoices, project: projects }).from(invoices).innerJoin(projects, eq(projects.id, invoices.projectId)).where(and(eq(invoices.workspaceId, ws), eq(invoices.status, "open"))),
      db
        .select({ doc: documents, pending: count(documentSigners.id) })
        .from(documents)
        .innerJoin(documentSigners, and(eq(documentSigners.documentId, documents.id), ne(documentSigners.status, "signed")))
        .where(and(eq(documents.workspaceId, ws), eq(documents.status, "out_for_signature"), lt(documents.createdAt, threeDaysAgo)))
        .groupBy(documents.id),
      db.select({ request: supportRequests, project: projects }).from(supportRequests).innerJoin(projects, eq(projects.id, supportRequests.projectId)).where(and(eq(supportRequests.workspaceId, ws), eq(supportRequests.status, "new"))),
      db.select({ approval: approvals, project: projects }).from(approvals).innerJoin(projects, eq(projects.id, approvals.projectId)).where(and(eq(approvals.workspaceId, ws), eq(approvals.state, "changes_requested"), lt(approvals.createdAt, new Date()))),
      db.select({ projectId: feedback.projectId, n: count() }).from(feedback).where(and(eq(feedback.workspaceId, ws), eq(feedback.tag, "must_fix"), inArray(feedback.status, ["open", "in_progress"]))).groupBy(feedback.projectId),
      db.select({ idea: ideas, project: projects }).from(ideas).innerJoin(projects, eq(projects.id, ideas.projectId)).where(and(eq(ideas.workspaceId, ws), eq(ideas.status, "interested"))),
      db.select().from(referrals).where(eq(referrals.workspaceId, ws)).orderBy(desc(referrals.createdAt)).limit(20),
      db.select().from(workspaces).where(eq(workspaces.id, ws)).limit(1),
    ]);

  const onboardingRows = await db
    .select({ onboarding: onboardings, client: clients })
    .from(onboardings)
    .innerJoin(projects, eq(projects.id, onboardings.projectId))
    .innerJoin(clients, eq(clients.id, projects.clientId))
    .where(eq(onboardings.workspaceId, ws));
  const waitingBy = new Map(waiting.map((w) => [w.projectId, Number(w.n)]));
  const lastBy = new Map(lastUpdates.map((u) => [u.projectId, u.last]));
  const visitBy = new Map(clientVisits.map((v) => [v.clientId, v]));
  const mustFixBy = new Map(openMustFix.map((f) => [f.projectId, Number(f.n)]));
  const projectById = new Map(rows.flatMap((r) => (r.project ? [[r.project.id, r.project] as const] : [])));

  const grouped = new Map<string, { client: (typeof rows)[number]["client"]; projects: NonNullable<(typeof rows)[number]["project"]>[] }>();
  for (const { client, project } of rows) {
    const entry = grouped.get(client.id) ?? { client, projects: [] };
    if (project) entry.projects.push(project);
    grouped.set(client.id, entry);
  }

  const attention: Attention[] = [
    ...newRequests.map(({ request, project }) => ({
      key: `req-${request.id}`,
      level: request.priority === "urgent" ? ("high" as const) : ("normal" as const),
      text: `${request.priority === "urgent" ? "URGENT request" : "New request"}: ${request.title} (${project.name})`,
      href: `/projects/${project.id}/support#r-${request.id}`,
      when: request.createdAt,
    })),
    ...pendingApprovals.map(({ approval, project }) => ({
      key: `ap-${approval.id}`,
      level: "high" as const,
      text: `Changes requested on ${project.name}${approval.note ? `: “${approval.note.slice(0, 60)}”` : ""}`,
      href: `/projects/${project.id}/review`,
      when: approval.decidedAt ?? approval.createdAt,
    })),
    ...openInvoices
      .filter(({ invoice }) => invoice.dueOn < today)
      .map(({ invoice, project }) => ({
        key: `inv-${invoice.id}`,
        level: "high" as const,
        text: `Overdue: invoice ${invoice.number} ${formatMoney(invoice.amountCents, invoice.currency)} (${project.name})`,
        href: `/projects/${project.id}/billing`,
      })),
    ...unsigned.map(({ doc, pending }) => ({
      key: `doc-${doc.id}`,
      level: "normal" as const,
      text: `${doc.title}: ${pending} signature${Number(pending) === 1 ? "" : "s"} outstanding for 3+ days`,
      href: `/projects/${doc.projectId}/documents/${doc.id}`,
      when: doc.createdAt,
    })),
    ...warmIdeas.map(({ idea, project }) => ({
      key: `idea-${idea.id}`,
      level: "high" as const,
      text: `Warm lead: ${project.name} is interested in “${idea.title}”`,
      href: `/projects/${project.id}/results#ideas`,
      when: idea.respondedAt ?? idea.createdAt,
    })),
    ...[...mustFixBy.entries()].map(([projectId, n]) => ({
      key: `fix-${projectId}`,
      level: "normal" as const,
      text: `${n} must-fix comment${n === 1 ? "" : "s"} open on ${projectById.get(projectId)?.name ?? "a project"}`,
      href: `/projects/${projectId}/review`,
    })),
    ...onboardingRows.flatMap(({ onboarding: o, client }) => {
      const items: Attention[] = [];
      const idle = Math.floor((now - (o.lastActivityAt ?? o.welcomeSentAt ?? o.createdAt).getTime()) / DAY);
      if (!o.welcomeSentAt) {
        items.push({ key: `ob-draft-${o.id}`, level: "high", text: `Welcome not sent yet: ${client.name}`, href: `/admin/onboard/${o.projectId}`, when: o.createdAt });
      } else if (o.status === "completed" && o.completedAt && now - o.completedAt.getTime() < 7 * DAY) {
        items.push({ key: `ob-done-${o.id}`, level: "normal", text: `Brief ready: ${client.name} finished onboarding`, href: `/admin/projects/${o.projectId}/brief`, when: o.completedAt });
      } else if (o.status !== "completed" && idle >= 3) {
        items.push({ key: `ob-idle-${o.id}`, level: idle >= 5 ? "high" : "normal", text: `${client.name} paused onboarding ${idle} days ago`, href: `/admin/onboard`, when: o.lastActivityAt ?? o.createdAt });
      }
      if (o.recapConfirmed === false && o.status !== "completed") {
        items.push({ key: `ob-recap-${o.id}`, level: "high", text: `${client.name} added to the call recap`, href: `/admin/projects/${o.projectId}/brief` });
      }
      return items;
    }),
    ...referralList
      .filter((r) => r.status === "new")
      .map((r) => ({ key: `ref-${r.id}`, level: "high" as const, text: `New referral: ${r.name} (${r.email})`, href: "#referrals", when: r.createdAt })),
  ];

  const outstanding = openInvoices.reduce((s, { invoice }) => s + invoice.amountCents, 0);
  const activeProjects = [...projectById.values()].filter((p) => p.status !== "launched" && p.status !== "paused").length;

  /** 0–100: recent client visits, fresh updates, nothing overdue. */
  function health(clientId: string, list: NonNullable<(typeof rows)[number]["project"]>[]) {
    let score = 100;
    const reasons: string[] = [];
    const visit = visitBy.get(clientId)?.last;
    const daysAway = visit ? Math.floor((now - new Date(visit).getTime()) / DAY) : null;
    if (daysAway === null) {
      score -= 30;
      reasons.push("never signed in");
    } else if (daysAway > 21) {
      score -= 30;
      reasons.push(`no visit in ${daysAway} days`);
    } else if (daysAway > 10) {
      score -= 15;
      reasons.push(`last visit ${daysAway} days ago`);
    }
    for (const p of list) {
      const last = lastBy.get(p.id);
      if (p.status !== "launched" && p.status !== "paused" && (!last || now - new Date(last).getTime() > STALE_UPDATE_DAYS * DAY)) {
        score -= 15;
        reasons.push(`no update on ${p.name}`);
      }
      if (daysUntil(p.deliveryDate) < 0 && p.status !== "launched") {
        score -= 20;
        reasons.push(`${p.name} past delivery`);
      }
    }
    const overdue = openInvoices.filter(({ invoice, project }) => project.clientId === clientId && invoice.dueOn < today).length;
    if (overdue) {
      score -= 15;
      reasons.push("overdue invoice");
    }
    score = Math.max(0, score);
    return { score, level: score >= 75 ? "good" : score >= 50 ? "watch" : "risk", reasons };
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
          <Link className="btn btn-primary" href="/admin/onboard">
            Onboard a new client →
          </Link>
        </div>
        <Notice error={readMessage(sp.error)} notice={readMessage(sp.notice)} />

        <section className="kpi-row" aria-label="At a glance">
          <div className="kpi">
            <p className="label">Needs attention</p>
            <p className="kpi-value">{attention.length}</p>
          </div>
          <div className="kpi">
            <p className="label">Active builds</p>
            <p className="kpi-value">{activeProjects}</p>
          </div>
          <div className="kpi">
            <p className="label">Outstanding</p>
            <p className="kpi-value">{formatMoney(outstanding)}</p>
          </div>
          <div className="kpi">
            <p className="label">Clients</p>
            <p className="kpi-value">{grouped.size}</p>
          </div>
        </section>

        <div className="split">
          <div>
            <section className="card card-todo" aria-labelledby="attention-title">
              <div className="card-head">
                <h2 id="attention-title">Needs attention</h2>
                {attention.length > 0 && <span className="chip chip-amber">{attention.length}</span>}
              </div>
              {attention.length === 0 ? (
                <p className="all-clear">
                  <span aria-hidden="true">✓</span> Nothing waiting on SKOX. Go build something.
                </p>
              ) : (
                <ul className="attention-list">
                  {attention.map((a) => (
                    <li key={a.key} data-level={a.level}>
                      <Link href={a.href}>{a.text}</Link>
                      {a.when && <span className="when small muted">{formatDateTime(a.when)}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {grouped.size === 0 ? (
              <p className="empty" style={{ marginTop: 16 }}>
                No clients yet. Add your first one.
              </p>
            ) : (
              [...grouped.values()].map(({ client, projects: list }) => {
                const h = health(client.id, list);
                return (
                  <section key={client.id} className="card client-block" aria-labelledby={`client-${client.id}`} style={{ marginTop: 16 }}>
                    <div className="card-head">
                      <h2 id={`client-${client.id}`}>
                        <Link href={`/admin/clients/${client.id}`}>{client.name}</Link>
                      </h2>
                      <div className="row">
                        <span className="health" data-level={h.level} title={h.reasons.join(", ") || "All good"}>
                          Health {h.score}
                        </span>
                        <Link className="btn btn-ghost btn-small" href={`/admin/clients/${client.id}`}>
                          People &amp; projects
                        </Link>
                      </div>
                    </div>
                    {h.reasons.length > 0 && <p className="small muted" style={{ marginTop: -6, marginBottom: 10 }}>{h.reasons.join(" · ")}</p>}
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
                              <th>Signals</th>
                            </tr>
                          </thead>
                          <tbody>
                            {list.map((p) => {
                              const waitingOnClient = waitingBy.get(p.id) ?? 0;
                              const last = lastBy.get(p.id);
                              const stale =
                                p.status !== "launched" &&
                                p.status !== "paused" &&
                                (!last || now - new Date(last).getTime() > STALE_UPDATE_DAYS * DAY);
                              const days = daysUntil(p.deliveryDate);
                              const late = days < 0 && p.status !== "launched";
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
                                    {p.status === "launched" ? "Live" : formatDate(p.deliveryDate)}
                                    {p.status !== "launched" && <div className="muted small">{describeDaysUntil(days)}</div>}
                                  </td>
                                  <td>
                                    <div className="row">
                                      {stale && <span className="chip chip-danger">No update {STALE_UPDATE_DAYS}d+</span>}
                                      {waitingOnClient > 0 && <span className="chip chip-amber">{waitingOnClient} on client</span>}
                                      {late && <span className="chip chip-danger">Past delivery</span>}
                                      {!stale && waitingOnClient === 0 && !late && <span className="chip chip-ok">On track</span>}
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
                );
              })
            )}
          </div>

          <aside>
            <section className="card" aria-labelledby="new-client">
              <div className="card-head">
                <h2 id="new-client">Add a client</h2>
              </div>
              <form action={createClient} className="stack">
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

            <section className="card" id="referrals" aria-labelledby="referrals-title">
              <div className="card-head">
                <h2 id="referrals-title">Referrals</h2>
                <span className="muted small">{referralList.length}</span>
              </div>
              {referralList.length === 0 ? (
                <p className="small muted">Clients get a personal referral link on their Results page. Leads land here.</p>
              ) : (
                <ul className="task-list">
                  {referralList.map((r) => (
                    <li key={r.id} style={{ display: "grid", gap: 6 }}>
                      <div>
                        <strong style={{ fontWeight: 500 }}>{r.name}</strong>{" "}
                        <a className="small" href={`mailto:${r.email}`}>
                          {r.email}
                        </a>
                        <p className="small muted">
                          {r.company ? `${r.company} · ` : ""}via {r.referrerEmail} · {formatDateTime(r.createdAt)}
                        </p>
                        {r.idea && <p className="small">{r.idea}</p>}
                      </div>
                      <form action={setReferralStatus} className="inline-form">
                        <input type="hidden" name="referralId" value={r.id} />
                        <select name="status" defaultValue={r.status} aria-label="Referral status">
                          <option value="new">New</option>
                          <option value="contacted">Contacted</option>
                          <option value="won">Won</option>
                          <option value="lost">Lost</option>
                        </select>
                        <button className="btn btn-ghost btn-small" type="submit">
                          Save
                        </button>
                      </form>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="card" aria-labelledby="settings-title">
              <div className="card-head">
                <h2 id="settings-title">Workspace settings</h2>
              </div>
              <form action={saveWorkspaceSettings} className="stack">
                <div className="field">
                  <label htmlFor="ws-scheduling">Kickoff booking link</label>
                  <input id="ws-scheduling" name="schedulingUrl" type="url" defaultValue={workspace?.schedulingUrl ?? ""} placeholder="https://cal.com/skox/kickoff" />
                  <span className="hint">New clients book kickoff from their welcome flow.</span>
                </div>
                <div className="field">
                  <label htmlFor="ws-intro">Team intro</label>
                  <input id="ws-intro" name="teamIntro" defaultValue={workspace?.teamIntro ?? ""} maxLength={120} placeholder="Josh & Sam, co-founders" />
                  <span className="hint">Signs the welcome note and emails.</span>
                </div>
                <div className="field">
                  <label htmlFor="ws-video">Welcome video (optional)</label>
                  <input id="ws-video" name="welcomeVideoUrl" type="url" defaultValue={workspace?.welcomeVideoUrl ?? ""} placeholder="https://www.loom.com/share/…" />
                  <span className="hint">Leave empty until you record one. Nothing shows without it.</span>
                </div>
                <div className="field">
                  <label htmlFor="ws-review">Review link</label>
                  <input id="ws-review" name="reviewUrl" type="url" defaultValue={workspace?.reviewUrl ?? ""} placeholder="https://g.page/r/…/review" />
                  <span className="hint">Launched clients see “Leave us a quick review”.</span>
                </div>
                <div className="field">
                  <label htmlFor="ws-reward">Referral reward</label>
                  <input id="ws-reward" name="referralReward" defaultValue={workspace?.referralReward ?? ""} maxLength={160} placeholder="you get $500 off your next invoice" />
                  <span className="hint">Reads as: “When they start a project, …”</span>
                </div>
                <div>
                  <button className="btn btn-ghost btn-small" type="submit">
                    Save
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
