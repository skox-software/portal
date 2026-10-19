import Link from "next/link";
import { Sparkline } from "@/components/ProgressRing";
import { unixToSalesDate } from "@/lib/finance-periods";
import { firstName, formatDate, formatMoney, timeAgo } from "@/lib/format";
import type { LiveIcon } from "@/lib/live-feed";
import type { Overview } from "@/lib/overview-data";

const FEED_ICON: Record<LiveIcon, string> = {
  paid: "$",
  invoice: "▤",
  won: "★",
  stage: "⇉",
  lost: "×",
  call: "☎",
  deal: "+",
  commission: "%",
  statement: "✓",
  signed: "✎",
  onboarded: "◈",
  meeting: "◷",
  alert: "!",
};

export function MoneyCard({ money }: { money: Overview["money"] }) {
  const values = money.monthly.map((m) => m.cents);
  const best = Math.max(0, ...values);
  return (
    <section className="admin-panel">
      <div className="admin-panel-head">
        <div>
          <h2>Money</h2>
          <p>Cash collected, last 12 months.</p>
        </div>
        <Link href="/admin/finance">Finance →</Link>
      </div>
      <div className="ov-money">
        <Sparkline values={values} width={280} height={56} />
        <dl>
          <div>
            <dt>Best month</dt>
            <dd>{formatMoney(best)}</dd>
          </div>
          <div>
            <dt>Next payout</dt>
            <dd>{!money.payoutsOk ? "—" : money.nextPayout ? `${formatMoney(money.nextPayout.amount)} · ${formatDate(unixToSalesDate(money.nextPayout.arrivalDate))}` : "None scheduled"}</dd>
          </div>
          <div>
            <dt>Commission unpaid</dt>
            <dd>
              <Link href="/admin/commissions">{formatMoney(money.commissionOwedCents)}</Link>
            </dd>
          </div>
        </dl>
      </div>
    </section>
  );
}

export function RaceCard({ race }: { race: Overview["money"]["race"] }) {
  const rows = race.filter((r) => r.collectedCents || r.dealsWon);
  return (
    <section className="admin-panel">
      <div className="admin-panel-head">
        <div>
          <h2>This month&rsquo;s race</h2>
          <p>Cash collected and deals won, month to date.</p>
        </div>
        <Link href="/admin/finance#race">More →</Link>
      </div>
      {rows.length ? (
        <div className="table-wrap">
          <table className="ov-table">
            <thead>
              <tr>
                <th>Who</th>
                <th className="num">Collected</th>
                <th className="num">Won</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.email ?? `none-${i}`}>
                  <td>
                    {i === 0 && rows.length > 1 ? "★ " : ""}
                    {r.email ? (r.name.includes("@") ? firstName(r.name) : r.name) : "Unassigned"}
                  </td>
                  <td className="num">{formatMoney(r.collectedCents)}</td>
                  <td className="num">{r.dealsWon}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="admin-empty">No cash collected or deals won yet this month.</p>
      )}
    </section>
  );
}

export function PaymentsCard({ payments, today }: { payments: Overview["delivery"]["payments"]; today: string }) {
  return (
    <section className="admin-panel">
      <div className="admin-panel-head">
        <div>
          <h2>Payments to follow up</h2>
          <p>Oldest due dates first.</p>
        </div>
        <Link href="/admin/billing">Billing →</Link>
      </div>
      {payments.length ? (
        <ul className="admin-action-list">
          {payments.map(({ invoice, project, clientName }) => (
            <li key={invoice.id}>
              <Link className="admin-action" href={`/projects/${project.id}/billing/invoices/${invoice.id}`}>
                <div>
                  <strong>{clientName}</strong>
                  <small>
                    {invoice.number} · {invoice.dueOn < today ? "Overdue" : "Due"} {formatDate(invoice.dueOn)}
                  </small>
                </div>
                <strong>{formatMoney(invoice.amountCents, invoice.currency)}</strong>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="admin-empty">No outstanding invoices.</p>
      )}
    </section>
  );
}

export function SetupCard({ setups }: { setups: Overview["delivery"]["setups"] }) {
  return (
    <section className="admin-panel">
      <div className="admin-panel-head">
        <h2>Client setup</h2>
        <Link href="/admin/onboard">Manage →</Link>
      </div>
      {setups.length ? (
        <ul className="admin-action-list">
          {setups.map(({ onboarding: o, client }) => (
            <li key={o.id}>
              <Link className="admin-action" href={`/admin/onboard/${o.projectId}`}>
                <div>
                  <strong>{client.name}</strong>
                  <small>{!o.welcomeSentAt ? "Welcome ready to send" : o.status === "invited" ? "Welcome sent, not opened" : "Setup in progress"}</small>
                </div>
                <span aria-hidden="true">↗</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="admin-empty">No client setups in progress.</p>
      )}
    </section>
  );
}

export function FeedCard({ feed, now }: { feed: Overview["feed"]; now: Date }) {
  return (
    <section className="admin-panel">
      <div className="admin-panel-head">
        <div>
          <h2>Latest</h2>
          <p>Payments, deals, calls and signatures.</p>
        </div>
        <Link href="/admin/activity">Activity →</Link>
      </div>
      {feed.length ? (
        <ul className="ov-feed">
          {feed.map((e) => (
            <li key={e.id} data-icon={e.icon}>
              <span aria-hidden="true">{FEED_ICON[e.icon] ?? "·"}</span>
              <p>
                {e.text}
                {e.amountCents ? <strong> {formatMoney(e.amountCents)}</strong> : null}
                <small>{timeAgo(new Date(e.at), now)}</small>
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="admin-empty">Nothing has happened yet.</p>
      )}
    </section>
  );
}
