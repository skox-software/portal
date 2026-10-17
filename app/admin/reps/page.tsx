import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { Notice, readMessage } from "@/components/Notice";
import { SubmitButton } from "@/components/SubmitButton";
import { requireStaff } from "@/lib/access";
import { EMPTY_TOTALS, repTotals, workspaceReps } from "@/lib/commissions";
import { formatRate } from "@/lib/commission-math";
import { getDb } from "@/lib/db";
import { deals, memberships, repProfiles } from "@/lib/db/schema";
import { formatMoney, timeAgo, todayIso } from "@/lib/format";
import { canApproveCommissions, isStaffRole, STAFF_ROLES } from "@/lib/permissions";
import { addFounderShare, inviteRep, updateRep } from "./actions";
import "./reps-admin.css";

export const metadata: Metadata = { title: "Team" };

export default async function AdminReps({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const { staff } = await requireStaff();
  const owner = canApproveCommissions(staff.role);
  const ws = staff.workspaceId;
  const [reps, totals, leadCounts, teamWithoutShare] = await Promise.all([
    workspaceReps(ws),
    repTotals(ws),
    getDb()
      .select({
        rep: deals.repMembershipId,
        total: sql<number>`count(*)::int`,
        open: sql<number>`count(*) filter (where ${deals.stage} not in ('won','lost') and ${deals.projectId} is null)::int`,
        booked: sql<number>`count(*) filter (where ${deals.meetingAt} is not null)::int`,
        won: sql<number>`count(*) filter (where ${deals.stage} = 'won' or ${deals.projectId} is not null)::int`,
        self: sql<number>`count(*) filter (where ${deals.repSource} = 'self')::int`,
      })
      .from(deals)
      .where(and(eq(deals.workspaceId, ws), isNotNull(deals.repMembershipId)))
      .groupBy(deals.repMembershipId),
    // Staff who could be given a founder earnings profile: no commission profile yet.
    getDb()
      .select({ id: memberships.id, email: memberships.email })
      .from(memberships)
      .leftJoin(repProfiles, eq(repProfiles.membershipId, memberships.id))
      .where(and(eq(memberships.workspaceId, ws), isNull(memberships.clientId), inArray(memberships.role, [...STAFF_ROLES]), isNull(repProfiles.id)))
      .orderBy(memberships.email),
  ]);
  const countsBy = new Map(leadCounts.map((c) => [c.rep, c]));

  return (
    <main className="shell page">
      <div className="page-head">
        <div>
          <p className="eyebrow">SKOX</p>
          <h1>Team</h1>
          <p className="muted">Founders earn 100% on their own deals. Sales reps earn 20% on deals they close, with 40% going to each founder. Business expenses do not reduce these shares.</p>
        </div>
        <Link className="btn btn-ghost" href="/admin/commissions">Commissions →</Link>
      </div>
      <Notice error={readMessage(sp.error)} notice={readMessage(sp.notice)} />

      <section className="admin-panel" aria-labelledby="reps-title" style={{ marginBottom: 22 }}>
        <div className="admin-panel-head"><h2 id="reps-title">Team</h2><span className="muted small">{reps.length}</span></div>
        {reps.length === 0 ? (
          <p className="rep-empty">No team members yet. Add a founder or invite a sales rep below.</p>
        ) : (
          <div className="table-wrap">
            <table className="rep-table">
              <thead>
                <tr><th>Name</th><th className="num">Rate</th><th className="num">Open leads</th><th className="num">Booked</th><th className="num">Won</th><th className="num">Owed</th><th className="num">Paid this year</th><th>Last seen</th></tr>
              </thead>
              <tbody>
                {reps.map(({ membership: m, profile: p }) => {
                  const t = totals.get(m.id) ?? EMPTY_TOTALS;
                  const c = countsBy.get(m.id);
                  return (
                    <tr key={m.id}>
                      <td data-label=""><strong>{p.displayName}</strong><span className="rep-pill" data-status="booked" style={{ marginLeft: 8 }}>{isStaffRole(m.role) ? "Founder" : "Sales rep"}</span>{p.status === "paused" && <span className="rep-pill" data-status="lost" style={{ marginLeft: 8 }}>Paused</span>}<br /><span className="small muted">{m.email}</span></td>
                      <td className="num" data-label="Rate">{formatRate(p.rateBps)}</td>
                      <td className="num" data-label="Open">{c?.open ?? 0}</td>
                      <td className="num" data-label="Booked">{c?.booked ?? 0}</td>
                      <td className="num" data-label="Won">{c?.won ?? 0}</td>
                      <td className="num rep-money" data-label="Owed">{formatMoney(t.pending + t.approved)}</td>
                      <td className="num rep-money" data-label="Paid">{formatMoney(t.paidThisYear)}</td>
                      <td data-label="Seen">{m.lastSeenAt ? timeAgo(m.lastSeenAt) : m.userId ? "Signed in" : "Not yet"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {owner ? (
        <div className="rep-grid">
          <div className="stack">
            {reps.map(({ membership: m, profile: p }) => (
              <details key={m.id} className="card">
                <summary style={{ cursor: "pointer", fontWeight: 600 }}>Edit {p.displayName}</summary>
                <form action={updateRep} className="stack" style={{ marginTop: 14 }}>
                  <input type="hidden" name="membershipId" value={m.id} />
                  <div className="form-grid">
                    <div className="field"><label htmlFor={`n-${m.id}`}>Name</label><input id={`n-${m.id}`} name="displayName" defaultValue={p.displayName} required maxLength={80} /></div>
                    <div className="field"><label htmlFor={`r-${m.id}`}>Rate (%)</label><input id={`r-${m.id}`} name="rate" inputMode="decimal" value={isStaffRole(m.role) ? 100 : 20} readOnly required /></div>
                    <div className="field"><label htmlFor={`s-${m.id}`}>Status</label><select id={`s-${m.id}`} name="status" defaultValue={p.status}><option value="active">Active</option><option value="paused">Paused (earns nothing new)</option></select></div>
                    <div className="field"><label htmlFor={`d-${m.id}`}>Started</label><input id={`d-${m.id}`} name="startedOn" type="date" defaultValue={p.startedOn ?? ""} /></div>
                  </div>
                  <div className="field"><label htmlFor={`p-${m.id}`}>How you pay them</label><input id={`p-${m.id}`} name="payoutNotes" defaultValue={p.payoutNotes ?? ""} maxLength={300} placeholder="Zelle to their phone, ACH via Gusto…" /><span className="hint">Shown to the team member. Never put bank or account numbers here.</span></div>
                  <label className="check"><input type="checkbox" name="agreement" defaultChecked={!!p.agreementSignedAt} /><span>Contractor agreement signed</span></label>
                  <label className="check"><input type="checkbox" name="w9" defaultChecked={!!p.w9ReceivedAt} /><span>W-9 received</span></label>
                  <p className="small muted">Own deals: 100% to the founder. Rep deals: 20% to the rep and 40% to each founder. Expenses do not reduce these shares.</p>
                  <div><SubmitButton className="btn btn-primary btn-small" pendingLabel="Saving…">Save</SubmitButton></div>
                </form>
              </details>
            ))}
          </div>
          <aside className="stack">
            <form action={inviteRep} className="card stack">
              <div className="card-head"><h2>Invite a sales rep</h2></div>
              <div className="field"><label htmlFor="rep-new-name">Name</label><input id="rep-new-name" name="displayName" required maxLength={80} /></div>
              <div className="field"><label htmlFor="rep-new-email">Email</label><input id="rep-new-email" name="email" type="email" required /><span className="hint">Use an email that isn&apos;t already in the portal.</span></div>
              <div className="form-grid">
                <div className="field"><label htmlFor="rep-new-rate">Rate (%)</label><input id="rep-new-rate" name="rate" inputMode="decimal" value="20" readOnly required /><span className="hint">20% on rep-owned deals</span></div>
                <div className="field"><label htmlFor="rep-new-start">Start date</label><input id="rep-new-start" name="startedOn" type="date" defaultValue={todayIso()} /></div>
              </div>
              <div><SubmitButton className="btn btn-primary" pendingLabel="Inviting…">Invite and send welcome</SubmitButton></div>
            </form>
            {teamWithoutShare.length > 0 && (
              <form action={addFounderShare} className="card stack">
                <div className="card-head"><h2>Add a founder</h2></div>
                <p className="small muted">Set up earnings for an existing founder account: 100% on their own deals and 40% on sales-rep deals. Founder earnings are tracked as owner draws and stay out of the sales-rep 1099 export.</p>
                <div className="field">
                  <label htmlFor="founder-member">Team member</label>
                  <select id="founder-member" name="membershipId" required>{teamWithoutShare.map((t) => <option key={t.id} value={t.id}>{t.email}</option>)}</select>
                </div>
                <div className="field"><label htmlFor="founder-name">Name</label><input id="founder-name" name="displayName" required maxLength={80} /></div>
                <div className="form-grid">
                  <div className="field"><label htmlFor="founder-rate">Share (%)</label><input id="founder-rate" name="rate" inputMode="decimal" value="100" readOnly required /><span className="hint">100% on own deals; 40% on rep deals</span></div>
                  <div className="field"><label htmlFor="founder-start">Start date</label><input id="founder-start" name="startedOn" type="date" defaultValue={todayIso()} /></div>
                </div>
                <div><SubmitButton className="btn btn-primary" pendingLabel="Adding…">Add founder</SubmitButton></div>
              </form>
            )}
          </aside>
        </div>
      ) : (
        <p className="small muted">Only the workspace owner can invite reps or change rates.</p>
      )}
    </main>
  );
}
