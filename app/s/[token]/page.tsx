import { createHash } from "node:crypto";
import { and, asc, desc, eq, gt, isNull } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProgressRing } from "@/components/ProgressRing";
import { SkoxLogo } from "@/components/SkoxLogo";
import { getDb } from "@/lib/db";
import { clients, milestones, projects, shareLinks, updates } from "@/lib/db/schema";
import { describeDaysUntil, daysUntil, formatDate, formatDateTime, STATUS_LABEL } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Project status", robots: { index: false, follow: false } };

/** Read-only status for people without a login: date, progress, latest update. Nothing private. */
export default async function SharedStatus({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) notFound();
  const db = getDb();
  const [row] = await db
    .select({ project: projects, client: clients })
    .from(shareLinks)
    .innerJoin(projects, eq(projects.id, shareLinks.projectId))
    .innerJoin(clients, eq(clients.id, projects.clientId))
    .where(
      and(
        eq(shareLinks.tokenHash, createHash("sha256").update(token).digest("hex")),
        isNull(shareLinks.revokedAt),
        gt(shareLinks.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!row) notFound();
  const { project, client } = row;
  const [steps, [latest]] = await Promise.all([
    db.select().from(milestones).where(eq(milestones.projectId, project.id)).orderBy(asc(milestones.position), asc(milestones.dueOn)),
    db.select().from(updates).where(eq(updates.projectId, project.id)).orderBy(desc(updates.createdAt)).limit(1),
  ]);
  const done = steps.filter((s) => s.state === "done").length;
  const launched = project.status === "launched";

  return (
    <main className="shell page share-page">
      <header className="share-head">
        <SkoxLogo className="brand-logo" />
        <span className="chip">Read-only status</span>
      </header>
      <p className="eyebrow">{client.name}</p>
      <h1 className="share-title">{project.name}</h1>
      <section className="date-panel" aria-label="Delivery">
        <div className="date-main">
          <p className="label">{launched ? "Launched" : "Delivery date"}</p>
          <p className="date-big">{formatDate(launched ? (project.launchedOn ?? project.deliveryDate) : project.deliveryDate)}</p>
          <p className="date-countdown">{launched ? STATUS_LABEL.launched : describeDaysUntil(daysUntil(project.deliveryDate))}</p>
        </div>
        <div className="date-progress">
          <ProgressRing percent={launched ? 100 : steps.length ? (done / steps.length) * 100 : 0} label="Plan complete" />
        </div>
      </section>
      <div className="split">
        <section className="card">
          <div className="card-head">
            <h2>Latest update</h2>
            {latest && <span className="muted small">{formatDateTime(latest.createdAt)}</span>}
          </div>
          {latest ? (
            <div className="update-grid">
              <div className="stack">
                <h3>Shipped</h3>
                <p>{latest.shipped || "—"}</p>
              </div>
              <div className="stack">
                <h3>Next</h3>
                <p>{latest.next || "—"}</p>
              </div>
            </div>
          ) : (
            <p className="muted">No updates yet.</p>
          )}
        </section>
        <section className="card">
          <div className="card-head">
            <h2>The plan</h2>
          </div>
          <ol className="timeline">
            {steps.map((m) => (
              <li key={m.id} data-state={m.state}>
                <span className="dot" aria-hidden="true" />
                <span>{m.title}</span>
                <span className="when">{formatDate(m.dueOn)}</span>
              </li>
            ))}
          </ol>
        </section>
      </div>
      <p className="small muted share-foot">
        Built by SKOX Software. <a href="https://skoxsoftware.com">skoxsoftware.com</a>
      </p>
    </main>
  );
}
