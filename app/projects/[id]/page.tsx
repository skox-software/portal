import { and, asc, desc, eq, gt, isNotNull, isNull, ne } from "drizzle-orm";
import { PORTAL_URL } from "@/lib/brand";
import { startSteps } from "@/lib/onboarding";
import { progress, stepsFor } from "@/lib/onboarding-flow";
import type { Metadata } from "next";
import Link from "next/link";
import { after } from "next/server";
import { ProgressRing } from "@/components/ProgressRing";
import { SubmitButton } from "@/components/SubmitButton";
import { ProjectHeader } from "@/components/ProjectHeader";
import { VideoEmbed } from "@/components/VideoEmbed";
import { readMessage } from "@/components/Notice";
import { summarizeSince } from "@/lib/activity";
import { getDb } from "@/lib/db";
import {
  approvals,
  dateChanges,
  documents,
  documentSigners,
  events,
  ideas,
  invoices,
  memberships,
  milestones,
  onboardings,
  previews,
  supportRequests,
  tasks,
  updates,
} from "@/lib/db/schema";
import {
  daysUntil,
  describeDaysUntil,
  firstName,
  formatDate,
  formatDateTime,
  formatMoney,
  greeting,
  MILESTONE_STATE_LABEL,
  ROLE_LABEL,
} from "@/lib/format";
import { can } from "@/lib/permissions";
import { loadProjectShell } from "@/lib/project-shell";
import { completeClientTask, inviteTeammate, removeTeammate } from "./actions";
import { createShareLink, revokeShareLinks } from "./results/actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Overview" };

type Todo = { key: string; title: string; detail?: string; href?: string; cta?: string; taskId?: string; urgent?: boolean };

export default async function ProjectHome({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const shell = await loadProjectShell(id);
  const { viewer, project, access } = shell;
  const db = getDb();
  const clientMembership = viewer.memberships.find((m) => m.clientId === project.clientId);
  const since = clientMembership?.lastSeenAt ?? null;

  const [steps, openTasks, recentUpdates, changes, toSign, openApprovals, openInvoices, waitingRequests, newIdeas, recentEvents] =
    await Promise.all([
      db.select().from(milestones).where(eq(milestones.projectId, project.id)).orderBy(asc(milestones.position), asc(milestones.dueOn)),
      db.select().from(tasks).where(and(eq(tasks.projectId, project.id), isNull(tasks.doneAt))).orderBy(asc(tasks.dueOn)),
      db
        .select({ update: updates, preview: previews })
        .from(updates)
        .leftJoin(previews, eq(previews.id, updates.previewId))
        .where(eq(updates.projectId, project.id))
        .orderBy(desc(updates.createdAt))
        .limit(4),
      db.select().from(dateChanges).where(eq(dateChanges.projectId, project.id)).orderBy(desc(dateChanges.createdAt)).limit(1),
      db
        .select({ doc: documents })
        .from(documentSigners)
        .innerJoin(documents, eq(documents.id, documentSigners.documentId))
        .where(
          and(
            eq(documents.projectId, project.id),
            eq(documents.status, "out_for_signature"),
            eq(documentSigners.email, viewer.email),
            ne(documentSigners.status, "signed"),
          ),
        ),
      db
        .select({ approval: approvals, preview: previews })
        .from(approvals)
        .leftJoin(previews, eq(previews.id, approvals.previewId))
        .where(and(eq(approvals.projectId, project.id), eq(approvals.state, "requested"))),
      db.select().from(invoices).where(and(eq(invoices.projectId, project.id), eq(invoices.status, "open"))).orderBy(asc(invoices.dueOn)),
      db
        .select()
        .from(supportRequests)
        .where(and(eq(supportRequests.projectId, project.id), eq(supportRequests.status, "waiting_on_client"))),
      db.select().from(ideas).where(and(eq(ideas.projectId, project.id), eq(ideas.status, "proposed"))),
      since
        ? db
            .select()
            .from(events)
            .where(and(eq(events.projectId, project.id), gt(events.createdAt, since), ne(events.actorId, viewer.userId)))
            .orderBy(desc(events.createdAt))
            .limit(40)
        : Promise.resolve([]),
    ]);

  const [depositRow] = await db
    .select({ invoice: invoices, doc: documents })
    .from(invoices)
    .leftJoin(documents, eq(documents.id, invoices.documentId))
    .where(and(eq(invoices.projectId, project.id), ne(invoices.status, "void"), isNotNull(invoices.documentId)))
    .orderBy(desc(invoices.createdAt))
    .limit(1);
  const startPath = depositRow
    ? startSteps({
        projectId: project.id,
        projectStatus: project.status,
        document: depositRow.doc ? { id: depositRow.doc.id, title: depositRow.doc.title, status: depositRow.doc.status } : null,
        invoice: { id: depositRow.invoice.id, number: depositRow.invoice.number, status: depositRow.invoice.status },
      })
    : null;
  const [welcome] = await db.select().from(onboardings).where(eq(onboardings.projectId, project.id)).limit(1);
  const welcomeProgress = welcome
    ? progress(welcome.steps, stepsFor({ hasAgreement: Boolean(depositRow) }))
    : { percent: 0, minutesLeft: 0, finished: 0, total: 0 };
  const team = can.inviteTeammates(access)
    ? await db.select().from(memberships).where(eq(memberships.clientId, project.clientId)).orderBy(asc(memberships.createdAt))
    : [];

  // Remember this visit for next time ("since your last visit").
  if (clientMembership) {
    after(async () => {
      await getDb().update(memberships).set({ lastSeenAt: new Date() }).where(eq(memberships.id, clientMembership.id));
    });
  }

  const days = daysUntil(project.deliveryDate);
  const launched = project.status === "launched";
  const done = steps.filter((s) => s.state === "done").length;
  const percent = launched ? 100 : steps.length ? (done / steps.length) * 100 : 0;
  const nextStep = steps.find((s) => s.state !== "done");
  const [latest, ...older] = recentUpdates;
  const base = `/projects/${project.id}`;
  const today = new Date().toISOString().slice(0, 10);

  const todos: Todo[] = [
    ...toSign.map(({ doc }) => ({
      key: `doc-${doc.id}`,
      title: `Sign ${doc.title}`,
      detail: "Takes under a minute",
      href: `${base}/documents/${doc.id}`,
      cta: "Review & sign",
      urgent: true,
    })),
    ...(can.approve(access)
      ? openApprovals.map(({ approval, preview }) => ({
          key: `ap-${approval.id}`,
          title: `Approve ${preview?.label ?? "the latest designs"}`,
          detail: "Approve, or tell us what to change",
          href: `${base}/review${preview ? `?round=${preview.id}` : ""}`,
          cta: "Review",
          urgent: true,
        }))
      : []),
    ...openInvoices.map((inv) => ({
      key: `inv-${inv.id}`,
      title: `Pay invoice ${inv.number}: ${formatMoney(inv.amountCents, inv.currency)}`,
      detail: inv.dueOn < today ? `Overdue since ${formatDate(inv.dueOn)}` : `Due ${formatDate(inv.dueOn)}`,
      href: `${base}/billing`,
      cta: "Pay",
      urgent: inv.dueOn < today,
    })),
    ...waitingRequests.map((r) => ({
      key: `req-${r.id}`,
      title: `We have a question: ${r.title}`,
      href: `${base}/support#r-${r.id}`,
      cta: "Reply",
    })),
    ...openTasks
      .filter((t) => t.side === "client")
      .map((t) => ({
        key: `task-${t.id}`,
        title: t.title,
        detail: t.dueOn ? `${t.dueOn < today ? "Overdue · was due" : "Due"} ${formatDate(t.dueOn)}` : undefined,
        // Upload to-dos tick themselves off when the file arrives.
        ...(t.completesOn === "file_upload" ? { href: `${base}/files`, cta: "Upload" } : { taskId: t.id }),
        urgent: Boolean(t.dueOn && t.dueOn < today),
      })),
    ...newIdeas.map((i) => ({
      key: `idea-${i.id}`,
      title: `New idea from UnBusy: ${i.title}`,
      detail: "Interested or not now? One click.",
      href: `${base}/results#ideas`,
      cta: "Take a look",
    })),
  ];
  const onOurSide = openTasks.filter((t) => t.side === "skox");
  const sinceLines = summarizeSince(recentEvents);

  const headline = launched
    ? `${project.name} is live.`
    : todos.length === 0
      ? `Everything's on track. Nothing needs you right now.`
      : `${todos.length} ${todos.length === 1 ? "thing needs" : "things need"} you.`;

  const shareToken = typeof sp.share === "string" ? sp.share : null;

  return (
    <>
      <ProjectHeader shell={shell} tab="home" error={readMessage(sp.error)} notice={readMessage(sp.notice)} />
      <main className="shell page page-after-band">
        <section className="hello" aria-label="Summary">
          <p className="hello-greet">
            {greeting()}, {firstName(viewer.name ?? viewer.email)}.
          </p>
          <p className="hello-line">{headline}</p>
          <Link className="btn btn-ghost btn-small" href={`${base}/meetings`}>Schedule a meeting</Link>
        </section>

        {welcome && welcome.status !== "completed" && welcome.welcomeSentAt && (
          <section className="card setup-banner" aria-labelledby="setup-title">
            <div>
              <p className="label">Your setup</p>
              <h2 id="setup-title">
                {welcomeProgress.percent > 0 ? `You're ${welcomeProgress.percent}% set up` : "Let's get you set up"}
              </h2>
              <p className="small muted">About {welcomeProgress.minutesLeft} minutes left. It saves as you go.</p>
            </div>
            <Link className="btn btn-primary" href={`/projects/${project.id}/welcome`}>
              {welcomeProgress.percent > 0 ? "Pick up where you left off" : "Start setup"} →
            </Link>
          </section>
        )}

        {startPath && (
          <section className="card start-card" aria-labelledby="start-title">
            <div className="card-head">
              <h2 id="start-title">Get started</h2>
              <span className="muted small">
                {startPath.filter((s) => s.state === "done").length} of {startPath.length} done
              </span>
            </div>
            <ol className="start-steps">
              {startPath.map((s, i) => (
                <li key={s.key} data-state={s.state}>
                  <span className="start-num" aria-hidden="true">
                    {s.state === "done" ? "✓" : i + 1}
                  </span>
                  <div className="start-text">
                    <p className="todo-title">{s.label}</p>
                    <p className="todo-detail">
                      {s.state === "locked" ? "Unlocks after the step before" : s.detail}
                      <span className="sr-only"> ({s.state})</span>
                    </p>
                  </div>
                  {s.state === "current" && s.href && (
                    <Link className="btn btn-primary btn-small" href={s.href}>
                      {s.key === "sign" ? "Review & sign" : "Pay deposit"}
                    </Link>
                  )}
                </li>
              ))}
            </ol>
          </section>
        )}

        {launched ? (
          <section className="live-panel" aria-label="Your product is live">
            <div>
              <p className="label">Live since {formatDate(project.launchedOn ?? project.deliveryDate)}</p>
              <p className="date-big">You&apos;re live.</p>
              {project.liveUrl && (
                <a className="live-link" href={project.liveUrl} target="_blank" rel="noopener noreferrer">
                  {project.liveUrl.replace(/^https?:\/\//, "")} ↗
                </a>
              )}
            </div>
            <div className="row">
              <Link className="btn btn-primary" href={`${base}/support`}>
                Request a change
              </Link>
              <Link className="btn btn-ghost" href={`${base}/results`}>
                See your results
              </Link>
            </div>
          </section>
        ) : (
          <section className="date-panel" aria-label="Delivery date">
            <div className="date-main">
              <p className="label">Launch date</p>
              {project.dateTentative ? (
                <>
                  <p className="date-big date-soft">Set at kickoff</p>
                  <p className="date-countdown">We&apos;ll confirm it together once we&apos;ve walked through your plan</p>
                </>
              ) : (
                <>
                  <p className="date-big">{formatDate(project.deliveryDate)}</p>
                  <p className="date-countdown">{describeDaysUntil(days)}</p>
                </>
              )}
              {changes[0] && (
                <p className="date-history">
                  Moved from {formatDate(changes[0].fromDate)}: {changes[0].reason}
                </p>
              )}
            </div>
            <div className="date-progress">
              <ProgressRing percent={percent} label="Plan complete" />
              <div>
                <p className="label">Up next</p>
                <p className="next-step">{nextStep ? nextStep.title : "Final checks"}</p>
                {nextStep?.dueOn && <p className="small">{formatDate(nextStep.dueOn)}</p>}
              </div>
            </div>
          </section>
        )}

        <div className="split">
          <div>
            <section className="card card-todo" aria-labelledby="todo-title">
              <div className="card-head">
                <h2 id="todo-title">Your to-do</h2>
                {todos.length > 0 && <span className="chip chip-amber">{todos.length}</span>}
              </div>
              {todos.length === 0 ? (
                <p className="all-clear">
                  <span aria-hidden="true">✓</span> You&apos;re all caught up. We&apos;ll email you the moment we need something.
                </p>
              ) : (
                <ul className="todo-list">
                  {todos.map((t) => (
                    <li key={t.key} data-urgent={t.urgent ? "true" : undefined}>
                      <div>
                        <p className="todo-title">{t.title}</p>
                        {t.detail && <p className="todo-detail">{t.detail}</p>}
                      </div>
                      {t.taskId ? (
                        <form action={completeClientTask}>
                          <input type="hidden" name="projectId" value={project.id} />
                          <input type="hidden" name="taskId" value={t.taskId} />
                          <SubmitButton className="btn btn-ghost btn-small" pendingLabel="Saving…">
                            Mark done
                          </SubmitButton>
                        </form>
                      ) : (
                        t.href && (
                          <Link className="btn btn-primary btn-small" href={t.href}>
                            {t.cta ?? "Open"}
                          </Link>
                        )
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

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
                  {latest.update.videoUrl && <VideoEmbed url={latest.update.videoUrl} title="This week's walkthrough" />}
                  {latest.preview?.url && (
                    <div className="update-meta">
                      <a href={latest.preview.url} target="_blank" rel="noopener noreferrer">
                        Open the preview{latest.preview.label ? `: ${latest.preview.label}` : ""} ↗
                      </a>
                    </div>
                  )}
                </>
              ) : (
                <p className="empty">Your first update arrives after kickoff. We post one every week.</p>
              )}
              {older.length > 0 && (
                <div style={{ marginTop: 14 }}>
                  {older.map(({ update }) => (
                    <details key={update.id} className="update-older">
                      <summary>{formatDateTime(update.createdAt)}</summary>
                      <div className="update-grid" style={{ marginTop: 12 }}>
                        <p>{update.shipped}</p>
                        <p>{update.next}</p>
                        <p>{update.needed}</p>
                      </div>
                    </details>
                  ))}
                </div>
              )}
            </section>
          </div>

          <aside>
            {sinceLines.length > 0 && (
              <section className="card card-since" aria-labelledby="since-title">
                <div className="card-head">
                  <h2 id="since-title">Since your last visit</h2>
                </div>
                <ul className="since-list">
                  {sinceLines.map((l) => (
                    <li key={l.text}>
                      <span>{l.text}</span>
                      <span className="when">{formatDateTime(l.at)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section className="card" aria-labelledby="progress-title">
              <div className="card-head">
                <h2 id="progress-title">The plan</h2>
                <span className="muted small">
                  {done} of {steps.length} done
                </span>
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
                  <h2 id="ours-title">What we&apos;re working on</h2>
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

            {can.inviteTeammates(access) && (
              <section className="card" id="team" aria-labelledby="team-title">
                <div className="card-head">
                  <h2 id="team-title">Your team</h2>
                  <span className="muted small">{team.length}</span>
                </div>
                <ul className="task-list">
                  {team.map((m) => (
                    <li key={m.id}>
                      <span className="small">
                        {m.email}
                        <span className="muted"> · {ROLE_LABEL[m.role]}</span>
                        {!m.userId && <span className="chip chip-amber" style={{ marginLeft: 6 }}>Invited</span>}
                      </span>
                      {m.email !== viewer.email && (access.isStaff || m.role === "client_member") && (
                        <form action={removeTeammate}>
                          <input type="hidden" name="projectId" value={project.id} />
                          <input type="hidden" name="membershipId" value={m.id} />
                          <button className="btn btn-link small" type="submit">
                            Remove
                          </button>
                        </form>
                      )}
                    </li>
                  ))}
                </ul>
                <form action={inviteTeammate} className="stack" style={{ marginTop: 12 }}>
                  <input type="hidden" name="projectId" value={project.id} />
                  <div className="field">
                    <label htmlFor="tm-email">Invite a teammate</label>
                    <input id="tm-email" name="email" type="email" required placeholder="name@company.com" />
                  </div>
                  <div className="inline-form">
                    <label className="sr-only" htmlFor="tm-role">
                      Role
                    </label>
                    <select id="tm-role" name="role" defaultValue="client_member">
                      <option value="client_member">Can view and comment</option>
                      <option value="client_approver">Can also approve, sign and pay</option>
                    </select>
                    <SubmitButton className="btn btn-ghost btn-small" pendingLabel="Sending…">
                      Send invite
                    </SubmitButton>
                  </div>
                </form>
              </section>
            )}

            {can.createShareLink(access) && (
              <section className="card" id="share" aria-labelledby="share-title">
                <div className="card-head">
                  <h2 id="share-title">Share progress</h2>
                </div>
                {shareToken ? (
                  <div className="stack">
                    <p className="small muted">Copy this now. For security we can&apos;t show it again.</p>
                    <input readOnly className="share-input" value={`${PORTAL_URL}/s/${shareToken}`} aria-label="Status link" />
                  </div>
                ) : (
                  <p className="small muted">
                    A read-only status page for your boss or board: delivery date, progress and updates. No login needed, and it
                    stops working after 30 days.
                  </p>
                )}
                <div className="row" style={{ marginTop: 12 }}>
                  <form action={createShareLink}>
                    <input type="hidden" name="projectId" value={project.id} />
                    <button className="btn btn-ghost btn-small" type="submit">
                      Create a status link
                    </button>
                  </form>
                  <form action={revokeShareLinks}>
                    <input type="hidden" name="projectId" value={project.id} />
                    <button className="btn btn-link small" type="submit">
                      Turn off old links
                    </button>
                  </form>
                </div>
              </section>
            )}
          </aside>
        </div>
      </main>
    </>
  );
}
