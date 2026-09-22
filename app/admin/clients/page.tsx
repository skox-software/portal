import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { Notice, readMessage } from "@/components/Notice";
import { TopBar } from "@/components/TopBar";
import { requireStaff } from "@/lib/access";
import { formatDealValue, initialsFor, STAGE_LABEL } from "@/lib/crm";
import { loadDeals } from "@/lib/crm-data";
import { getDb } from "@/lib/db";
import { clients } from "@/lib/db/schema";
import { formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Clients" };

const FILTERS = [
  { key: "active", label: "Active" },
  { key: "all", label: "All" },
  { key: "shipped", label: "Shipped" },
  { key: "lost", label: "Lost" },
] as const;

export default async function ClientsTable({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const show = FILTERS.find((f) => f.key === sp.show)?.key ?? "active";
  const { viewer, staff } = await requireStaff();
  const [dealRows, clientRows] = await Promise.all([
    loadDeals(staff.workspaceId),
    getDb().select().from(clients).where(eq(clients.workspaceId, staff.workspaceId)).orderBy(clients.name),
  ]);

  // One row per deal, plus clients with no deal yet (e.g. made before the CRM).
  const withDeals = new Set(dealRows.map((d) => d.client.id));
  const rows = [
    ...dealRows,
    ...clientRows.filter((c) => !withDeals.has(c.id)).map((c) => ({ client: c, dealless: true as const })),
  ].filter((r) => {
    if ("dealless" in r) return show === "all";
    if (show === "active") return r.stage !== "shipped" && r.stage !== "lost";
    if (show === "all") return true;
    return r.stage === show;
  });
  rows.sort((a, b) => a.client.name.localeCompare(b.client.name));

  return (
    <>
      <TopBar viewer={viewer} current="clients" />
      <main className="shell page" style={{ width: "min(1320px, calc(100% - 48px))" }}>
        <div className="page-head">
          <div>
            <p className="eyebrow">Sales</p>
            <h1>Clients</h1>
          </div>
          <nav className="crm-filters" aria-label="Filter clients">
            {FILTERS.map((f) => (
              <Link key={f.key} href={`/admin/clients?show=${f.key}`} aria-current={show === f.key ? "page" : undefined}>
                {f.label}
              </Link>
            ))}
          </nav>
        </div>
        <Notice error={readMessage(sp.error)} notice={readMessage(sp.notice)} />

        {rows.length === 0 ? (
          <p className="empty">
            Nothing here. <Link href="/admin/pipeline#new-deal">Add a deal</Link> to start.
          </p>
        ) : (
          <div className="card table-wrap" style={{ padding: "6px 8px" }}>
            <table>
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Contact</th>
                  <th>Deal</th>
                  <th>Stage</th>
                  <th>Value</th>
                  <th>In stage</th>
                  <th>Source</th>
                  <th>Owner</th>
                  <th>Last touch</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) =>
                  "dealless" in r ? (
                    <tr key={r.client.id}>
                      <td>
                        <Link href={`/admin/clients/${r.client.id}`}>{r.client.name}</Link>
                      </td>
                      <td colSpan={8} className="muted small">
                        No deal yet
                      </td>
                    </tr>
                  ) : (
                    <tr key={r.id}>
                      <td>
                        <Link href={`/admin/clients/${r.client.id}?deal=${r.id}`}>{r.client.name}</Link>
                        {(r.client.industry || r.client.location) && (
                          <div className="muted small">{[r.client.industry, r.client.location].filter(Boolean).join(" · ")}</div>
                        )}
                      </td>
                      <td>
                        {r.contact?.name ?? <span className="muted">—</span>}
                        {r.contact?.email && <div className="muted small">{r.contact.email}</div>}
                      </td>
                      <td className="small">{r.title}</td>
                      <td>
                        <span className="stage-pill" data-stage={r.stage}>
                          <span className="stage-dot" aria-hidden="true" />
                          {STAGE_LABEL[r.stage]}
                        </span>
                        {r.lostReason && <div className="muted small">{r.lostReason}</div>}
                      </td>
                      <td className="num money">{formatDealValue(r.valueCents)}</td>
                      <td className="num money">
                        {r.stalled ? <span className="stalled">{r.days}d</span> : `${r.days}d`}
                      </td>
                      <td className="small">{r.client.source ?? "—"}</td>
                      <td>
                        <span className="owner" title={r.ownerEmail ?? "No owner"}>
                          {initialsFor(r.ownerEmail)}
                        </span>
                      </td>
                      <td className="small">{r.lastTouch ? formatDateTime(r.lastTouch) : "—"}</td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </>
  );
}
