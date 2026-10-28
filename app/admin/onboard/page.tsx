import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { Notice, readMessage } from "@/components/Notice";
import { TopBar } from "@/components/TopBar";
import { requireStaff } from "@/lib/access";
import { getDb } from "@/lib/db";
import { clients, deals, documents, invoices, onboardings, projects } from "@/lib/db/schema";
import { formatDateTime, nowMs, PROJECT_KINDS } from "@/lib/format";
import { idleDays, progress, stepsFor } from "@/lib/onboarding-flow";
import { welcomeLink } from "@/lib/onboarding-server";
import { sendWelcome, startOnboarding } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Onboard a client" };

export default async function OnboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const { viewer, staff } = await requireStaff();
  const db = getDb();
  const rows = await db
    .select({ onboarding: onboardings, project: projects, client: clients })
    .from(onboardings)
    .innerJoin(projects, eq(projects.id, onboardings.projectId))
    .innerJoin(clients, eq(clients.id, projects.clientId))
    .where(eq(onboardings.workspaceId, staff.workspaceId))
    .orderBy(desc(onboardings.createdAt))
    .limit(50);
  const projectIds = rows.map((r) => r.project.id);
  const [docs, deps] = projectIds.length
    ? await Promise.all([
        db.select({ projectId: documents.projectId }).from(documents).where(inArray(documents.projectId, projectIds)),
        db.select({ projectId: invoices.projectId }).from(invoices).where(inArray(invoices.projectId, projectIds)),
      ])
    : [[], []];
  // Coming from a Won card in the pipeline: prefill from the deal and link it.
  const dealId = typeof sp.deal === "string" && /^[0-9a-f-]{36}$/i.test(sp.deal) ? sp.deal : null;
  const [deal] = dealId
    ? await db
        .select()
        .from(deals)
        .where(and(eq(deals.id, dealId), eq(deals.workspaceId, staff.workspaceId), isNull(deals.projectId)))
        .limit(1)
    : [];
  const dealKind = deal && PROJECT_KINDS.some((k) => k.value === deal.kind) ? deal.kind : "";
  const withAgreement = new Set([...docs, ...deps].map((d) => d.projectId));
  const now = new Date(nowMs());

  return (
    <>
      <TopBar viewer={viewer} />
      <main className="shell page">
        <div className="page-head">
          <div>
            <p className="eyebrow">
              <Link href="/admin">Mission control</Link> / Onboarding
            </p>
            <h1>Onboard a new client</h1>
            <p className="page-intro">
              They said yes. Enter their email and we&apos;ll handle the welcome, the questions, the brand kit, access and
              kickoff booking inside the portal.
            </p>
          </div>
        </div>
        <Notice error={readMessage(sp.error)} notice={readMessage(sp.notice)} />

        <div className="split">
          <section className="card onboard-card" aria-labelledby="start-title">
            <div className="card-head">
              <h2 id="start-title">Start onboarding</h2>
            </div>
            <form action={startOnboarding} className="stack">
              {deal && (
                <>
                  <input type="hidden" name="dealId" value={deal.id} />
                  <p className="small muted">
                    From the pipeline: <strong>{deal.company}</strong>. The deal moves with the new project.
                  </p>
                </>
              )}
              <div className="field">
                <label htmlFor="ob-email">Client&apos;s email</label>
                <input id="ob-email" name="email" type="email" required autoFocus defaultValue={deal?.contactEmail ?? ""} placeholder="jane@harbordental.com" className="input-lg" />
                <span className="hint">That&apos;s all you need. Everything below is optional and they can fill it in themselves.</span>
              </div>
              <details className="more-details" open={!!deal}>
                <summary>Add details from the call</summary>
                <div className="stack" style={{ marginTop: 12 }}>
                  <div className="form-grid">
                    <div className="field">
                      <label htmlFor="ob-name">Their name</label>
                      <input id="ob-name" name="contactName" maxLength={120} defaultValue={deal?.contactName ?? ""} placeholder="Jane Alvarez" />
                    </div>
                    <div className="field">
                      <label htmlFor="ob-company">Company</label>
                      <input id="ob-company" name="companyName" maxLength={120} defaultValue={deal?.company ?? ""} placeholder="From their email if blank" />
                    </div>
                    <div className="field">
                      <label htmlFor="ob-project">Project name</label>
                      <input id="ob-project" name="projectName" maxLength={140} placeholder="e.g. Booking portal" />
                    </div>
                    <div className="field">
                      <label htmlFor="ob-kind">Type</label>
                      <select id="ob-kind" name="kind" defaultValue={dealKind}>
                        <option value="">Not sure yet</option>
                        {PROJECT_KINDS.map((k) => (
                          <option key={k.value} value={k.value}>
                            {k.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="field">
                      <label htmlFor="ob-date">Target launch</label>
                      <input id="ob-date" name="deliveryDate" type="date" />
                      <span className="hint">Blank = 6 weeks, shown as a target until kickoff.</span>
                    </div>
                  </div>
                  <div className="field">
                    <label htmlFor="ob-recap">What we heard on the call (the client sees this)</label>
                    <textarea
                      id="ob-recap"
                      name="callRecap"
                      maxLength={4000}
                      rows={4}
                      placeholder="You want patients to book online and pay a deposit, so your front desk stops chasing no-shows. Must work with your current calendar. Launch before the spring rush."
                    />
                    <span className="hint">They&apos;ll confirm it or correct it. It&apos;s the fastest way to be aligned on day one.</span>
                  </div>
                  <div className="field">
                    <label htmlFor="ob-notes">Internal notes (UnBusy only)</label>
                    <textarea id="ob-notes" name="internalNotes" maxLength={4000} rows={3} defaultValue={deal?.notes ?? ""} placeholder="Budget, decision-maker, objections…" />
                  </div>
                </div>
              </details>
              <div>
                <button className="btn btn-primary btn-lg" type="submit">
                  Set up client →
                </button>
                <span className="small muted" style={{ marginLeft: 12 }}>
                  Next: attach the agreement and deposit, then send one welcome email.
                </span>
              </div>
            </form>
          </section>

          <aside>
            <section className="card" aria-labelledby="what-title">
              <div className="card-head">
                <h2 id="what-title">What happens</h2>
              </div>
              <ol className="how-list">
                <li>Enter their email (and a few lines of recap from the call).</li>
                <li>Attach the agreement PDF and the deposit. Nothing is sent yet.</li>
                <li>Send one welcome email. Their first step is signing and paying, while the decision is fresh.</li>
                <li>Then a calm setup: details, team, project questions, brand kit, access and kickoff booking. Skipped items become to-dos.</li>
                <li>Gentle reminders if they pause. You get the brief the moment they finish.</li>
              </ol>
              <p className="small muted" style={{ marginTop: 10 }}>
                Best timing: the same day they say yes, ideally within the hour.
              </p>
            </section>
          </aside>
        </div>

        <section className="card" style={{ marginTop: 20 }} aria-labelledby="pipeline-title">
          <div className="card-head">
            <h2 id="pipeline-title">Onboarding pipeline</h2>
            <span className="muted small">{rows.length}</span>
          </div>
          {rows.length === 0 ? (
            <p className="empty">Nobody onboarding yet. Your next yes goes here.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Client</th>
                    <th>Progress</th>
                    <th>Signals</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ onboarding: o, project, client }) => {
                    const steps = stepsFor({ hasAgreement: withAgreement.has(project.id) });
                    const p = progress(o.steps, steps);
                    const idle = idleDays(o.lastActivityAt ?? o.createdAt, now) ?? 0;
                    return (
                      <tr key={o.id}>
                        <td>
                          <Link href={`/admin/projects/${project.id}`}>{client.name}</Link>
                          <div className="muted small">
                            {o.invitedEmail} · started {formatDateTime(o.createdAt)}
                          </div>
                        </td>
                        <td style={{ minWidth: 180 }}>
                          <div className="meter" aria-label={`${p.percent}% complete`}>
                            <span style={{ width: `${o.status === "completed" ? 100 : p.percent}%` }} />
                          </div>
                          <div className="muted small" style={{ marginTop: 4 }}>
                            {o.status === "completed"
                              ? "Complete"
                              : !o.welcomeSentAt
                                ? "Welcome not sent yet"
                                : o.status === "invited"
                                  ? "Not opened yet"
                                  : `${p.finished} of ${p.total} steps`}
                          </div>
                        </td>
                        <td>
                          <div className="row">
                            {o.status === "completed" && <span className="chip chip-ok">Brief ready</span>}
                            {!o.welcomeSentAt && <span className="chip chip-amber">Draft</span>}
                            {o.welcomeSentAt && o.status !== "completed" && idle >= 3 && <span className="chip chip-danger">Idle {idle}d</span>}
                            {o.recapConfirmed === false && <span className="chip chip-amber">Recap flagged</span>}
                            {o.recapConfirmed === true && <span className="chip">Recap confirmed</span>}
                            {o.remindersSent > 0 && o.status !== "completed" && <span className="chip">{o.remindersSent} reminder(s)</span>}
                          </div>
                        </td>
                        <td>
                          <div className="row">
                            <Link className="btn btn-ghost btn-small" href={`/admin/projects/${project.id}/brief`}>
                              Brief
                            </Link>
                            <Link className="btn btn-link small" href={`/projects/${project.id}/welcome`}>
                              View as client
                            </Link>
                            {!o.welcomeSentAt ? (
                              <Link className="btn btn-primary btn-small" href={`/admin/onboard/${project.id}`}>
                                Finish &amp; send
                              </Link>
                            ) : (
                              o.status !== "completed" && (
                                <form action={sendWelcome}>
                                  <input type="hidden" name="onboardingId" value={o.id} />
                                  <button className="btn btn-link small" type="submit">
                                    Resend welcome
                                  </button>
                                </form>
                              )
                            )}
                          </div>
                          {o.status !== "completed" && (
                            <input readOnly className="share-input" style={{ marginTop: 6 }} value={welcomeLink(o.invitedEmail)} aria-label="Welcome link" />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </>
  );
}
