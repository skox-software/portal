import { asc, desc, eq, inArray } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { readMessage } from "@/components/Notice";
import { ProjectHeader } from "@/components/ProjectHeader";
import { Uploader } from "@/components/Uploader";
import { getDb } from "@/lib/db";
import { documents, documentSigners, memberships } from "@/lib/db/schema";
import { DOCUMENT_KIND_LABEL, formatDate, ROLE_LABEL } from "@/lib/format";
import { loadProjectShell } from "@/lib/project-shell";
import { sendDocument } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Documents" };

export default async function DocumentsPage({
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

  const docs = await db.select().from(documents).where(eq(documents.projectId, project.id)).orderBy(desc(documents.createdAt));
  const signers = docs.length
    ? await db.select().from(documentSigners).where(inArray(documentSigners.documentId, docs.map((d) => d.id)))
    : [];
  const people = access.isStaff
    ? await db
        .select()
        .from(memberships)
        .where(eq(memberships.workspaceId, project.workspaceId))
        .orderBy(asc(memberships.email))
    : [];
  const eligible = people.filter((p) => p.clientId === project.clientId || p.clientId === null);

  const needsMe = docs.filter(
    (d) => d.status === "out_for_signature" && signers.some((s) => s.documentId === d.id && s.email === viewer.email && s.status !== "signed"),
  );
  const rest = docs.filter((d) => !needsMe.includes(d));

  const row = (d: (typeof docs)[number]) => {
    const mine = signers.filter((s) => s.documentId === d.id);
    const signed = mine.filter((s) => s.status === "signed").length;
    return (
      <li key={d.id} className="doc-row">
        <span className="doc-icon" aria-hidden="true">
          PDF
        </span>
        <div className="doc-main">
          <Link href={`/projects/${project.id}/documents/${d.id}`} className="doc-title">
            {d.title}
          </Link>
          <p className="small muted">
            {DOCUMENT_KIND_LABEL[d.kind]} · sent {formatDate(d.createdAt.toISOString().slice(0, 10))}
            {d.status === "out_for_signature" && ` · ${signed} of ${mine.length} signed`}
          </p>
        </div>
        <span className={d.status === "completed" ? "chip chip-ok" : d.status === "void" ? "chip" : "chip chip-amber"}>
          {d.status === "completed" ? "Signed" : d.status === "void" ? "Cancelled" : "Awaiting signatures"}
        </span>
      </li>
    );
  };

  return (
    <>
      <ProjectHeader
        shell={shell}
        tab="documents"
        title="Documents"
        intro="Proposals, agreements and anything that needs a signature. Sign right here, in under a minute."
        error={readMessage(sp.error)}
        notice={readMessage(sp.notice)}
      />
      <main className="shell page page-after-band">
        {needsMe.length > 0 && (
          <section className="card card-todo" aria-labelledby="sign-title">
            <div className="card-head">
              <h2 id="sign-title">Waiting for your signature</h2>
              <span className="chip chip-amber">{needsMe.length}</span>
            </div>
            <ul className="doc-list">
              {needsMe.map((d) => (
                <li key={d.id} className="doc-row">
                  <span className="doc-icon" aria-hidden="true">
                    PDF
                  </span>
                  <div className="doc-main">
                    <p className="doc-title">{d.title}</p>
                    <p className="small muted">{DOCUMENT_KIND_LABEL[d.kind]}</p>
                  </div>
                  <Link className="btn btn-primary btn-small" href={`/projects/${project.id}/documents/${d.id}`}>
                    Review &amp; sign
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {access.isStaff && (
          <section className="card staff-card" aria-labelledby="send-title">
            <div className="card-head">
              <h2 id="send-title">Send a document for signature</h2>
              <span className="chip chip-skox">SKOX only</span>
            </div>
            <form id="doc-fields" className="stack">
              <div className="form-grid">
                <div className="field">
                  <label htmlFor="d-title">Title</label>
                  <input id="d-title" name="title" required maxLength={160} placeholder="e.g. Website build agreement" />
                </div>
                <div className="field">
                  <label htmlFor="d-kind">Type</label>
                  <select id="d-kind" name="kind" defaultValue="contract">
                    {Object.entries(DOCUMENT_KIND_LABEL).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="field">
                <label htmlFor="d-message">Message (shown in the email)</label>
                <textarea id="d-message" name="message" maxLength={2000} placeholder="Here's the agreement we discussed…" />
              </div>
              <fieldset className="signer-pick">
                <legend>Who signs</legend>
                {eligible.length === 0 ? (
                  <p className="small muted">Invite the client first on the client page.</p>
                ) : (
                  eligible.map((p) => (
                    <label key={p.id} className="check">
                      <input type="checkbox" name="signers" value={p.email} defaultChecked={p.role === "client_approver"} />
                      <span>
                        {p.email} <span className="muted small">({ROLE_LABEL[p.role]})</span>
                      </span>
                    </label>
                  ))
                )}
              </fieldset>
            </form>
            <Uploader
              projectId={project.id}
              purpose="document"
              formId="doc-fields"
              action={sendDocument}
              accept="application/pdf"
              label="Choose the PDF"
              buttonLabel="Send for signature"
            />
          </section>
        )}

        <section className="card" aria-labelledby="all-docs">
          <div className="card-head">
            <h2 id="all-docs">All documents</h2>
          </div>
          {rest.length === 0 && needsMe.length === 0 ? (
            <p className="empty">Nothing here yet. When SKOX sends you something to sign, it lands here and in your inbox.</p>
          ) : rest.length === 0 ? (
            <p className="muted small">Everything else is signed and filed.</p>
          ) : (
            <ul className="doc-list">{rest.map(row)}</ul>
          )}
        </section>
      </main>
    </>
  );
}
