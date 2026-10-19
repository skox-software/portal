import type { Metadata } from "next";
import Link from "next/link";
import { Notice, readMessage } from "@/components/Notice";
import { PulseStrip } from "@/components/overview/PulseStrip";
import { Queue } from "@/components/overview/Queue";
import { FeedCard, MoneyCard, PaymentsCard, RaceCard, SetupCard } from "@/components/overview/Rail";
import { SalesDesk } from "@/components/overview/SalesDesk";
import { requireStaff } from "@/lib/access";
import { salesToday } from "@/lib/follow-up";
import { describeDaysUntil, daysUntil, firstName, formatDate, greeting, STATUS_LABEL, timeAgo } from "@/lib/format";
import { loadOverview } from "@/lib/overview-data";
import { parseWho } from "@/lib/overview-math";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Overview · SKOX" };

/**
 * The team's home: what needs the signed-in person today, then the sales
 * desk, delivery and money around it. Every number links to the page that
 * owns it; lib/overview-data.ts reads it all in one pass.
 */
export default async function Overview({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const { viewer, staff } = await requireStaff();
  const now = new Date();
  const today = salesToday();
  const who = parseWho(sp.who);
  const o = await loadOverview({ ws: staff.workspaceId, me: viewer.email, role: staff.role, today, now });

  const names = new Map(o.money.race.flatMap((r) => (r.email && !r.name.includes("@") ? [[r.email, r.name] as const] : [])));
  const myName = viewer.name ? firstName(viewer.name) : (names.get(viewer.email) ?? firstName(viewer.email));
  const dateLine = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "America/New_York" }).format(now);

  return (
    <main className="shell page ov">
      <div className="page-head">
        <div>
          <p className="eyebrow">{dateLine}</p>
          <h1>
            {greeting(now)}, {myName}
          </h1>
          <p className="muted">What needs you, what&rsquo;s selling, what&rsquo;s shipping and where the money stands.</p>
        </div>
        <div className="ov-actions">
          <Link className="btn btn-primary btn-small" href="/admin/clients?new=1">
            + New lead
          </Link>
          <Link className="btn btn-ghost btn-small" href="/admin/onboard">
            Onboard a client
          </Link>
          <Link className="btn btn-ghost btn-small" href="/admin/billing#create-invoice">
            Create invoice
          </Link>
        </div>
      </div>
      <Notice error={readMessage(sp.error)} notice={readMessage(sp.notice)} />

      <PulseStrip pulse={o.pulse} />

      <div className="admin-dashboard-grid">
        <div>
          <Queue items={o.queue} who={who} me={viewer.email} />
          <SalesDesk sales={o.sales} names={names} />

          <section className="admin-panel admin-section-space">
            <div className="admin-panel-head">
              <div>
                <h2>Projects in motion</h2>
                <p>Delivery dates, progress, when the client last looked, and the next thing to do.</p>
              </div>
              <Link href="/admin/projects">All projects →</Link>
            </div>
            {o.delivery.projects.length ? (
              <div className="table-wrap">
                <table className="admin-projects-table">
                  <thead>
                    <tr>
                      <th>Project / client</th>
                      <th>Stage</th>
                      <th>Delivery</th>
                      <th>Client seen</th>
                      <th>Next action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {o.delivery.projects.slice(0, 8).map(({ project: p, clientName, progress, clientLastSeen, next }) => (
                      <tr key={p.id}>
                        <td>
                          <Link href={`/admin/projects/${p.id}`}>{p.name}</Link>
                          <small>{clientName}</small>
                          {progress && progress.total > 0 && (
                            <span className="pipeline-progress ov-progress" title={`${progress.done} of ${progress.total} milestones done`}>
                              <span style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }} />
                            </span>
                          )}
                        </td>
                        <td>
                          <span className="chip">{STATUS_LABEL[p.status]}</span>
                        </td>
                        <td>
                          {p.dateTentative ? "Set at kickoff" : formatDate(p.deliveryDate)}
                          {!p.dateTentative && <small>{describeDaysUntil(daysUntil(p.deliveryDate))}</small>}
                        </td>
                        <td>{clientLastSeen ? timeAgo(clientLastSeen, now) : <span className="muted">Never</span>}</td>
                        <td>
                          <Link href={next.href}>{next.label} ↗</Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="admin-empty">No active projects. Win a deal and onboard it to get started.</p>
            )}
          </section>
        </div>

        <aside className="admin-side-stack">
          <MoneyCard money={o.money} />
          <RaceCard race={o.money.race} />
          <PaymentsCard payments={o.delivery.payments} today={today} />
          <SetupCard setups={o.delivery.setups} />
          <FeedCard feed={o.feed} now={now} />
        </aside>
      </div>
    </main>
  );
}
