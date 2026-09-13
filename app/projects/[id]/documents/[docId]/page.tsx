import { and, eq, isNull } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { ProjectHeader } from "@/components/ProjectHeader";
import { SignPanel } from "@/components/SignPanel";
import { getDb } from "@/lib/db";
import { documents, documentSigners, invoices } from "@/lib/db/schema";
import { DOCUMENT_KIND_LABEL, formatDateTime, formatMoney } from "@/lib/format";
import { canSign } from "@/lib/permissions";
import { loadProjectShell } from "@/lib/project-shell";
import { CONSENT_TEXT } from "@/lib/signing";
import { remindSigners, voidDocument } from "../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Document" };

export default async function DocumentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; docId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id, docId }, sp] = await Promise.all([params, searchParams]);
  const fromWelcome = sp.from === "welcome";
  const shell = await loadProjectShell(id);
  const { project, viewer, access } = shell;
  if (!/^[0-9a-f-]{36}$/i.test(docId)) notFound();
  const db = getDb();
  const [doc] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, docId), eq(documents.projectId, project.id)))
    .limit(1);
  if (!doc) notFound();
  const [signers, [deposit]] = await Promise.all([
    db.select().from(documentSigners).where(eq(documentSigners.documentId, doc.id)),
    db
      .select()
      .from(invoices)
      .where(and(eq(invoices.documentId, doc.id), eq(invoices.status, "open")))
      .limit(1),
  ]);
  const mine = signers.find((s) => s.email === viewer.email);
  const maySign = canSign(viewer.email, doc, mine);

  if (mine && !mine.viewedAt) {
    after(async () => {
      await getDb()
        .update(documentSigners)
        .set({ viewedAt: new Date(), status: "viewed" })
        .where(and(eq(documentSigners.id, mine.id), isNull(documentSigners.viewedAt), eq(documentSigners.status, "pending")));
    });
  }

  const pdfUrl = `/api/documents/${doc.id}${doc.status === "completed" ? "?signed=1" : ""}`;

  return (
    <>
      <ProjectHeader shell={shell} tab="documents" title={doc.title} intro={`${DOCUMENT_KIND_LABEL[doc.kind]} for ${project.name}`} />
      <main className="shell page page-after-band">
        <p className="small" style={{ marginBottom: 14 }}>
          {fromWelcome ? (
            <Link href={`/projects/${project.id}/welcome?step=agreement`}>← Back to your setup</Link>
          ) : (
            <Link href={`/projects/${project.id}/documents`}>← All documents</Link>
          )}
        </p>
        <div className="doc-layout">
          <div className="pdf-frame">
            <iframe src={pdfUrl} title={doc.title} />
            <p className="small muted" style={{ marginTop: 8 }}>
              Can&apos;t see it?{" "}
              <a href={pdfUrl} target="_blank" rel="noopener noreferrer">
                Open the PDF in a new tab
              </a>
              .
            </p>
          </div>

          <aside className="stack">
            {doc.message && (
              <section className="card">
                <p className="label">Message from SKOX</p>
                <p style={{ whiteSpace: "pre-line", marginTop: 6 }}>{doc.message}</p>
              </section>
            )}

            {doc.status === "out_for_signature" && maySign && (
              <section className="card card-sign" aria-labelledby="sign-now">
                <h2 id="sign-now" style={{ fontSize: 26, marginBottom: 12 }}>
                  Sign this document
                </h2>
                <SignPanel documentId={doc.id} consentText={CONSENT_TEXT} defaultName={viewer.name ?? ""} />
              </section>
            )}

            {doc.status === "completed" && (
              <section className="card card-ok">
                <h2 style={{ fontSize: 24 }}>Fully signed</h2>
                <p className="small muted" style={{ margin: "6px 0 12px" }}>
                  Completed {doc.completedAt ? formatDateTime(doc.completedAt) : ""}. The signed copy ends with a signature certificate.
                </p>
                <div className="row">
                  {deposit && !access.isStaff && (
                    <Link className="btn btn-primary" href={`/projects/${project.id}/billing${fromWelcome ? "?from=welcome" : ""}`}>
                      Next: pay the deposit ({formatMoney(deposit.amountCents, deposit.currency)}) →
                    </Link>
                  )}
                  <a className={deposit && !access.isStaff ? "btn btn-ghost" : "btn btn-primary"} href={`/api/documents/${doc.id}?signed=1&download=1`}>
                    Download signed PDF
                  </a>
                </div>
              </section>
            )}

            {doc.status === "void" && (
              <section className="card">
                <h2 style={{ fontSize: 24 }}>Cancelled</h2>
                <p className="small muted">SKOX cancelled this document. Nothing to sign.</p>
              </section>
            )}

            <section className="card" aria-labelledby="signers-title">
              <div className="card-head">
                <h2 id="signers-title">Signers</h2>
              </div>
              <ul className="task-list">
                {signers.map((s) => (
                  <li key={s.id}>
                    <span>
                      {s.typedName ?? s.email}
                      {s.typedName && <span className="muted small"> · {s.email}</span>}
                    </span>
                    <span className={s.status === "signed" ? "chip chip-ok" : s.status === "viewed" ? "chip chip-amber" : "chip"}>
                      {s.status === "signed" && s.signedAt ? `Signed ${formatDateTime(s.signedAt)}` : s.status === "viewed" ? "Opened" : "Not opened"}
                    </span>
                  </li>
                ))}
              </ul>
              {access.isStaff && doc.status === "out_for_signature" && (
                <div className="row" style={{ marginTop: 12 }}>
                  <form action={remindSigners}>
                    <input type="hidden" name="documentId" value={doc.id} />
                    <button className="btn btn-ghost btn-small" type="submit">
                      Email a reminder
                    </button>
                  </form>
                  <form action={voidDocument}>
                    <input type="hidden" name="documentId" value={doc.id} />
                    <button className="btn btn-link small" type="submit">
                      Cancel document
                    </button>
                  </form>
                </div>
              )}
            </section>

            <p className="small muted">Document ID {doc.id}. Fingerprint {doc.sha256.slice(0, 16)}…</p>
          </aside>
        </div>
      </main>
    </>
  );
}
