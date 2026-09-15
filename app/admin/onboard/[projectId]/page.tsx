import { and, asc, desc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Notice, readMessage } from "@/components/Notice";
import { TopBar } from "@/components/TopBar";
import { Uploader } from "@/components/Uploader";
import { sendDocument } from "@/app/projects/[id]/documents/actions";
import { requireStaff } from "@/lib/access";
import { getDb } from "@/lib/db";
import { clients, documents, invoices, memberships, onboardings, projects } from "@/lib/db/schema";
import { formatDate, formatMoney, kindLabel, todayIso } from "@/lib/format";
import { withBase } from "@/lib/paths";
import { addDeposit, sendWelcome } from "../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Ready to welcome" };

/**
 * Step 2 of starting onboarding: attach the agreement and deposit, preview
 * what the client will see first, then send the one welcome email.
 */
export default async function PrepareWelcome({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ projectId }, sp] = await Promise.all([params, searchParams]);
  const { viewer, staff } = await requireStaff();
  if (!/^[0-9a-f-]{36}$/i.test(projectId)) notFound();
  const db = getDb();
  const [row] = await db
    .select({ project: projects, client: clients, onboarding: onboardings })
    .from(projects)
    .innerJoin(clients, eq(clients.id, projects.clientId))
    .innerJoin(onboardings, eq(onboardings.projectId, projects.id))
    .where(and(eq(projects.id, projectId), eq(projects.workspaceId, staff.workspaceId)))
    .limit(1);
  if (!row) notFound();
  const { project, client, onboarding } = row;
  const [docs, deposits, people] = await Promise.all([
    db.select().from(documents).where(eq(documents.projectId, project.id)).orderBy(desc(documents.createdAt)),
    db.select().from(invoices).where(eq(invoices.projectId, project.id)).orderBy(desc(invoices.createdAt)),
    db.select().from(memberships).where(eq(memberships.clientId, client.id)).orderBy(asc(memberships.createdAt)),
  ]);
  const doc = docs.find((d) => d.status !== "void");
  const deposit = deposits.find((d) => d.status !== "void");
  const sent = Boolean(onboarding.welcomeSentAt);

  return (
    <>
      <TopBar viewer={viewer} />
      <main className="shell page" style={{ maxWidth: 880 }}>
        <div className="page-head">
          <div>
            <p className="eyebrow">
              <Link href="/admin/onboard">Onboarding</Link> / {client.name}
            </p>
            <h1>{sent ? "Welcome sent" : "Ready to welcome"}</h1>
            <p className="page-intro">
              {onboarding.invitedEmail} · {project.name} · {kindLabel(project.kind)} ·{" "}
              {project.dateTentative ? "launch date set at kickoff" : `launch ${formatDate(project.deliveryDate)}`}
            </p>
          </div>
        </div>
        <Notice error={readMessage(sp.error)} notice={readMessage(sp.notice)} />

        <ol className="prep-steps">
          <li data-done={doc ? "true" : undefined}>
            <div className="prep-head">
              <span className="prep-num">{doc ? "✓" : 1}</span>
              <div>
                <h2>Attach the agreement</h2>
                <p className="small muted">The first thing they see after the welcome. They sign it in the portal.</p>
              </div>
            </div>
            {doc ? (
              <p className="small">
                <strong style={{ fontWeight: 500 }}>{doc.title}</strong> is attached and waiting for {onboarding.invitedEmail}.{" "}
                <Link href={`/projects/${project.id}/documents/${doc.id}`}>Preview</Link>
              </p>
            ) : (
              <>
                <form id="agreement-fields" className="form-grid">
                  <input type="hidden" name="silent" value="1" />
                  <input type="hidden" name="kind" value="contract" />
                  {people.map((p) => (
                    <input key={p.id} type="hidden" name="signers" value={p.email} />
                  ))}
                  <div className="field" style={{ gridColumn: "1 / -1" }}>
                    <label htmlFor="ag-title">Title</label>
                    <input id="ag-title" name="title" required defaultValue={`${project.name} agreement`} maxLength={160} />
                  </div>
                  <div className="field" style={{ gridColumn: "1 / -1" }}>
                    <label htmlFor="ag-message">A line above the document (optional)</label>
                    <input id="ag-message" name="message" maxLength={2000} placeholder="As we discussed, here's everything in writing." />
                  </div>
                </form>
                <Uploader
                  projectId={project.id}
                  purpose="document"
                  formId="agreement-fields"
                  action={sendDocument}
                  accept="application/pdf"
                  label="Choose the agreement PDF"
                  buttonLabel="Attach agreement"
                />
              </>
            )}
          </li>

          <li data-done={deposit ? "true" : undefined}>
            <div className="prep-head">
              <span className="prep-num">{deposit ? "✓" : 2}</span>
              <div>
                <h2>Add the deposit</h2>
                <p className="small muted">Unlocks for payment the moment they sign. Paying it moves the project into Building.</p>
              </div>
            </div>
            {deposit ? (
              <p className="small">
                {deposit.title}: <strong style={{ fontWeight: 500 }}>{formatMoney(deposit.amountCents, deposit.currency)}</strong>, due{" "}
                {formatDate(deposit.dueOn)}.
              </p>
            ) : (
              <form action={addDeposit} className="form-grid">
                <input type="hidden" name="projectId" value={project.id} />
                <input type="hidden" name="documentId" value={doc?.id ?? ""} />
                <div className="field">
                  <label htmlFor="dp-amount">Amount (USD)</label>
                  <input id="dp-amount" name="amount" type="number" min="1" step="0.01" required placeholder="2500" />
                </div>
                <div className="field">
                  <label htmlFor="dp-due">Due</label>
                  <input id="dp-due" name="dueOn" type="date" required defaultValue={todayIso(new Date(Date.parse(`${todayIso()}T00:00:00Z`) + 7 * 86_400_000))} />
                </div>
                <div className="field">
                  <label htmlFor="dp-title">Label</label>
                  <input id="dp-title" name="title" defaultValue="50% deposit" maxLength={160} />
                </div>
                <div className="field">
                  <label htmlFor="dp-pay">Pay link (optional)</label>
                  <input id="dp-pay" name="payUrl" type="url" placeholder="https://buy.stripe.com/…" />
                </div>
                <div>
                  <button className="btn btn-ghost" type="submit" disabled={!doc} title={doc ? undefined : "Attach the agreement first"}>
                    Add deposit
                  </button>
                </div>
              </form>
            )}
          </li>

          <li data-done={sent ? "true" : undefined}>
            <div className="prep-head">
              <span className="prep-num">{sent ? "✓" : 3}</span>
              <div>
                <h2>Send the welcome</h2>
                <p className="small muted">
                  One email from SKOX: {doc ? "“Review your agreement”" : "“Start your welcome”"}, then the guided setup in the portal.
                </p>
              </div>
            </div>
            <div className="row">
              <form action={sendWelcome}>
                <input type="hidden" name="onboardingId" value={onboarding.id} />
                <button className="btn btn-primary btn-lg" type="submit">
                  {sent ? "Resend welcome" : doc ? "Send the welcome →" : "Send without an agreement →"}
                </button>
              </form>
              <Link className="btn btn-link small" href={`/projects/${project.id}/welcome`}>
                Preview what they&apos;ll see
              </Link>
              <a className="btn btn-link small" href={withBase(`/api/projects/${project.id}/welcome-guide`)} target="_blank" rel="noopener noreferrer">
                Preview their welcome guide (PDF)
              </a>
            </div>
            {!doc && !sent && (
              <p className="small muted" style={{ marginTop: 8 }}>
                No agreement yet? You can still send it. When you attach one later it appears in their setup automatically.
              </p>
            )}
          </li>
        </ol>
      </main>
    </>
  );
}
