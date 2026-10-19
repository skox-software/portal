import Link from "next/link";
import { zoneShort } from "@/lib/local-time";
import { firstName, formatMoney } from "@/lib/format";
import { formatRate } from "@/lib/outreach-log";
import type { Overview } from "@/lib/overview-data";
import { Owner } from "./Owner";

/** The sales side at a glance: stages, who to call next, the week's work and how outreach is landing. */
export function SalesDesk({ sales, names }: { sales: Overview["sales"]; names: Map<string, string> }) {
  const nameOf = (email: string) => names.get(email) ?? firstName(email);
  const tile = (key: string) => sales.outreach.tiles.find((t) => t.key === key);
  const sent = tile("sent")?.count ?? 0;
  return (
    <section className="admin-panel admin-section-space">
      <div className="admin-panel-head">
        <div>
          <h2>Sales desk</h2>
          <p>Open deals by stage, who to call next and this week&rsquo;s work.</p>
        </div>
        <Link href="/admin/pipeline">Pipeline →</Link>
      </div>

      <ul className="pipeline-strip ov-stages" aria-label="Open deals by stage">
        {sales.stages.map((s) => (
          <li key={s.key}>
            <Link href={`/admin/clients?stage=${s.key}`}>
              <span>
                <i className="ov-dot" data-stage={s.key} aria-hidden="true" /> {s.label}
              </span>
              <strong>{s.count}</strong>
              <small>{s.cents ? formatMoney(s.cents) : "No value set"}</small>
            </Link>
          </li>
        ))}
        <li>
          <Link href="/admin/finance">
            <span>Won this month</span>
            <strong>{sales.wonThisMonth.count}</strong>
            <small>{sales.wonThisMonth.cents ? formatMoney(sales.wonThisMonth.cents) : "—"}</small>
          </Link>
        </li>
      </ul>

      <div className="ov-desk">
        <div>
          <h3 className="ov-sub">
            Next calls <small>{sales.callableNow ? `${sales.callableNow} callable now` : "Outside calling hours"} · {sales.queueSize} in the queue</small>
          </h3>
          {sales.nextCalls.length ? (
            <ul className="admin-action-list">
              {sales.nextCalls.map((c) => (
                <li key={c.id}>
                  <Link className="admin-action ov-item" data-priority={c.followUp === "overdue" ? "high" : "normal"} href={`/admin/clients?deal=${c.id}`}>
                    <span className="admin-action-icon" aria-hidden="true">
                      ☎
                    </span>
                    <div>
                      <strong>{c.company}</strong>
                      <small>
                        {[c.followUp === "overdue" ? "Follow-up overdue" : c.followUp === "today" ? "Follow-up today" : null, c.tag, c.zone ? `${zoneShort(c.zone)}${c.callable ? "" : " · closed now"}` : null]
                          .filter(Boolean)
                          .join(" · ")}
                      </small>
                    </div>
                    <Owner email={c.owner} />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="admin-empty">No leads ready to call. Import or add leads on the Pipeline.</p>
          )}
        </div>

        <div>
          <h3 className="ov-sub">
            Last 7 days <small>calls, emails, new leads, wins</small>
          </h3>
          {sales.activity.length ? (
            <div className="table-wrap">
              <table className="ov-table">
                <thead>
                  <tr>
                    <th>Who</th>
                    <th className="num">Calls</th>
                    <th className="num">Emails</th>
                    <th className="num">New</th>
                    <th className="num">Won</th>
                  </tr>
                </thead>
                <tbody>
                  {sales.activity.map((r) => (
                    <tr key={r.person}>
                      <td>{nameOf(r.person)}</td>
                      <td className="num">{r.calls}</td>
                      <td className="num">{r.emails}</td>
                      <td className="num">{r.created}</td>
                      <td className="num">{r.won}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="admin-empty">No calls, emails or new leads logged this week.</p>
          )}

          <h3 className="ov-sub">
            Outreach, 30 days {sales.outreach.blocked && <span className="chip chip-danger">Sending blocked</span>}
          </h3>
          <Link className="ov-outreach" href="/admin/outreach">
            {(["sent", "delivered", "opened", "bounced"] as const).map((key) => {
              const t = tile(key);
              return (
                <span key={key} data-key={key}>
                  <strong>{t?.count ?? 0}</strong>
                  <small>
                    {t?.label ?? key}
                    {key !== "sent" && t?.rate != null ? ` · ${formatRate(t.rate)}` : ""}
                  </small>
                </span>
              );
            })}
          </Link>
          {!sent && <p className="ov-note">No outreach emails in the last 30 days.</p>}
        </div>
      </div>
    </section>
  );
}
