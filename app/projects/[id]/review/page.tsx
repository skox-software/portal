import { and, asc, desc, eq, isNotNull } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { readMessage } from "@/components/Notice";
import { PinBoard, type Pin } from "@/components/PinBoard";
import { ProjectHeader } from "@/components/ProjectHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { Uploader } from "@/components/Uploader";
import { getDb } from "@/lib/db";
import { approvals, feedback, previews } from "@/lib/db/schema";
import { formatDateTime } from "@/lib/format";
import { withBase } from "@/lib/paths";
import { can } from "@/lib/permissions";
import { loadProjectShell } from "@/lib/project-shell";
import { createReviewRound, decideApproval, setFeedbackStatus } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Review" };

const TAG_LABEL = { love: "Love it", change: "Change", must_fix: "Must fix" } as const;
const FEEDBACK_STATUS = { open: "Open", in_progress: "Working on it", done: "Done", wont_do: "Won't do" } as const;
const APPROVAL_KIND = { halfway: "Halfway review", launch: "Launch approval", other: "Approval" } as const;

export default async function ReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const shell = await loadProjectShell(id);
  const { project, access } = shell;
  const db = getDb();

  const rounds = await db
    .select()
    .from(previews)
    .where(and(eq(previews.projectId, project.id), isNotNull(previews.imageKey)))
    .orderBy(desc(previews.createdAt));
  const selectedId = typeof sp.round === "string" && rounds.some((r) => r.id === sp.round) ? sp.round : rounds[0]?.id;
  const selected = rounds.find((r) => r.id === selectedId);

  const [items, roundApprovals] = selected
    ? await Promise.all([
        db.select().from(feedback).where(eq(feedback.previewId, selected.id)).orderBy(asc(feedback.createdAt)),
        db.select().from(approvals).where(eq(approvals.previewId, selected.id)).orderBy(desc(approvals.createdAt)),
      ])
    : [[], []];

  const pins: Pin[] = items.map((f, i) => ({
    id: f.id,
    x: f.x,
    y: f.y,
    body: f.body,
    tag: f.tag,
    status: f.status,
    author: f.authorId,
    number: i + 1,
  }));
  const approval = roundApprovals[0];
  const base = `/projects/${project.id}/review`;

  return (
    <>
      <ProjectHeader
        shell={shell}
        tab="review"
        title="Review the work"
        intro="Click anywhere on a design to tell us exactly what you love or what should change."
        error={readMessage(sp.error)}
        notice={readMessage(sp.notice)}
      />
      <main className="shell page page-after-band">
        {access.isStaff && (
          <section className="card staff-card" aria-labelledby="new-round">
            <div className="card-head">
              <h2 id="new-round">Post designs for review</h2>
              <span className="chip chip-skox">UnBusy only</span>
            </div>
            <form id="round-fields" className="form-grid" onSubmit={undefined}>
              <div className="field">
                <label htmlFor="r-label">Round name</label>
                <input id="r-label" name="label" required maxLength={120} placeholder="e.g. Homepage v2" />
              </div>
              <div className="field">
                <label htmlFor="r-url">Live preview link (optional)</label>
                <input id="r-url" name="url" type="url" placeholder="https://" />
              </div>
              <div className="field">
                <label htmlFor="r-approval">Ask for approval?</label>
                <select id="r-approval" name="approval" defaultValue="none">
                  <option value="none">No, feedback only</option>
                  <option value="halfway">Yes: halfway review</option>
                  <option value="launch">Yes: launch approval</option>
                  <option value="other">Yes: other approval</option>
                </select>
              </div>
              <div className="field" style={{ gridColumn: "1 / -1" }}>
                <label htmlFor="r-notes">Note to the client</label>
                <textarea id="r-notes" name="notes" maxLength={2000} placeholder="What changed and what you want their eyes on" />
              </div>
            </form>
            <Uploader
              projectId={project.id}
              purpose="screenshot"
              formId="round-fields"
              action={createReviewRound}
              accept="image/png,image/jpeg,image/webp,image/gif"
              label="Choose a full-page screenshot (PNG or JPG)"
              buttonLabel="Post and email the client"
            />
          </section>
        )}

        {rounds.length === 0 ? (
          <p className="empty">No designs to review yet. When we have something to show you, it appears here and we email you.</p>
        ) : (
          <>
            {rounds.length > 1 && (
              <nav className="round-tabs" aria-label="Review rounds">
                {rounds.map((r) => (
                  <Link key={r.id} href={`${base}?round=${r.id}`} aria-current={r.id === selectedId ? "page" : undefined}>
                    {r.label ?? "Round"}
                    <span className="muted small"> · {formatDateTime(r.createdAt)}</span>
                  </Link>
                ))}
              </nav>
            )}

            {selected && (
              <div className="review-layout">
                <div>
                  <div className="card-head" style={{ marginBottom: 10 }}>
                    <h2>{selected.label}</h2>
                    {selected.url && (
                      <a href={selected.url} target="_blank" rel="noopener noreferrer" className="small">
                        Open live preview ↗
                      </a>
                    )}
                  </div>
                  {selected.notes && <p className="muted" style={{ marginBottom: 12, whiteSpace: "pre-line" }}>{selected.notes}</p>}
                  <PinBoard
                    projectId={project.id}
                    previewId={selected.id}
                    imageUrl={withBase(`/api/previews/${selected.id}/image`)}
                    label={selected.label ?? "Design"}
                    pins={pins}
                  />
                </div>

                <aside className="stack">
                  {approval && (
                    <section className="card approval-card" data-state={approval.state} aria-labelledby="approval-title">
                      <div className="card-head">
                        <h2 id="approval-title">{APPROVAL_KIND[approval.kind]}</h2>
                        <span className={approval.state === "approved" ? "chip chip-ok" : approval.state === "requested" ? "chip chip-amber" : "chip chip-danger"}>
                          {approval.state === "approved" ? "Approved" : approval.state === "requested" ? "Waiting" : "Changes requested"}
                        </span>
                      </div>
                      {approval.state === "requested" ? (
                        can.approve(access) ? (
                          <form action={decideApproval} className="stack">
                            <input type="hidden" name="projectId" value={project.id} />
                            <input type="hidden" name="approvalId" value={approval.id} />
                            <div className="field">
                              <label htmlFor="ap-note">Note (optional)</label>
                              <textarea id="ap-note" name="note" maxLength={2000} placeholder="Anything we should know" />
                            </div>
                            <div className="row">
                              <SubmitButton className="btn btn-primary" name="decision" value="approved" pendingLabel="Approving…">
                                Approve this round
                              </SubmitButton>
                              <SubmitButton className="btn btn-ghost" name="decision" value="changes_requested" pendingLabel="Sending…">
                                Request changes
                              </SubmitButton>
                            </div>
                          </form>
                        ) : (
                          <p className="small muted">Waiting on your approver. Your comments still help.</p>
                        )
                      ) : (
                        <p className="small muted">
                          {approval.decidedBy} · {approval.decidedAt ? formatDateTime(approval.decidedAt) : ""}
                          {approval.note ? ` · “${approval.note}”` : ""}
                        </p>
                      )}
                    </section>
                  )}

                  <section className="card" aria-labelledby="comments-title">
                    <div className="card-head">
                      <h2 id="comments-title">Comments</h2>
                      <span className="muted small">
                        {items.filter((i) => i.status === "done").length} of {items.length} done
                      </span>
                    </div>
                    {items.length === 0 ? (
                      <p className="muted small">No comments yet. Click on the design to add the first one.</p>
                    ) : (
                      <ol className="comment-list">
                        {items.map((f, i) => (
                          <li key={f.id} data-done={f.status === "done" || f.status === "wont_do" ? "true" : undefined}>
                            <span className="pin-num" data-tag={f.tag}>
                              {i + 1}
                            </span>
                            <div className="stack" style={{ gap: 4 }}>
                              <p>{f.body}</p>
                              <p className="small muted">
                                {TAG_LABEL[f.tag]} · {f.authorId} · {FEEDBACK_STATUS[f.status]}
                              </p>
                              {access.isStaff && (
                                <form action={setFeedbackStatus} className="inline-form">
                                  <input type="hidden" name="projectId" value={project.id} />
                                  <input type="hidden" name="feedbackId" value={f.id} />
                                  <select name="status" defaultValue={f.status} aria-label="Status">
                                    {Object.entries(FEEDBACK_STATUS).map(([v, l]) => (
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
                      </ol>
                    )}
                  </section>
                </aside>
              </div>
            )}
          </>
        )}
      </main>
    </>
  );
}
