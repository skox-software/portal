import type { Metadata } from "next";
import Link from "next/link";
import { requireStaff } from "@/lib/access";
import { formatDateTime, nowMs } from "@/lib/format";
import { filterRows, formatRate, inPeriod, PERIODS, ROW_STATUS_LABEL, summarize, type Period, type RowStatus } from "@/lib/outreach-log";
import { loadOutreachLog } from "@/lib/outreach-log-data";
import { withBase } from "@/lib/paths";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Email log · SKOX" };

const STATUS_ORDER: RowStatus[] = ["sent", "delayed", "delivered", "opened", "clicked", "bounced", "complained", "untracked"];

export default async function OutreachPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const { staff } = await requireStaff();
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).trim().slice(0, 200) : "");
  const period: Period = PERIODS.some((p) => p.key === str("period")) ? (str("period") as Period) : "30d";
  const status = STATUS_ORDER.includes(str("status") as RowStatus) ? str("status") : "";
  const sender = str("sender");
  const q = str("q");

  const all = await loadOutreachLog(staff.workspaceId);
  const now = new Date(nowMs());
  const periodRows = inPeriod(all, period, now);
  const { tiles, tracked, untracked } = summarize(periodRows);
  const rows = filterRows(periodRows, { status, sender, q });
  const senders = [...new Set(all.map((r) => r.sender))].sort();

  const query = (extra: Record<string, string>) => {
    const p = new URLSearchParams();
    const merged = { period: period === "30d" ? "" : period, status, sender, q, ...extra };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const s = p.toString();
    return `/admin/outreach${s ? `?${s}` : ""}`;
  };
  const when = (iso: string) => `${formatDateTime(new Date(iso))} ET`;

  return (
    <main className="shell page outreach-page">
      <div className="crm-head">
        <div>
          <p className="eyebrow">Sales</p>
          <h1>Email log</h1>
        </div>
        <nav className="crm-views" aria-label="Period">
          {PERIODS.map((p) => (
            <Link key={p.key} href={query({ period: p.key === "30d" ? "" : p.key })} aria-current={period === p.key ? "page" : undefined}>
              {p.label}
            </Link>
          ))}
        </nav>
      </div>

      <section className="outreach-summary" aria-label="Summary">
        {tiles.map((t) => (
          <div key={t.key} className="admin-metric" data-key={t.key}>
            <span>{t.label}</span>
            <strong>{t.count}</strong>
            <small>{t.rate === null ? (t.key === "sent" ? `${tracked} tracked` : "—") : `${formatRate(t.rate)} of tracked`}</small>
          </div>
        ))}
      </section>
      {untracked > 0 && (
        <p className="outreach-note">
          {untracked} {untracked === 1 ? "email was" : "emails were"} sent before delivery tracking started, so {untracked === 1 ? "it is" : "they are"} left out of the rates. Resend&apos;s dashboard has {untracked === 1 ? "its status" : "their statuses"}.
        </p>
      )}

      <form className="admin-filter" action={withBase("/admin/outreach")}>
        {period !== "30d" && <input type="hidden" name="period" value={period} />}
        <label className="sr-only" htmlFor="outreach-search">
          Search
        </label>
        <input id="outreach-search" name="q" type="search" defaultValue={q} placeholder="Search lead, recipient or subject" />
        <label className="sr-only" htmlFor="outreach-status">
          Status
        </label>
        <select id="outreach-status" name="status" defaultValue={status}>
          <option value="">Any status</option>
          {STATUS_ORDER.map((s) => (
            <option key={s} value={s}>
              {ROW_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="outreach-sender">
          Sent by
        </label>
        <select id="outreach-sender" name="sender" defaultValue={sender}>
          <option value="">Anyone</option>
          {senders.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <button className="btn btn-ghost">Filter</button>
        {(q || status || sender) && (
          <Link className="btn btn-ghost" href={query({ q: "", status: "", sender: "" })}>
            Clear
          </Link>
        )}
      </form>

      <p className="outreach-count">
        {rows.length === periodRows.length ? `${rows.length} email${rows.length === 1 ? "" : "s"}` : `${rows.length} of ${periodRows.length} emails`}
      </p>

      {rows.length === 0 ? (
        <div className="card outreach-empty">{periodRows.length ? "No emails match. Try another filter." : all.length ? "No emails sent in this period." : "No outreach emails yet. Send one from a lead's panel on Clients."}</div>
      ) : (
        <div className="outreach-table-wrap">
          <table className="outreach-table">
            <thead>
              <tr>
                <th scope="col">Sent</th>
                <th scope="col">Lead</th>
                <th scope="col">Recipient</th>
                <th scope="col">Subject</th>
                <th scope="col">By</th>
                <th scope="col">Status</th>
                <th scope="col">Last activity</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td data-label="Sent">
                    <time dateTime={r.sentAt}>{when(r.sentAt)}</time>
                  </td>
                  <td data-label="Lead" className="outreach-lead">
                    {r.dealId && r.lead ? <Link href={`/admin/clients?deal=${r.dealId}`}>{r.lead}</Link> : <span className="outreach-dim">{r.lead ?? "No lead"}</span>}
                    {r.kind === "reply" && <span className="outreach-kind">Inbox reply</span>}
                  </td>
                  <td data-label="Recipient" className="outreach-to">
                    {r.to ?? "—"}
                  </td>
                  <td data-label="Subject" className="outreach-subject">
                    {r.subject ?? "—"}
                  </td>
                  <td data-label="By">{r.sender}</td>
                  <td data-label="Status">
                    <span className="email-status" data-status={r.status} title={r.reason ?? r.note ?? undefined}>
                      {ROW_STATUS_LABEL[r.status]}
                    </span>
                    {r.status === "untracked" && r.note && <small className="outreach-why">{r.note}</small>}
                    {r.reason && <small className="outreach-why">{r.reason}</small>}
                  </td>
                  <td data-label="Last activity">
                    <time dateTime={r.lastActivity}>{when(r.lastActivity)}</time>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
