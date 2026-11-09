import type { Metadata } from "next";
import Link from "next/link";
import { and, count, desc, eq, gte, inArray } from "drizzle-orm";
import { requireStaff } from "@/lib/access";
import { getDb } from "@/lib/db";
import { clients, floorEvents, invoices, projects } from "@/lib/db/schema";
import { FLOOR_APPS, deskHealth, statsFor } from "@/lib/floor";
import { JOBS } from "@/lib/work";
import "./work.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Our work" };

const money = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
const fmtDate = (d: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
const daysLive = (d: string, now: Date) => Math.max(0, Math.floor((now.getTime() - new Date(`${d}T00:00:00Z`).getTime()) / 86_400_000));

/** Every job UnBusy has delivered: what it is, whether it's working, how much it's used, and what it's earned. */
export default async function WorkPage() {
  const { staff } = await requireStaff();
  const db = getDb();
  const now = new Date();
  const since = new Date(now.getTime() - 30 * 86_400_000);
  const appKeys = JOBS.flatMap((j) => (j.floorApp ? [j.floorApp] : []));
  const names = JOBS.flatMap((j) => (j.portalClient ? [j.portalClient] : []));

  const [events, totals, billing] = await Promise.all([
    appKeys.length ? db.select().from(floorEvents).where(and(inArray(floorEvents.app, appKeys), gte(floorEvents.at, since))).orderBy(desc(floorEvents.at)).limit(5000) : [],
    appKeys.length ? db.select({ app: floorEvents.app, n: count() }).from(floorEvents).where(and(inArray(floorEvents.app, appKeys), eq(floorEvents.kind, "job"))).groupBy(floorEvents.app) : [],
    names.length
      ? db.select({ client: clients.name, project: projects.name, status: projects.status, projectId: projects.id, launchedOn: projects.launchedOn, invStatus: invoices.status, cents: invoices.amountCents })
          .from(clients)
          .innerJoin(projects, eq(projects.clientId, clients.id))
          .leftJoin(invoices, eq(invoices.projectId, projects.id))
          .where(and(eq(clients.workspaceId, staff.workspaceId), inArray(clients.name, names)))
      : [],
  ]);
  const total = new Map(totals.map((t) => [t.app, t.n]));

  const jobs = JOBS.map((job) => {
    const app = FLOOR_APPS.find((a) => a.key === job.floorApp);
    const stats = app ? statsFor(app, events.filter((e) => e.app === app.key), now, total.get(app.key) ?? 0) : null;
    const rows = billing.filter((b) => b.client === job.portalClient);
    const paid = rows.filter((r) => r.invStatus === "paid").reduce((s, r) => s + (r.cents ?? 0), 0);
    const open = rows.filter((r) => r.invStatus === "open").reduce((s, r) => s + (r.cents ?? 0), 0);
    const project = rows[0];
    const health = !job.floorApp ? "delivered" : !stats ? "unknown" : stats.site ? (stats.site.up ? "ok" : "down") : deskHealth(stats, now).level === "down" ? "down" : stats.lastAt ? "ok" : "unknown";
    return { job: { ...job, liveSince: project?.launchedOn ?? job.liveSince }, stats, paid, open, project, health };
  });
  const collected = jobs.reduce((s, j) => s + j.paid, 0);
  const watched = jobs.filter((j) => j.job.floorApp);
  const live = watched.filter((j) => j.health === "ok").length;

  return (
    <main className="shell page wk">
      <header className="wk-head">
        <p className="wk-eyebrow">Our work</p>
        <h1>{JOBS.length} jobs delivered</h1>
        <p className="wk-sum">
          {watched.length > 0 && <span><i className="wk-dot" data-h={live === watched.length ? "ok" : "down"} />{live} of {watched.length} desks working</span>}
          <span>{money(collected)} collected</span>
          <span>Since {fmtDate(jobs.map((j) => j.job.liveSince).sort()[0])}</span>
        </p>
      </header>

      <ol className="wk-list">
        {jobs
          .sort((a, b) => b.job.liveSince.localeCompare(a.job.liveSince))
          .map(({ job, stats, paid, open, project, health }) => (
            <li key={job.key} className="wk-job">
              <div className="wk-main">
                <div className="wk-titles">
                  <span className="wk-kind">{job.kind}</span>
                  <h2>{job.client}</h2>
                  <p className="wk-title">{job.title}</p>
                </div>
                <p className="wk-what">{job.what}</p>
                <p className="wk-links">
                  {job.url && <a href={job.url} target="_blank" rel="noreferrer">{job.url.replace(/^https?:\/\//, "")}</a>}
                  {job.floorApp && <Link href="/admin/control-center">Control Center</Link>}
                  {project && <Link href={`/admin/projects/${project.projectId}`}>Project in the portal</Link>}
                </p>
              </div>

              <dl className="wk-facts">
                <div>
                  <dt>Status</dt>
                  <dd><i className="wk-dot" data-h={health} />{health === "ok" ? "Live" : health === "down" ? "Down" : health === "delivered" ? "Delivered" : "Not reporting"}</dd>
                </div>
                <div>
                  <dt>{job.kind === "Website" ? "Launched" : "Live since"}</dt>
                  <dd>{fmtDate(job.liveSince)}<small>{daysLive(job.liveSince, now)} days</small></dd>
                </div>
                {stats && job.kind === "Desk" && (
                  <>
                    <div><dt>Jobs filed</dt><dd>{stats.total.toLocaleString()}<small>{stats.week} this week</small></dd></div>
                    <div><dt>Typical time</dt><dd>{stats.medianSeconds === null ? "—" : `${Math.round(stats.medianSeconds)}s`}<small>{stats.selftest ? (stats.selftest.ok ? "self-test passing" : `${stats.selftest.failed.join(", ") || "a county"} not answering`) : ""}</small></dd></div>
                  </>
                )}
                {stats?.site && (
                  <>
                    <div><dt>Uptime</dt><dd>{stats.site.uptime}%<small>{stats.site.checks} checks</small></dd></div>
                    <div><dt>Speed</dt><dd>{stats.site.ms} ms<small>last check</small></dd></div>
                  </>
                )}
                <div>
                  <dt>Earned</dt>
                  <dd>{paid ? money(paid) : "—"}<small>{open ? `${money(open)} open` : paid ? "paid in full" : job.portalClient ? "" : "not billed in the portal"}</small></dd>
                </div>
              </dl>
            </li>
          ))}
      </ol>
    </main>
  );
}
