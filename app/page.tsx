import { eq, inArray } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { requireViewer } from "@/lib/access";
import { getDb } from "@/lib/db";
import { clients, onboardings, projects } from "@/lib/db/schema";
import { describeDaysUntil, daysUntil, formatDate, kindLabel, STATUS_LABEL } from "@/lib/format";
import { staffMembershipIn } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export default async function Home() {
  const viewer = await requireViewer();
  if (staffMembershipIn(viewer.memberships)) redirect("/admin");

  const clientIds = viewer.memberships.flatMap((m) => (m.clientId ? [m.clientId] : []));
  const rows = clientIds.length
    ? await getDb()
        .select({ project: projects, clientName: clients.name })
        .from(projects)
        .innerJoin(clients, eq(clients.id, projects.clientId))
        .where(inArray(projects.clientId, clientIds))
    : [];
  const visible = rows;

  if (visible.length === 1) {
    const only = visible[0].project;
    // A brand-new client lands straight in their welcome flow until it's finished.
    const [welcome] = await getDb()
      .select({ status: onboardings.status })
      .from(onboardings)
      .where(eq(onboardings.projectId, only.id))
      .limit(1);
    redirect(welcome && welcome.status !== "completed" ? `/projects/${only.id}/welcome` : `/projects/${only.id}`);
  }

  return (
    <>
      <TopBar viewer={viewer} />
      <main className="shell page">
        <div className="page-head">
          <div>
            <p className="eyebrow">Signed in as {viewer.email}</p>
            <h1>Your projects</h1>
          </div>
        </div>
        {visible.length === 0 ? (
          <div className="card stack">
            <h2>No projects here yet</h2>
            <p className="muted">
              Your account isn&apos;t linked to a project. If SKOX invited you, sign in with the
              exact address the invitation went to, or ask us to add{" "}
              <strong>{viewer.email}</strong>.
            </p>
            <p>
              <a href="mailto:founders@skoxsoftware.com">founders@skoxsoftware.com</a>
            </p>
          </div>
        ) : (
          <div className="card table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Status</th>
                  <th>Delivery date</th>
                </tr>
              </thead>
              <tbody>
                {visible.map(({ project, clientName }) => (
                  <tr key={project.id}>
                    <td>
                      <Link href={`/projects/${project.id}`}>{project.name}</Link>
                      <div className="muted small">
                        {clientName} · {kindLabel(project.kind)}
                      </div>
                    </td>
                    <td>
                      <span className="chip">{STATUS_LABEL[project.status]}</span>
                    </td>
                    <td className="num">
                      {formatDate(project.deliveryDate)}
                      <div className="muted small">
                        {describeDaysUntil(daysUntil(project.deliveryDate))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </>
  );
}
