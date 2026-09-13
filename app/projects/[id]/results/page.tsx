import { asc, desc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { readMessage } from "@/components/Notice";
import { ProjectHeader } from "@/components/ProjectHeader";
import { Sparkline } from "@/components/ProgressRing";
import { getDb } from "@/lib/db";
import { carePlans, ideas, reports, resources, supportRequests, workspaces } from "@/lib/db/schema";
import { formatMonth, IDEA_STATUS_LABEL, percentChange, RESOURCE_KIND_LABEL } from "@/lib/format";
import { can } from "@/lib/permissions";
import { loadProjectShell } from "@/lib/project-shell";
import {
  addResource,
  ensureReferralCode,
  postIdea,
  removeResource,
  respondToIdea,
  saveCarePlan,
  saveReport,
  setIdeaStatus,
} from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Results" };

function Delta({ value, invert = false }: { value: number | null; invert?: boolean }) {
  if (value == null) return null;
  const good = invert ? value < 0 : value > 0;
  return (
    <span className={value === 0 ? "delta" : good ? "delta delta-up" : "delta delta-down"}>
      {value > 0 ? "▲" : value < 0 ? "▼" : "•"} {Math.abs(value)}% vs last month
    </span>
  );
}

export default async function ResultsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const shell = await loadProjectShell(id);
  const { project, access, viewer } = shell;
  const db = getDb();
  const [history, [plan], ideaList, kit, [workspace], doneRequests] = await Promise.all([
    db.select().from(reports).where(eq(reports.projectId, project.id)).orderBy(desc(reports.month)).limit(12),
    db.select().from(carePlans).where(eq(carePlans.projectId, project.id)).limit(1),
    db.select().from(ideas).where(eq(ideas.projectId, project.id)).orderBy(desc(ideas.createdAt)),
    db.select().from(resources).where(eq(resources.projectId, project.id)).orderBy(asc(resources.createdAt)),
    db.select().from(workspaces).where(eq(workspaces.id, project.workspaceId)).limit(1),
    db.select({ id: supportRequests.id, status: supportRequests.status }).from(supportRequests).where(eq(supportRequests.projectId, project.id)),
  ]);
  const [latest, previous] = history;
  const chrono = [...history].reverse();
  const membership = viewer.memberships.find((m) => m.clientId === project.clientId);
  const referralLink = membership?.referralCode ? `${process.env.PORTAL_URL ?? ""}/r/${membership.referralCode}` : null;
  const launched = project.status === "launched";
  const hoursPct = plan && latest?.hoursUsed != null && plan.hoursIncluded > 0 ? Math.min(100, (latest.hoursUsed / plan.hoursIncluded) * 100) : null;
  const thisMonth = new Date().toISOString().slice(0, 7);
  const hidden = <input type="hidden" name="projectId" value={project.id} />;

  const metrics = latest
    ? [
        { label: "Visitors", value: latest.visitors?.toLocaleString("en-US"), change: percentChange(latest.visitors, previous?.visitors), series: chrono.map((r) => r.visitors) },
        { label: "Leads", value: latest.leads?.toLocaleString("en-US"), change: percentChange(latest.leads, previous?.leads), series: chrono.map((r) => r.leads) },
        { label: "Uptime", value: latest.uptimePct != null ? `${latest.uptimePct}%` : undefined, change: null, series: chrono.map((r) => r.uptimePct) },
        { label: "Speed score", value: latest.speedScore != null ? `${latest.speedScore}/100` : undefined, change: percentChange(latest.speedScore, previous?.speedScore), series: chrono.map((r) => r.speedScore) },
      ].filter((m) => m.value != null)
    : [];

  return (
    <>
      <ProjectHeader
        shell={shell}
        tab="results"
        title={launched ? "Your results" : "Results & what's next"}
        intro="What your product is doing for you each month, your care plan, your launch kit, and ideas for what we could build next."
        error={readMessage(sp.error)}
        notice={readMessage(sp.notice)}
      />
      <main className="shell page page-after-band">
        <section aria-labelledby="report-title">
          <div className="section-head">
            <h2 id="report-title">{latest ? formatMonth(latest.month) : "Monthly report"}</h2>
            {history.length > 1 && <span className="muted small">{history.length} months of history</span>}
          </div>
          {latest ? (
            <>
              <div className="metric-grid">
                {metrics.map((m) => (
                  <div className="metric" key={m.label}>
                    <p className="label">{m.label}</p>
                    <p className="metric-value">{m.value}</p>
                    <Delta value={m.change} />
                    <Sparkline values={m.series} />
                  </div>
                ))}
              </div>
              {latest.highlights && (
                <div className="card highlights">
                  <p className="label">Highlights</p>
                  <p style={{ whiteSpace: "pre-line", marginTop: 6 }}>{latest.highlights}</p>
                </div>
              )}
            </>
          ) : (
            <p className="empty">
              {launched
                ? "Your first monthly report arrives at the end of your first full month live."
                : "Once you're live, this is where you'll see visitors, leads, uptime and speed every month."}
            </p>
          )}
        </section>

        <div className="split" style={{ marginTop: 20 }}>
          <div className="stack">
            <section className="card" id="ideas" aria-labelledby="ideas-title">
              <div className="card-head">
                <h2 id="ideas-title">What we could build next</h2>
              </div>
              {ideaList.length === 0 ? (
                <p className="muted small">We keep a running list of ideas that could grow your business. They&apos;ll show up here.</p>
              ) : (
                <ul className="idea-list">
                  {ideaList.map((i) => (
                    <li key={i.id} className="idea" data-status={i.status}>
                      <div className="stack" style={{ gap: 6 }}>
                        <div className="row" style={{ justifyContent: "space-between" }}>
                          <h3>{i.title}</h3>
                          <span className={i.status === "interested" || i.status === "planned" ? "chip chip-ok" : i.status === "proposed" ? "chip chip-amber" : "chip"}>
                            {IDEA_STATUS_LABEL[i.status]}
                          </span>
                        </div>
                        <p className="muted" style={{ whiteSpace: "pre-line" }}>{i.pitch}</p>
                        {i.estimate && <p className="small">Rough size: {i.estimate}</p>}
                        {can.respondToIdeas(access) && i.status === "proposed" && (
                          <form action={respondToIdea} className="row">
                            {hidden}
                            <input type="hidden" name="ideaId" value={i.id} />
                            <button className="btn btn-primary btn-small" name="response" value="interested" type="submit">
                              I&apos;m interested
                            </button>
                            <button className="btn btn-ghost btn-small" name="response" value="not_now" type="submit">
                              Not now
                            </button>
                          </form>
                        )}
                        {access.isStaff && (
                          <form action={setIdeaStatus} className="inline-form">
                            {hidden}
                            <input type="hidden" name="ideaId" value={i.id} />
                            <select name="status" defaultValue={i.status} aria-label="Idea status">
                              {Object.entries(IDEA_STATUS_LABEL).map(([v, l]) => (
                                <option key={v} value={v}>
                                  {l}
                                </option>
                              ))}
                            </select>
                            <button className="btn btn-ghost btn-small" type="submit">
                              Save
                            </button>
                          </form>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {access.isStaff && (
                <form action={postIdea} className="stack staff-inline">
                  {hidden}
                  <p className="label">
                    Pitch an idea <span className="chip chip-skox">SKOX only</span>
                  </p>
                  <input name="title" required minLength={3} maxLength={120} placeholder="e.g. Online booking with deposits" aria-label="Idea title" />
                  <textarea name="pitch" required maxLength={3000} placeholder="What it is and what it would do for them" aria-label="Pitch" />
                  <input name="estimate" maxLength={80} placeholder="Rough size, e.g. 2 weeks · from $3k" aria-label="Estimate" />
                  <div>
                    <button className="btn btn-ghost" type="submit">
                      Post and email the client
                    </button>
                  </div>
                </form>
              )}
            </section>

            <section className="card" id="launch-kit" aria-labelledby="kit-title">
              <div className="card-head">
                <h2 id="kit-title">Launch kit</h2>
              </div>
              {kit.length === 0 ? (
                <p className="muted small">Walkthrough videos, guides and handy links for running your product will live here.</p>
              ) : (
                <ul className="doc-list">
                  {kit.map((r) => (
                    <li key={r.id} className="doc-row">
                      <span className="doc-icon" aria-hidden="true">
                        {r.kind === "video" ? "▶" : r.kind === "guide" ? "✎" : r.kind === "login_note" ? "🔑" : "↗"}
                      </span>
                      <div className="doc-main">
                        {r.url ? (
                          <a className="doc-title" href={r.url} target="_blank" rel="noopener noreferrer">
                            {r.title}
                          </a>
                        ) : (
                          <p className="doc-title">{r.title}</p>
                        )}
                        <p className="small muted">
                          {RESOURCE_KIND_LABEL[r.kind]}
                          {r.note ? ` · ${r.note}` : ""}
                        </p>
                      </div>
                      {access.isStaff && (
                        <form action={removeResource}>
                          {hidden}
                          <input type="hidden" name="resourceId" value={r.id} />
                          <button className="btn btn-link small" type="submit">
                            Remove
                          </button>
                        </form>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {access.isStaff && (
                <form action={addResource} className="form-grid staff-inline">
                  {hidden}
                  <div className="field">
                    <label htmlFor="k-kind">Type</label>
                    <select id="k-kind" name="kind" defaultValue="video">
                      {Object.entries(RESOURCE_KIND_LABEL).map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="k-title">Title</label>
                    <input id="k-title" name="title" required maxLength={140} placeholder="How to edit your menu" />
                  </div>
                  <div className="field">
                    <label htmlFor="k-url">Link</label>
                    <input id="k-url" name="url" type="url" placeholder="https://loom.com/…" />
                  </div>
                  <div className="field">
                    <label htmlFor="k-note">Note</label>
                    <input id="k-note" name="note" maxLength={1000} placeholder="Never put passwords here" />
                  </div>
                  <div>
                    <button className="btn btn-ghost" type="submit">
                      Add <span className="chip chip-skox">SKOX only</span>
                    </button>
                  </div>
                </form>
              )}
            </section>
          </div>

          <aside>
            <section className="card" aria-labelledby="plan-title">
              <div className="card-head">
                <h2 id="plan-title">Care plan</h2>
              </div>
              {plan ? (
                <div className="stack">
                  <div>
                    <p className="plan-name">{plan.name}</p>
                    {plan.priceNote && <p className="small muted">{plan.priceNote}</p>}
                  </div>
                  {plan.hoursIncluded > 0 && (
                    <div>
                      <div className="row" style={{ justifyContent: "space-between" }}>
                        <span className="small">Hours this month</span>
                        <span className="small num">
                          {latest?.hoursUsed ?? 0} of {plan.hoursIncluded}
                        </span>
                      </div>
                      <div className="meter" aria-hidden="true">
                        <span style={{ width: `${hoursPct ?? 0}%` }} />
                      </div>
                    </div>
                  )}
                  {plan.includes && <p className="small muted" style={{ whiteSpace: "pre-line" }}>{plan.includes}</p>}
                  <p className="small">
                    {doneRequests.filter((r) => r.status === "done").length} requests completed so far.
                  </p>
                </div>
              ) : (
                <p className="small muted">
                  {launched
                    ? "Keep your product fast, secure and improving with a monthly care plan. Ask us about it in Requests."
                    : "After launch, a care plan keeps things updated, secure and improving every month."}
                </p>
              )}
              {access.isStaff && (
                <details className="staff-inline">
                  <summary className="small">
                    {plan ? "Edit care plan" : "Set up a care plan"} <span className="chip chip-skox">SKOX only</span>
                  </summary>
                  <form action={saveCarePlan} className="stack" style={{ marginTop: 10 }}>
                    {hidden}
                    <input name="name" required defaultValue={plan?.name ?? "Care plan"} maxLength={80} aria-label="Plan name" />
                    <input name="hoursIncluded" type="number" min="0" step="0.5" defaultValue={plan?.hoursIncluded ?? 4} aria-label="Hours included" />
                    <input name="priceNote" defaultValue={plan?.priceNote ?? ""} maxLength={120} placeholder="$299/month" aria-label="Price" />
                    <textarea name="includes" defaultValue={plan?.includes ?? ""} maxLength={2000} placeholder="Hosting & monitoring&#10;Security updates&#10;Content changes" aria-label="What's included" />
                    <input name="startedOn" type="date" defaultValue={plan?.startedOn ?? ""} aria-label="Start date" />
                    <button className="btn btn-ghost btn-small" type="submit">
                      Save plan
                    </button>
                  </form>
                </details>
              )}
            </section>

            {!access.isStaff && (
              <section className="card card-refer" aria-labelledby="refer-title">
                <div className="card-head">
                  <h2 id="refer-title">Know someone with a good idea?</h2>
                </div>
                <p className="small">
                  Send them your link. {workspace?.referralReward ? `When they start a project, ${workspace.referralReward}.` : "When they start a project, we'll thank you properly."}
                </p>
                {referralLink ? (
                  <input readOnly className="share-input" value={referralLink} aria-label="Your referral link" style={{ marginTop: 10 }} />
                ) : (
                  <form action={ensureReferralCode} style={{ marginTop: 10 }}>
                    {hidden}
                    <button className="btn btn-primary btn-small" type="submit">
                      Get my referral link
                    </button>
                  </form>
                )}
                {launched && workspace?.reviewUrl && (
                  <p className="small" style={{ marginTop: 12 }}>
                    Happy with how it went?{" "}
                    <a href={workspace.reviewUrl} target="_blank" rel="noopener noreferrer">
                      Leave us a quick review ↗
                    </a>
                  </p>
                )}
              </section>
            )}

            {access.isStaff && (
              <section className="card staff-card" aria-labelledby="report-form-title">
                <div className="card-head">
                  <h2 id="report-form-title">Monthly report</h2>
                  <span className="chip chip-skox">SKOX only</span>
                </div>
                <form action={saveReport} className="stack">
                  {hidden}
                  <div className="field">
                    <label htmlFor="m-month">Month</label>
                    <input id="m-month" name="month" type="month" required defaultValue={latest?.month.slice(0, 7) ?? thisMonth} />
                  </div>
                  <div className="form-grid">
                    <div className="field">
                      <label htmlFor="m-visitors">Visitors</label>
                      <input id="m-visitors" name="visitors" type="number" min="0" />
                    </div>
                    <div className="field">
                      <label htmlFor="m-leads">Leads</label>
                      <input id="m-leads" name="leads" type="number" min="0" />
                    </div>
                    <div className="field">
                      <label htmlFor="m-uptime">Uptime %</label>
                      <input id="m-uptime" name="uptimePct" type="number" min="0" max="100" step="0.01" />
                    </div>
                    <div className="field">
                      <label htmlFor="m-speed">Speed score</label>
                      <input id="m-speed" name="speedScore" type="number" min="0" max="100" />
                    </div>
                    <div className="field">
                      <label htmlFor="m-hours">Care hours used</label>
                      <input id="m-hours" name="hoursUsed" type="number" min="0" step="0.25" />
                    </div>
                  </div>
                  <div className="field">
                    <label htmlFor="m-high">Highlights</label>
                    <textarea id="m-high" name="highlights" maxLength={4000} placeholder="Best month yet for bookings. We shipped…" />
                  </div>
                  <label className="check">
                    <input type="checkbox" name="notify" defaultChecked />
                    <span className="small">Email the client that the report is ready</span>
                  </label>
                  <button className="btn btn-primary" type="submit">
                    Publish report
                  </button>
                </form>
              </section>
            )}
          </aside>
        </div>
      </main>
    </>
  );
}
