import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/PrintButton";
import { TopBar } from "@/components/TopBar";
import { requireStaff } from "@/lib/access";
import { getDb } from "@/lib/db";
import { clients, files, memberships, onboardings, projects } from "@/lib/db/schema";
import { formatDate, formatDateTime, kindLabel, ROLE_LABEL } from "@/lib/format";
import { ACCESS_STATUS, accessFor, lines, questionsFor } from "@/lib/onboarding-content";
import { progress, stepsFor } from "@/lib/onboarding-flow";
import { agreementState } from "@/lib/onboarding-server";
import { withBase } from "@/lib/paths";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Project brief" };

export default async function BriefPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { viewer, staff } = await requireStaff();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = getDb();
  const [row] = await db
    .select({ project: projects, client: clients, onboarding: onboardings })
    .from(projects)
    .innerJoin(clients, eq(clients.id, projects.clientId))
    .leftJoin(onboardings, eq(onboardings.projectId, projects.id))
    .where(and(eq(projects.id, id), eq(projects.workspaceId, staff.workspaceId)))
    .limit(1);
  if (!row) notFound();
  const { project, client, onboarding: o } = row;
  const [team, brandFiles, agreement] = await Promise.all([
    db.select().from(memberships).where(eq(memberships.clientId, client.id)).orderBy(asc(memberships.createdAt)),
    db
      .select()
      .from(files)
      .where(and(eq(files.projectId, project.id), inArray(files.category, ["logo", "brand"])))
      .orderBy(desc(files.createdAt)),
    agreementState(project.id, project.status),
  ]);

  const flow = stepsFor({ hasAgreement: agreement.hasAgreement });
  const p = o ? progress(o.steps, flow) : null;
  const brandColors = o ? (["primary", "secondary", "accent"] as const).map((k) => [k, o.brand[k] as string | undefined] as const) : [];

  return (
    <>
      <TopBar viewer={viewer} />
      <main className="shell page brief">
        <div className="page-head">
          <div>
            <p className="eyebrow no-print">
              <Link href="/admin">Mission control</Link> / <Link href={`/admin/projects/${project.id}`}>{project.name}</Link>
            </p>
            <h1>{client.name}: project brief</h1>
            <p className="page-intro">
              {project.name} · {kindLabel(project.kind)} ·{" "}
              {project.dateTentative ? "launch date to set at kickoff" : `launch ${formatDate(project.deliveryDate)}`}
            </p>
          </div>
          <div className="row no-print">
            <PrintButton />
            <a className="btn btn-ghost btn-small" href={withBase(`/api/projects/${project.id}/welcome-guide`)} target="_blank" rel="noopener noreferrer">
              Welcome guide (PDF)
            </a>
            <Link className="btn btn-ghost btn-small" href={`/projects/${project.id}/welcome`}>
              Open their setup
            </Link>
          </div>
        </div>

        {!o ? (
          <p className="empty">This project didn&apos;t start through onboarding, so there&apos;s no brief yet.</p>
        ) : (
          <div className="brief-grid">
            <section className="card">
              <div className="card-head">
                <h2>Status</h2>
                <span className={o.status === "completed" ? "chip chip-ok" : "chip chip-amber"}>
                  {o.status === "completed" ? `Completed ${o.completedAt ? formatDateTime(o.completedAt) : ""}` : o.welcomeSentAt ? `${p?.percent}% done` : "Welcome not sent"}
                </span>
              </div>
              <ul className="task-list">
                {flow.map((s) => (
                  <li key={s.key}>
                    <span>{s.title}</span>
                    <span className={o.steps[s.key] === "done" ? "chip chip-ok" : o.steps[s.key] === "skipped" ? "chip chip-amber" : "chip"}>
                      {o.steps[s.key] === "done" ? "Done" : o.steps[s.key] === "skipped" ? "Later" : "Not yet"}
                    </span>
                  </li>
                ))}
              </ul>
              {o.internalNotes && (
                <div className="brief-internal">
                  <p className="label">Internal notes (SKOX only)</p>
                  <p className="pre">{o.internalNotes}</p>
                </div>
              )}
            </section>

            <section className="card">
              <div className="card-head">
                <h2>Call recap</h2>
                {o.callRecap && (
                  <span className={o.recapConfirmed === true ? "chip chip-ok" : o.recapConfirmed === false ? "chip chip-amber" : "chip"}>
                    {o.recapConfirmed === true ? "Confirmed" : o.recapConfirmed === false ? "Client added notes" : "Not reviewed"}
                  </span>
                )}
              </div>
              {o.callRecap ? <blockquote className="brief-quote">{o.callRecap}</blockquote> : <p className="muted small">No recap was written.</p>}
              {o.recapFeedback && (
                <>
                  <p className="label" style={{ marginTop: 12 }}>
                    Client&apos;s additions
                  </p>
                  <p className="pre">{o.recapFeedback}</p>
                </>
              )}
            </section>

            <section className="card">
              <div className="card-head">
                <h2>Contact & team</h2>
              </div>
              <dl className="kv">
                <dt>Name</dt>
                <dd>{o.contact.name || "—"}</dd>
                <dt>Role</dt>
                <dd>{o.contact.role || "—"}</dd>
                <dt>Email</dt>
                <dd>{o.invitedEmail}</dd>
                <dt>Mobile</dt>
                <dd>{o.contact.phone || "—"}</dd>
                <dt>Prefers</dt>
                <dd>
                  {o.contact.preferred || "—"}
                  {o.contact.times ? ` · ${o.contact.times}` : ""}
                </dd>
                <dt>Website</dt>
                <dd>{o.contact.website ? <a href={o.contact.website}>{o.contact.website}</a> : "—"}</dd>
                <dt>Approves</dt>
                <dd>{o.team.approver || "—"}</dd>
                <dt>Signs</dt>
                <dd>{o.team.signer || "—"}</dd>
                <dt>Pays</dt>
                <dd>{o.team.billing || "—"}</dd>
              </dl>
              <ul className="task-list" style={{ marginTop: 10 }}>
                {team.map((m) => (
                  <li key={m.id}>
                    <span className="small">{m.email}</span>
                    <span className="chip">{ROLE_LABEL[m.role]}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="card brief-wide">
              <div className="card-head">
                <h2>The project in their words</h2>
              </div>
              <dl className="answers">
                {questionsFor(project.kind).map((q) => {
                  const v = o.answers[q.id];
                  const empty = !v || (Array.isArray(v) && v.length === 0);
                  return (
                    <div key={q.id} className="answer">
                      <dt>{q.label}</dt>
                      <dd className={empty ? "muted" : "pre"}>{empty ? "Not answered" : Array.isArray(v) ? v.join(", ") : q.type === "links" ? lines(v).join("\n") : v}</dd>
                    </div>
                  );
                })}
              </dl>
            </section>

            <section className="card">
              <div className="card-head">
                <h2>Brand</h2>
                {o.brand.none ? <span className="chip chip-amber">No brand yet</span> : null}
              </div>
              <div className="brief-swatches">
                {brandColors.map(([k, c]) =>
                  c ? (
                    <span key={k} className="brief-swatch">
                      <span style={{ background: c }} />
                      <span className="small">
                        {k} <span className="num muted">{c.toUpperCase()}</span>
                      </span>
                    </span>
                  ) : null,
                )}
              </div>
              <dl className="kv" style={{ marginTop: 10 }}>
                <dt>Fonts</dt>
                <dd>{(o.brand.fonts as string) || "—"}</dd>
                <dt>Feel</dt>
                <dd>{((o.brand.tone as string[]) ?? []).join(", ") || "—"}</dd>
                <dt>Notes</dt>
                <dd className="pre">{(o.brand.notes as string) || "—"}</dd>
              </dl>
              {brandFiles.length > 0 && (
                <ul className="brand-file-list" style={{ marginTop: 12 }}>
                  {brandFiles.map((f) => (
                    <li key={f.id}>
                      {f.contentType?.startsWith("image/") ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={withBase(`/api/files/${f.id}`)} alt={f.name} />
                      ) : (
                        <span className="doc-icon">FILE</span>
                      )}
                      <a className="small" href={withBase(`/api/files/${f.id}?download=1`)}>
                        {f.name}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="card">
              <div className="card-head">
                <h2>Access</h2>
              </div>
              <ul className="task-list">
                {accessFor(project.kind).map((item) => {
                  const a = o.access[item.id];
                  return (
                    <li key={item.id}>
                      <span className="small">
                        {item.label}
                        {a?.note ? <span className="muted"> · {a.note}</span> : null}
                      </span>
                      <span className={a?.status === "done" ? "chip chip-ok" : a?.status === "help" ? "chip chip-danger" : "chip"}>
                        {a?.status && a.status in ACCESS_STATUS ? ACCESS_STATUS[a.status as keyof typeof ACCESS_STATUS] : "Not answered"}
                      </span>
                    </li>
                  );
                })}
              </ul>
              {o.access.other?.note && <p className="small pre" style={{ marginTop: 8 }}>{o.access.other.note}</p>}
            </section>

            <section className="card">
              <div className="card-head">
                <h2>Agreement & kickoff</h2>
              </div>
              <dl className="kv">
                <dt>Agreement</dt>
                <dd>{agreement.document ? `${agreement.document.title} · ${agreement.document.status === "completed" ? "signed" : "awaiting signature"}` : "Not attached"}</dd>
                <dt>Deposit</dt>
                <dd>{agreement.invoice ? `${agreement.invoice.status === "paid" ? "Paid" : "Open"}` : "None"}</dd>
                <dt>Kickoff</dt>
                <dd>{o.kickoff.status === "booked" ? "Booked by client" : o.kickoff.status === "reach_out" ? "Reach out to schedule" : "—"}</dd>
                <dt>Times</dt>
                <dd>{o.kickoff.times || "—"}</dd>
                <dt>To cover</dt>
                <dd className="pre">{o.kickoff.notes || "—"}</dd>
              </dl>
            </section>
          </div>
        )}
      </main>
    </>
  );
}
