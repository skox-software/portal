import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { SubmitButton } from "@/components/SubmitButton";
import { BookingEmbed } from "@/components/BookingEmbed";
import { safeBookingUrl } from "@/lib/meetings";
import { BrandStudio } from "@/components/BrandStudio";
import { Notice, readMessage } from "@/components/Notice";
import { Reveal } from "@/components/Reveal";
import { VisionCard } from "@/components/VisionCard";
import { TopBar } from "@/components/TopBar";
import { Uploader } from "@/components/Uploader";
import { VideoEmbed } from "@/components/VideoEmbed";
import { registerFile } from "@/app/projects/[id]/files/actions";
import { getDb } from "@/lib/db";
import { files, memberships, onboardings, workspaces } from "@/lib/db/schema";
import { firstName, formatDate, formatMoney, kindLabel, PROJECT_KINDS, ROLE_LABEL } from "@/lib/format";
import { ACCESS_STATUS, accessFor, BEST_TIMES, CONTACT_METHODS, lines, questionsFor, TONE_WORDS, type Question } from "@/lib/onboarding-content";
import { canSkip, isStepKey, neighbours, nextStep, progress, stepsFor, type StepKey } from "@/lib/onboarding-flow";
import { agreementState } from "@/lib/onboarding-server";
import { withBase } from "@/lib/paths";
import { can } from "@/lib/permissions";
import { loadProjectShell } from "@/lib/project-shell";
import { saveWelcomeStep } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Welcome" };

function Chips({ name, options, type, selected }: { name: string; options: string[]; type: "radio" | "checkbox"; selected: string[] }) {
  return (
    <div className="tag-choice">
      {options.map((opt) => (
        <label key={opt} className="tag-option">
          <input type={type} name={name} value={opt} defaultChecked={selected.includes(opt)} />
          <span>{opt}</span>
        </label>
      ))}
    </div>
  );
}

function QuestionField({ q, value }: { q: Question; value: string | string[] | undefined }) {
  const id = `q_${q.id}`;
  const label = (
    <label htmlFor={q.type === "choice" || q.type === "multi" ? undefined : id} className="q-label">
      {q.label}
      {q.required && <span className="req"> *</span>}
    </label>
  );
  const str = Array.isArray(value) ? value.join("\n") : (value ?? "");
  if (q.type === "choice" || q.type === "multi") {
    // A fieldset + legend so screen readers announce the question with each option.
    return (
      <fieldset className="field q-field">
        <legend className="q-label">
          {q.label}
          {q.required && <span className="req"> *</span>}
        </legend>
        {q.help && <span className="hint">{q.help}</span>}
        {q.type === "choice" ? (
          <Chips name={id} options={q.options ?? []} type="radio" selected={[str]} />
        ) : (
          <Chips name={id} options={q.options ?? []} type="checkbox" selected={Array.isArray(value) ? value : lines(value)} />
        )}
      </fieldset>
    );
  }
  return (
    <div className="field q-field">
      {label}
      {q.help && <span className="hint">{q.help}</span>}
      {q.type === "text" && <input id={id} name={id} defaultValue={str} placeholder={q.placeholder} maxLength={4000} required={q.required} />}
      {(q.type === "textarea" || q.type === "links") && (
        <textarea id={id} name={id} defaultValue={str} placeholder={q.placeholder} rows={q.type === "links" ? 3 : 4} maxLength={4000} required={q.required} />
      )}
    </div>
  );
}

export default async function WelcomePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const shell = await loadProjectShell(id);
  const { viewer, project, client, access } = shell;
  const db = getDb();
  const [row] = await db
    .select({ onboarding: onboardings, workspace: workspaces })
    .from(onboardings)
    .innerJoin(workspaces, eq(workspaces.id, onboardings.workspaceId))
    .where(eq(onboardings.projectId, project.id))
    .limit(1);
  if (!row) redirect(`/projects/${project.id}`);
  const { onboarding: o, workspace } = row;
  const kickoffUrl = safeBookingUrl(workspace.schedulingUrl);

  const agreement = await agreementState(project.id, project.status);
  const flow = stepsFor({ hasAgreement: agreement.hasAgreement });
  const complete = o.status === "completed";
  const requested = typeof sp.step === "string" ? sp.step : null;
  const current: StepKey | "done" =
    requested === "done" && complete
      ? "done"
      : isStepKey(requested) && flow.some((s) => s.key === requested)
        ? requested
        : complete
          ? "done"
          : (nextStep(o.steps, flow) ?? flow.find((s) => s.required && o.steps[s.key] !== "done")?.key ?? "done");

  // First visit by the client: mark as started. Returning after signing and paying: tick the agreement.
  if (!access.isStaff && (o.status === "invited" || (agreement.settled && agreement.hasAgreement && o.steps.agreement !== "done"))) {
    after(async () => {
      await getDb()
        .update(onboardings)
        .set({
          status: sql`case when ${onboardings.status} = 'invited' then 'in_progress'::onboarding_status else ${onboardings.status} end`,
          startedAt: o.startedAt ?? new Date(),
          lastActivityAt: new Date(),
          ...(agreement.settled && agreement.hasAgreement
            ? { steps: sql`${onboardings.steps} || '{"agreement":"done"}'::jsonb` }
            : {}),
        })
        .where(eq(onboardings.id, o.id));
    });
  }

  const p = progress(o.steps, flow);
  const index = current === "done" ? flow.length : flow.findIndex((s) => s.key === current);
  const def = current === "done" ? null : flow[index];
  const nav = current === "done" ? { prev: null, next: null } : neighbours(current, flow);
  const base = `/projects/${project.id}/welcome`;
  const name = firstName(o.contact.name || viewer.name || null);
  const greetingName = o.contact.name || viewer.name ? name : client.name;

  const [team, brandFiles] = await Promise.all([
    current === "team" || current === "done"
      ? db.select().from(memberships).where(eq(memberships.clientId, client.id)).orderBy(asc(memberships.createdAt))
      : Promise.resolve([]),
    current === "brand" || current === "done"
      ? db
          .select()
          .from(files)
          .where(and(eq(files.projectId, project.id), inArray(files.category, ["logo", "brand"])))
          .orderBy(desc(files.createdAt))
      : Promise.resolve([]),
  ]);
  const logo = brandFiles.find((f) => f.category === "logo" && f.contentType?.startsWith("image/"));

  // Teammates without approver rights can look through setup but not change it.
  const readOnly = !access.isStaff && (!can.approve(access) || complete);
  const footer = (label = "Continue") =>
    def &&
    (readOnly ? (
      <div className="welcome-footer">
        {nav.prev ? (
          <Link className="btn btn-link" href={`${base}?step=${nav.prev}`}>
            ← Back
          </Link>
        ) : (
          <span />
        )}
        <div className="row">
          <span className="muted small">{complete ? "Setup is finished. Ask SKOX if something needs changing." : "Your approver fills this in."}</span>
          {nav.next && (
            <Link className="btn btn-ghost" href={`${base}?step=${nav.next}`}>
              Next →
            </Link>
          )}
        </div>
      </div>
    ) : (
      <div className="welcome-footer">
        {nav.prev ? (
          <Link className="btn btn-link" href={`${base}?step=${nav.prev}`}>
            ← Back
          </Link>
        ) : (
          <span />
        )}
        <div className="row">
          {canSkip(def.key) && def.key !== "agreement" && (
            <button className="btn btn-ghost" type="submit" name="intent" value="skip" formNoValidate>
              Do this later
            </button>
          )}
          <SubmitButton className="btn btn-primary btn-lg" name="intent" value="continue" pendingLabel="Saving…">
            {label}
          </SubmitButton>
        </div>
      </div>
    ));
  const hidden = (
    <>
      <input type="hidden" name="projectId" value={project.id} />
      <input type="hidden" name="step" value={current} />
    </>
  );

  return (
    <>
      <TopBar viewer={viewer} />
      <main className="welcome-shell">
        <aside className="welcome-rail" aria-label="Your setup">
          <p className="eyebrow">{client.name}</p>
          <p className="rail-title">Your setup</p>
          <div className="meter" aria-hidden="true">
            <span style={{ width: `${complete ? 100 : p.percent}%` }} />
          </div>
          <p className="small muted rail-meta">
            {complete ? "All set" : p.minutesLeft > 0 ? `About ${p.minutesLeft} min left` : "Almost there"}
          </p>
          <ol className="rail-steps">
            {flow.map((s, i) => (
              <li key={s.key} data-state={o.steps[s.key] ?? (s.key === current ? "current" : "todo")} aria-current={s.key === current ? "step" : undefined}>
                <Link href={`${base}?step=${s.key}`}>
                  <span className="rail-dot" aria-hidden="true">
                    {o.steps[s.key] === "done" ? "✓" : i + 1}
                  </span>
                  <span>{s.short}</span>
                  {o.steps[s.key] === "skipped" && <span className="rail-later">later</span>}
                </Link>
              </li>
            ))}
          </ol>
          <Link href={`/projects/${project.id}`} className="small rail-exit">
            {complete ? "Go to your project →" : "Save and finish later"}
          </Link>
        </aside>

        <section className="welcome-main">
          {access.isStaff && (
            <p className="staff-banner" style={{ marginTop: 0, marginBottom: 14 }}>
              Preview as SKOX: this is what {client.name} sees. Saving here fills it in for them.
            </p>
          )}
          <Notice error={readMessage(sp.error)} notice={readMessage(sp.notice)} />

          {current === "done" ? (
            <div className="welcome-done step-enter" key="done">
              <div className="confetti" aria-hidden="true">
                {Array.from({ length: 18 }, (_, i) => (
                  <span key={i} style={{ left: `${(i * 53) % 100}%`, animationDelay: `${(i % 6) * 0.15}s` }} />
                ))}
              </div>
              <p className="eyebrow">Setup complete</p>
              <h1>You&apos;re all set, {greetingName}.</h1>
              <p className="lede">Thank you. We have what we need to make kickoff about your ideas, not paperwork.</p>
              <div className="card next-card">
                <h2>What happens next</h2>
                <ol className="next-list">
                  <li>
                    <strong>Kickoff call.</strong>{" "}
                    {o.kickoff.status === "booked" ? "You've booked it. See you there." : "We'll reach out within one business day to schedule it."}
                  </li>
                  <li>
                    <strong>Your first update</strong> lands within a week, then every week until launch.
                  </li>
                  <li>
                    <strong>Launch date.</strong>{" "}
                    {project.dateTentative ? "We set it together at kickoff." : formatDate(project.deliveryDate)}
                  </li>
                </ol>
              </div>
              {Object.values(o.steps).includes("skipped") && (
                <p className="small muted">Anything you saved for later is on your to-do list, whenever you&apos;re ready.</p>
              )}
              <div className="row">
                <Link className="btn btn-primary btn-lg" href={`/projects/${project.id}`}>
                  Go to your project →
                </Link>
                <a className="btn btn-ghost btn-lg" href={withBase(`/api/projects/${project.id}/welcome-guide?download=1`)}>
                  Download your welcome guide
                </a>
              </div>
            </div>
          ) : (
            <div className="step-enter" key={current}>
              <p className="eyebrow">
                Step {index + 1} of {flow.length} · about {def!.minutes} min
              </p>
              <h1 className="welcome-title">{current === "welcome" ? `Welcome, ${greetingName}.` : def!.title}</h1>

              {current === "welcome" && (
                <form action={saveWelcomeStep} className="welcome-form">
                  {hidden}
                  <p className="lede">
                    We&apos;re excited to build {project.name} with you. This quick setup gets us everything we need, so kickoff is about your
                    ideas, not paperwork. It saves as you go.
                  </p>
                  <VisionCard
                    companyName={client.name.startsWith("New client (") ? project.name : client.name}
                    projectName={project.name}
                    kindLabel={kindLabel(project.kind)}
                    steps={["You said yes", ...(agreement.hasAgreement ? ["Agreement"] : []), "Kickoff", "Weekly updates", "Launch"]}
                  />
                  {workspace.welcomeVideoUrl && (
                    <Reveal>
                      <VideoEmbed url={workspace.welcomeVideoUrl} title="A welcome from SKOX" />
                    </Reveal>
                  )}
                  <Reveal className="promise-grid">
                    {[
                      { t: "One place for everything", d: "Agreement, designs, files, invoices and updates. No digging through email." },
                      { t: "An update every week", d: "What shipped, what's next, and anything we need from you." },
                      { t: "You're in the loop", d: "Click anywhere on a design to comment. Approve when it's right." },
                    ].map((c, i) => (
                      <div key={c.t} className="promise" style={{ transitionDelay: `${i * 90}ms` }}>
                        <span className="promise-num">0{i + 1}</span>
                        <p className="todo-title">{c.t}</p>
                        <p className="todo-detail">{c.d}</p>
                      </div>
                    ))}
                  </Reveal>
                  <Reveal>
                    <div className="card note-card">
                      <p className="label">A note from {workspace.teamIntro || "the SKOX team"}</p>
                      <p>
                        Thank you for trusting us with this. Here&apos;s how we work: a clear plan, an update every week, and one place for
                        everything. If anything is ever unclear, reply to any of our emails and a founder answers.
                      </p>
                    </div>
                  </Reveal>
                  <Reveal>
                    <a className="guide-link" href={withBase(`/api/projects/${project.id}/welcome-guide`)} target="_blank" rel="noopener noreferrer">
                      <span className="guide-icon" aria-hidden="true">
                        PDF
                      </span>
                      <span>
                        <strong>Your welcome guide</strong>
                        <span className="small muted"> · everything about working with us, made for {greetingName}. Save or print it.</span>
                      </span>
                    </a>
                  </Reveal>
                  {o.callRecap && (
                    <Reveal>
                    <fieldset className="card recap-card">
                      <legend className="label">What we heard on our call</legend>
                      <blockquote>{o.callRecap}</blockquote>
                      <div className="tag-choice" role="radiogroup" aria-label="Does this sound right?">
                        <label className="tag-option">
                          <input type="radio" name="recap_answer" value="yes" defaultChecked={o.recapConfirmed === true} required />
                          <span>Yes, that&apos;s it</span>
                        </label>
                        <label className="tag-option">
                          <input type="radio" name="recap_answer" value="add" defaultChecked={o.recapConfirmed === false} />
                          <span>Almost, I&apos;d add something</span>
                        </label>
                      </div>
                      <div className="field">
                        <label htmlFor="recap_feedback" className="small">
                          Anything to add or adjust? (optional if it&apos;s spot on)
                        </label>
                        <textarea id="recap_feedback" name="recap_feedback" rows={3} defaultValue={o.recapFeedback ?? ""} maxLength={4000} />
                      </div>
                    </fieldset>
                    </Reveal>
                  )}
                  {footer("Let's get started →")}
                </form>
              )}

              {current === "agreement" && (
                <form action={saveWelcomeStep} className="welcome-form">
                  {hidden}
                  <p className="lede">Everything we agreed, in writing. Sign it right here, then settle the deposit and we&apos;re officially underway.</p>
                  {agreement.settled ? (
                    <p className="all-clear">
                      <span aria-hidden="true">✓</span> Signed{agreement.invoice ? " and paid" : ""}. Thank you!
                    </p>
                  ) : (
                    <ol className="start-steps">
                      {(agreement.steps ?? []).filter((s) => s.key !== "build").map((s, i) => (
                        <li key={s.key} data-state={s.state}>
                          <span className="start-num" aria-hidden="true">
                            {s.state === "done" ? "✓" : i + 1}
                          </span>
                          <div className="start-text">
                            <p className="todo-title">{s.label}</p>
                            <p className="todo-detail">
                              {s.state === "locked" ? "Unlocks after signing" : s.key === "pay" && agreement.invoice ? `${agreement.invoice.title}: ${formatMoney(agreement.invoice.amountCents, agreement.invoice.currency)}` : s.detail}
                            </p>
                          </div>
                          {s.state === "current" && s.href && (
                            <Link className="btn btn-primary btn-small" href={`${s.href}${s.href.includes("?") ? "&" : "?"}from=welcome`}>
                              {s.key === "sign" ? "Review & sign" : "Pay deposit"}
                            </Link>
                          )}
                        </li>
                      ))}
                    </ol>
                  )}
                  {footer(agreement.settled ? "Continue" : "Continue, I'll finish this shortly")}
                </form>
              )}

              {current === "you" && (
                <form action={saveWelcomeStep} className="welcome-form">
                  {hidden}
                  <p className="lede">So we always reach the right person, the right way.</p>
                  <div className="form-grid">
                    <div className="field">
                      <label htmlFor="contact_name">Your name *</label>
                      <input id="contact_name" name="contact_name" required maxLength={120} autoComplete="name" defaultValue={o.contact.name ?? viewer.name ?? ""} />
                    </div>
                    <div className="field">
                      <label htmlFor="contact_role">Your role</label>
                      <input id="contact_role" name="contact_role" maxLength={120} autoComplete="organization-title" defaultValue={o.contact.role ?? ""} placeholder="Owner" />
                    </div>
                    <div className="field">
                      <label htmlFor="contact_phone">Mobile</label>
                      <input id="contact_phone" name="contact_phone" type="tel" maxLength={40} autoComplete="tel" defaultValue={o.contact.phone ?? ""} />
                    </div>
                  </div>
                  <div className="field">
                    <p className="q-label">Best way to reach you</p>
                    <Chips name="contact_preferred" options={CONTACT_METHODS} type="radio" selected={[o.contact.preferred ?? "Email"]} />
                  </div>
                  <div className="field">
                    <p className="q-label">Best times</p>
                    <Chips name="contact_times" options={BEST_TIMES} type="checkbox" selected={(o.contact.times ?? "").split(", ")} />
                  </div>
                  <div className="form-grid">
                    <div className="field">
                      <label htmlFor="company_name">Company name *</label>
                      <input id="company_name" name="company_name" required maxLength={120} autoComplete="organization" defaultValue={client.name.startsWith("New client (") ? "" : client.name} />
                    </div>
                    <div className="field">
                      <label htmlFor="company_website">Website</label>
                      <input id="company_website" name="company_website" type="url" maxLength={300} defaultValue={o.contact.website ?? ""} placeholder="https://" />
                    </div>
                  </div>
                  {footer()}
                </form>
              )}

              {current === "team" && (
                <form action={saveWelcomeStep} className="welcome-form">
                  {hidden}
                  <p className="lede">Bring in anyone who should follow along, and tell us who makes the calls.</p>
                  <ul className="task-list team-now">
                    {team.map((m) => (
                      <li key={m.id}>
                        <span>{m.email}</span>
                        <span className="chip">{ROLE_LABEL[m.role]}</span>
                      </li>
                    ))}
                  </ul>
                  {can.inviteTeammates(access) && (
                    <fieldset className="invite-rows">
                      <legend className="q-label">Invite teammates (optional)</legend>
                      {[1, 2, 3].map((i) => (
                        <div key={i} className="invite-row">
                          <input name={`invite_email_${i}`} type="email" placeholder="name@company.com" aria-label={`Teammate ${i} email`} />
                          <select name={`invite_role_${i}`} defaultValue="client_member" aria-label={`Teammate ${i} role`}>
                            <option value="client_member">Can view and comment</option>
                            <option value="client_approver">Can also approve, sign and pay</option>
                          </select>
                        </div>
                      ))}
                    </fieldset>
                  )}
                  <datalist id="team-emails">
                    {team.map((m) => (
                      <option key={m.id} value={m.email} />
                    ))}
                  </datalist>
                  <div className="form-grid">
                    {[
                      { key: "team_approver", label: "Who approves designs?" },
                      { key: "team_signer", label: "Who signs agreements?" },
                      { key: "team_billing", label: "Who pays invoices?" },
                    ].map((r) => (
                      <div className="field" key={r.key}>
                        <label htmlFor={r.key}>{r.label}</label>
                        <input id={r.key} name={r.key} type="email" list="team-emails" defaultValue={o.team[r.key.replace("team_", "")] ?? viewer.email} />
                      </div>
                    ))}
                  </div>
                  <p className="small muted">Anyone new gets an email with how to sign in. No passwords.</p>
                  {footer()}
                </form>
              )}

              {current === "project" && (
                <>
                  <form action={saveWelcomeStep} className="kind-switch">
                    {hidden}
                    <label htmlFor="project_kind" className="small">
                      We&apos;re building a
                    </label>
                    <select id="project_kind" name="project_kind" defaultValue={project.kind}>
                      {PROJECT_KINDS.map((k) => (
                        <option key={k.value} value={k.value}>
                          {k.label}
                        </option>
                      ))}
                    </select>
                    <button className="btn btn-link small" type="submit" name="intent" value="kind" formNoValidate>
                      Update questions
                    </button>
                  </form>
                  <form action={saveWelcomeStep} className="welcome-form">
                    {hidden}
                    <p className="lede">In your own words. There are no wrong answers, and short is fine.</p>
                    {questionsFor(project.kind).map((q) => (
                      <QuestionField key={q.id} q={q} value={o.answers[q.id]} />
                    ))}
                    {footer()}
                  </form>
                </>
              )}

              {current === "brand" && (
                <>
                  <p className="lede">Show us how you look and feel. Watch the preview update as you go.</p>
                  <section className="brand-uploads" aria-labelledby="brand-files-title">
                    <p id="brand-files-title" className="q-label">
                      Logo and brand files
                    </p>
                    {brandFiles.length > 0 && (
                      <ul className="brand-file-list">
                        {brandFiles.map((f) => (
                          <li key={f.id}>
                            {f.contentType?.startsWith("image/") ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={withBase(`/api/files/${f.id}`)} alt={f.name} />
                            ) : (
                              <span className="doc-icon">FILE</span>
                            )}
                            <span className="small">{f.name}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    <form id="brand-upload-fields" hidden>
                      <input type="hidden" name="category" value={logo ? "brand" : "logo"} />
                    </form>
                    <Uploader
                      projectId={project.id}
                      purpose="file"
                      formId="brand-upload-fields"
                      action={registerFile}
                      multiple
                      accept="image/*,application/pdf,.ai,.eps,.svg,.zip"
                      label={logo ? "Add more: brand guide, icons, photos" : "Upload your logo (PNG or SVG works best)"}
                      buttonLabel="Upload"
                    />
                  </section>
                  <form action={saveWelcomeStep} className="welcome-form">
                    {hidden}
                    <BrandStudio
                      companyName={client.name.startsWith("New client (") ? project.name : client.name}
                      logoUrl={logo ? `/api/files/${logo.id}` : null}
                      toneWords={TONE_WORDS}
                      initial={{
                        primary: o.brand.primary as string | undefined,
                        secondary: o.brand.secondary as string | undefined,
                        accent: o.brand.accent as string | undefined,
                        fonts: o.brand.fonts as string | undefined,
                        tone: o.brand.tone as string[] | undefined,
                        noBrand: o.brand.none as boolean | undefined,
                      }}
                    />
                    <div className="field">
                      <label htmlFor="brand_notes">Anything else? Brands you admire, colours to avoid…</label>
                      <textarea id="brand_notes" name="brand_notes" rows={3} maxLength={2000} defaultValue={(o.brand.notes as string) ?? ""} />
                    </div>
                    {footer()}
                  </form>
                </>
              )}

              {current === "access" && (
                <form action={saveWelcomeStep} className="welcome-form">
                  {hidden}
                  <div className="card safe-card">
                    <p className="label">Safe and simple</p>
                    <p>
                      Never send us passwords. For each account, invite <strong>founder@skoxsoftware.com</strong> as a user or admin. Not sure
                      how, or don&apos;t know where it lives? Choose &ldquo;I need help&rdquo; and we&apos;ll sort it together at kickoff.
                    </p>
                  </div>
                  <ul className="access-list">
                    {accessFor(project.kind).map((item) => (
                      <li key={item.id}>
                        <div>
                          <p className="todo-title">{item.label}</p>
                          <p className="todo-detail">{item.why}</p>
                        </div>
                        <div className="tag-choice" role="radiogroup" aria-label={item.label}>
                          {(Object.entries(ACCESS_STATUS) as [string, string][]).map(([value, label]) => (
                            <label key={value} className="tag-option" data-tone={value}>
                              <input type="radio" name={`access_${item.id}`} value={value} defaultChecked={o.access[item.id]?.status === value} />
                              <span>{label}</span>
                            </label>
                          ))}
                        </div>
                      </li>
                    ))}
                  </ul>
                  <div className="field">
                    <label htmlFor="access_other">Any other accounts or tools we should know about?</label>
                    <textarea id="access_other" name="access_other" rows={3} maxLength={2000} defaultValue={o.access.other?.note ?? ""} />
                  </div>
                  {footer()}
                </form>
              )}

              {current === "kickoff" && (
                <form action={saveWelcomeStep} className="welcome-form">
                  {hidden}
                  <p className="lede">A focused call to confirm the plan, walk through your must-haves and set the launch date together.</p>
                  <div className="card agenda-card">
                    <p className="label">Your kickoff agenda (built from your answers)</p>
                    <ol>
                      <li>Your goal{o.answers.goal ? `: “${String(o.answers.goal).slice(0, 120)}”` : ""}</li>
                      <li>Must-haves for launch{lines(o.answers.mustHaves).length ? ` (${lines(o.answers.mustHaves).length})` : ""}</li>
                      <li>Brand and content{o.brand.none ? ": building your look from scratch" : ""}</li>
                      <li>
                        Access
                        {Object.values(o.access).filter((a) => a.status === "help").length
                          ? `: ${Object.values(o.access).filter((a) => a.status === "help").length} to set up together`
                          : ""}
                      </li>
                      <li>Launch date and first milestone</li>
                    </ol>
                  </div>
                  {kickoffUrl && <p className="small muted">For the company/project field, use <strong>{client.name} · {project.name}</strong>.</p>}
                  <BookingEmbed url={kickoffUrl} title="Kickoff" projectId={project.id} />
                  <div className="field">
                    <p className="q-label">Kickoff</p>
                    <div className="tag-choice">
                      {kickoffUrl && (
                        <label className="tag-option">
                          <input type="radio" name="kickoff_status" value="booked" defaultChecked={o.kickoff.status === "booked"} />
                          <span>I&apos;ve booked a time</span>
                        </label>
                      )}
                      <label className="tag-option">
                        <input type="radio" name="kickoff_status" value="reach_out" defaultChecked={!kickoffUrl || o.kickoff.status === "reach_out"} />
                        <span>Please reach out to schedule</span>
                      </label>
                    </div>
                  </div>
                  <div className="form-grid">
                    <div className="field">
                      <label htmlFor="kickoff_times">Days and times that usually work</label>
                      <input id="kickoff_times" name="kickoff_times" maxLength={300} defaultValue={o.kickoff.times ?? ""} placeholder="Tue/Thu mornings" />
                    </div>
                  </div>
                  <div className="field">
                    <label htmlFor="kickoff_notes">Anything you&apos;d like to cover?</label>
                    <textarea id="kickoff_notes" name="kickoff_notes" rows={3} maxLength={2000} defaultValue={o.kickoff.notes ?? ""} />
                  </div>
                  {footer(nav.next ? "Continue" : "Finish setup ✓")}
                </form>
              )}
            </div>
          )}
        </section>
      </main>
    </>
  );
}
