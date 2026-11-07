import { desc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { Uploader } from "@/components/Uploader";
import { requireStaff } from "@/lib/access";
import { getDb } from "@/lib/db";
import { salesFiles } from "@/lib/db/schema";
import { formatDateTime } from "@/lib/format";
import { withBase } from "@/lib/paths";
import { inlineKind, kindLabel } from "@/lib/sales-files";
import { formatBytes } from "@/lib/storage";
import { registerSalesFile, removeSalesFile } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sales files" };

/** The team's sales material in one private place: demo videos, one-pagers, decks. */
export default async function SalesFilesPage() {
  const { staff } = await requireStaff();
  const list = await getDb()
    .select()
    .from(salesFiles)
    .where(eq(salesFiles.workspaceId, staff.workspaceId))
    .orderBy(desc(salesFiles.createdAt));

  return (
    <main className="shell page sales-files-page">
      <div className="crm-head">
        <div>
          <p className="eyebrow">Sales</p>
          <h1>Sales files</h1>
          <p className="muted">
            Demo videos, one-pagers and decks for whoever is selling. Only the UnBusy team can open these; download a file to
            send it to a prospect.
          </p>
        </div>
      </div>

      <section className="card" aria-labelledby="sales-files-list">
        <div className="card-head">
          <h2 id="sales-files-list">Files</h2>
          <span className="chip">{list.length}</span>
        </div>
        {list.length === 0 ? (
          <p className="empty">Nothing here yet. Add the first file below.</p>
        ) : (
          <ul className="sales-files">
            {list.map((f) => {
              const href = withBase(`/api/sales-files/${f.id}`);
              const kind = inlineKind(f.contentType);
              return (
                <li key={f.id} className="sales-file">
                  {kind === "video" && (
                    <video className="sales-file-video" src={href} controls preload="metadata" playsInline aria-label={f.title} />
                  )}
                  {kind === "image" && (
                    // eslint-disable-next-line @next/next/no-img-element -- private file behind an access check, not an optimisable asset
                    <img className="sales-file-image" src={href} alt={f.title} loading="lazy" />
                  )}
                  <div className="sales-file-main">
                    <p className="doc-title">
                      {kind ? (
                        <a href={href} target="_blank" rel="noopener noreferrer">
                          {f.title}
                        </a>
                      ) : (
                        f.title
                      )}
                    </p>
                    {f.note && <p className="small">{f.note}</p>}
                    <p className="small muted">
                      {kindLabel(f.contentType, f.fileName)} · {formatBytes(f.sizeBytes)} · {f.uploadedByEmail ?? "UnBusy"} ·{" "}
                      {formatDateTime(f.createdAt)}
                    </p>
                  </div>
                  <div className="sales-file-actions">
                    <a className="btn btn-primary btn-small" href={`${href}?download=1`}>
                      Download
                    </a>
                    <details className="sales-file-remove">
                      <summary className="btn btn-link small">Remove</summary>
                      <form action={removeSalesFile}>
                        <input type="hidden" name="fileId" value={f.id} />
                        <p className="small">Remove {f.title} for the whole team?</p>
                        <button className="btn btn-ghost btn-small" type="submit">
                          Yes, remove it
                        </button>
                      </form>
                    </details>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="card" aria-labelledby="sales-files-add">
        <div className="card-head">
          <h2 id="sales-files-add">Add a file</h2>
        </div>
        <form id="sales-file-fields" className="sales-file-fields">
          <div className="field">
            <label htmlFor="sales-file-title">Title</label>
            <input id="sales-file-title" name="title" maxLength={140} placeholder="Leave blank to use the file name" />
          </div>
          <div className="field">
            <label htmlFor="sales-file-note">Note for the team (optional)</label>
            <input id="sales-file-note" name="note" maxLength={500} placeholder="Who it's for, when to send it" />
          </div>
        </form>
        <Uploader
          salesWorkspaceId={staff.workspaceId}
          action={registerSalesFile}
          formId="sales-file-fields"
          label="Choose a file (up to 500 MB). Private to the UnBusy team."
          buttonLabel="Add file"
        />
      </section>
    </main>
  );
}
