import { desc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { readMessage } from "@/components/Notice";
import { ProjectHeader } from "@/components/ProjectHeader";
import { Uploader } from "@/components/Uploader";
import { getDb } from "@/lib/db";
import { files } from "@/lib/db/schema";
import { formatDateTime } from "@/lib/format";
import { loadProjectShell } from "@/lib/project-shell";
import { formatBytes } from "@/lib/storage";
import { deleteFile, registerFile } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Files" };

function kindOf(contentType: string | null, name: string) {
  if (contentType?.startsWith("image/")) return "IMG";
  if (contentType === "application/pdf") return "PDF";
  const ext = name.split(".").pop();
  return ext && ext.length <= 4 ? ext.toUpperCase() : "FILE";
}

export default async function FilesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const shell = await loadProjectShell(id);
  const { project, access, viewer } = shell;
  const list = await getDb().select().from(files).where(eq(files.projectId, project.id)).orderBy(desc(files.createdAt));
  const fromYou = list.filter((f) => f.fromClient);
  const fromUs = list.filter((f) => !f.fromClient);

  const table = (items: typeof list, empty: string) =>
    items.length === 0 ? (
      <p className="muted small">{empty}</p>
    ) : (
      <ul className="doc-list">
        {items.map((f) => (
          <li key={f.id} className="doc-row">
            <span className="doc-icon" aria-hidden="true">
              {kindOf(f.contentType, f.name)}
            </span>
            <div className="doc-main">
              <a className="doc-title" href={`/api/files/${f.id}`} target="_blank" rel="noopener noreferrer">
                {f.name}
              </a>
              <p className="small muted">
                {formatBytes(f.sizeBytes)} · {f.uploadedByEmail ?? "SKOX"} · {formatDateTime(f.createdAt)}
              </p>
            </div>
            <div className="row">
              <a className="btn btn-ghost btn-small" href={`/api/files/${f.id}?download=1`}>
                Download
              </a>
              {(access.isStaff || f.uploadedBy === viewer.userId) && (
                <form action={deleteFile}>
                  <input type="hidden" name="fileId" value={f.id} />
                  <button className="btn btn-link small" type="submit">
                    Remove
                  </button>
                </form>
              )}
            </div>
          </li>
        ))}
      </ul>
    );

  return (
    <>
      <ProjectHeader
        shell={shell}
        tab="files"
        title="Files"
        intro="Logos, photos, copy, logins notes: everything for the project in one safe place, instead of lost in email."
        error={readMessage(sp.error)}
        notice={readMessage(sp.notice)}
      />
      <main className="shell page page-after-band">
        <section className="card" aria-labelledby="upload-title">
          <div className="card-head">
            <h2 id="upload-title">{access.isStaff ? "Share a file with the client" : "Send us files"}</h2>
          </div>
          <Uploader
            projectId={project.id}
            purpose="file"
            action={registerFile}
            multiple
            label="Choose files (up to 50 MB each). Private: only your team and SKOX can see them."
            buttonLabel="Upload"
          />
        </section>
        <div className="split split-even">
          <section className="card" aria-labelledby="from-client">
            <div className="card-head">
              <h2 id="from-client">{access.isStaff ? "From the client" : "From you"}</h2>
            </div>
            {table(fromYou, "Nothing uploaded yet.")}
          </section>
          <section className="card" aria-labelledby="from-skox">
            <div className="card-head">
              <h2 id="from-skox">From SKOX</h2>
            </div>
            {table(fromUs, "We'll share designs, exports and handover files here.")}
          </section>
        </div>
      </main>
    </>
  );
}
