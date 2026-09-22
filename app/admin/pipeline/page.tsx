import type { Metadata } from "next";
import Link from "next/link";
import { Notice, readMessage } from "@/components/Notice";
import { PipelineBoard, type BoardCard } from "@/components/PipelineBoard";
import { TopBar } from "@/components/TopBar";
import { requireStaff } from "@/lib/access";
import { ALL_STAGES, formatDealValue, initialsFor, STAGE_LABEL } from "@/lib/crm";
import { clientOptions, loadDeals, unassignedThreadCount } from "@/lib/crm-data";
import { formatDate } from "@/lib/format";
import { createDeal } from "../crm-actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Pipeline" };

export default async function Pipeline({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const { viewer, staff } = await requireStaff();
  const [all, unassigned, clientList] = await Promise.all([
    loadDeals(staff.workspaceId),
    unassignedThreadCount(staff.workspaceId),
    clientOptions(staff.workspaceId),
  ]);
  const open = all.filter((d) => d.stage !== "lost");

  const sum = (stages: string[]) => open.filter((d) => stages.includes(d.stage)).reduce((s, d) => s + d.valueCents, 0);
  const stalled = open.filter((d) => d.stalled).length;

  const cards: BoardCard[] = open.map((d) => ({
    id: d.id,
    stage: d.stage,
    clientId: d.client.id,
    clientName: d.client.name,
    contactName: d.contact?.name ?? null,
    valueCents: d.valueCents,
    kind: d.kind,
    days: d.days,
    stalled: d.stalled,
    ownerInitials: initialsFor(d.ownerEmail),
    ownerEmail: d.ownerEmail,
    progress: d.project ? d.milestones : null,
    footLabel:
      d.stage === "in_build" && d.project
        ? `Due ${formatDate(d.project.deliveryDate)}`
        : d.stage === "shipped" && d.shippedAt
          ? `Shipped ${formatDate(d.shippedAt.toISOString().slice(0, 10))}${d.invoice ? ` · ${d.invoice === "paid" ? "Paid" : "Invoice open"}` : ""}`
          : null,
  }));

  return (
    <>
      <TopBar viewer={viewer} current="pipeline" />
      <main className="shell page" style={{ width: "min(1320px, calc(100% - 48px))" }}>
        <div className="page-head">
          <div>
            <p className="eyebrow">Sales</p>
            <h1>Pipeline</h1>
          </div>
          <a className="btn btn-primary" href="#new-deal">
            New deal
          </a>
        </div>
        <Notice error={readMessage(sp.error)} notice={readMessage(sp.notice)} />

        <section className="kpi-row" aria-label="At a glance">
          <div className="kpi">
            <p className="label">Open pipeline</p>
            <p className="kpi-value">{formatDealValue(sum(["lead", "proposal_sent", "negotiation"]))}</p>
          </div>
          <div className="kpi">
            <p className="label">Won / in build</p>
            <p className="kpi-value">{formatDealValue(sum(["won", "in_build"]))}</p>
          </div>
          <div className="kpi">
            <p className="label">Stalled 10+ days</p>
            <p className="kpi-value">{stalled}</p>
          </div>
          <div className="kpi">
            <p className="label">Email needing a client</p>
            <p className="kpi-value">
              <Link href="/admin/inbox">{unassigned}</Link>
            </p>
          </div>
        </section>

        {open.length === 0 ? (
          <p className="empty">No deals yet. Add the first one below, or file an email from the inbox as a new lead.</p>
        ) : (
          <>
            <p className="small muted" style={{ marginBottom: 12 }}>
              Drag a card to another column, or use its stage menu. Lost deals are on the <Link href="/admin/clients?show=lost">clients list</Link>.
            </p>
            <PipelineBoard initial={cards} />
          </>
        )}

        <section className="card" id="new-deal" aria-labelledby="new-deal-title" style={{ marginTop: 24, maxWidth: 760 }}>
          <div className="card-head">
            <h2 id="new-deal-title">New deal</h2>
          </div>
          <form action={createDeal} className="stack">
            <input type="hidden" name="back" value="/admin/pipeline" />
            <div className="form-grid">
              <div className="field">
                <label htmlFor="nd-client">Client</label>
                <select id="nd-client" name="clientId" defaultValue="">
                  <option value="">New client…</option>
                  {clientList.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="nd-company">New client name</label>
                <input id="nd-company" name="companyName" maxLength={120} placeholder="Only for a new client" />
              </div>
              <div className="field">
                <label htmlFor="nd-contact">Contact name</label>
                <input id="nd-contact" name="contactName" maxLength={120} placeholder="Only for a new client" />
              </div>
              <div className="field">
                <label htmlFor="nd-email">Contact email</label>
                <input id="nd-email" name="contactEmail" type="email" maxLength={254} />
              </div>
            </div>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="nd-title">Deal</label>
                <input id="nd-title" name="title" required maxLength={140} placeholder="e.g. Patient booking portal" />
              </div>
              <div className="field">
                <label htmlFor="nd-kind">Type</label>
                <input id="nd-kind" name="kind" maxLength={60} placeholder="Portal, dashboard…" />
              </div>
              <div className="field">
                <label htmlFor="nd-value">Value ($)</label>
                <input id="nd-value" name="value" inputMode="decimal" maxLength={20} placeholder="12,500" />
              </div>
              <div className="field">
                <label htmlFor="nd-stage">Stage</label>
                <select id="nd-stage" name="stage" defaultValue="lead">
                  {ALL_STAGES.filter((s) => s !== "lost").map((s) => (
                    <option key={s} value={s}>
                      {STAGE_LABEL[s]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="nd-source">Source</label>
                <input id="nd-source" name="source" maxLength={120} placeholder="Referral, scoping form…" />
              </div>
            </div>
            <div>
              <button className="btn btn-primary" type="submit">
                Add deal
              </button>
            </div>
          </form>
        </section>
      </main>
    </>
  );
}
