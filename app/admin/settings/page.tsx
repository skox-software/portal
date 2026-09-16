import { desc, eq } from "drizzle-orm";
import { requireStaff } from "@/lib/access";
import { getDb } from "@/lib/db";
import { referrals, workspaces } from "@/lib/db/schema";
import { formatDateTime } from "@/lib/format";
import { Notice, readMessage } from "@/components/Notice";
import { saveWorkspaceSettings, setReferralStatus } from "../actions";
export default async function AdminSettings({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
 const { staff } = await requireStaff();
 const sp = await searchParams;
 const db = getDb();
 const [[workspace], referralList] = await Promise.all([
  db.select().from(workspaces).where(eq(workspaces.id, staff.workspaceId)).limit(1),
  db.select().from(referrals).where(eq(referrals.workspaceId, staff.workspaceId)).orderBy(desc(referrals.createdAt)).limit(20)
 ]);
 return <main className="shell page"><div className="page-head"><div><p className="eyebrow">Workspace</p><h1>Settings & referrals</h1><p className="muted">Manage booking links, client communications, and new introductions.</p></div></div>
 <Notice error={readMessage(sp.error)} notice={readMessage(sp.notice)} />
 <div className="split"><div>            <section className="card" aria-labelledby="settings-title">
              <div className="card-head">
                <h2 id="settings-title">Workspace settings</h2>
              </div>
              <form action={saveWorkspaceSettings} className="stack">
                <div className="field">
                  <label htmlFor="ws-scheduling">Kickoff booking link</label>
                  <input id="ws-scheduling" name="schedulingUrl" type="url" defaultValue={workspace?.schedulingUrl ?? ""} maxLength={2048} placeholder="https://calendar.google.com/calendar/appointments/schedules/…" />
                  <span className="hint">Set up a 45-minute kickoff in Google. Its canonical appointment URL embeds here and in onboarding; existing external links open separately.</span>
                </div>
                <div className="field">
                  <label htmlFor="ws-project-review">Project review booking link</label>
                  <input id="ws-project-review" name="projectReviewSchedulingUrl" type="url" maxLength={2048} defaultValue={workspace?.projectReviewSchedulingUrl ?? ""} placeholder="https://calendar.google.com/calendar/appointments/schedules/…" />
                  <span className="hint">Set up a 30-minute review in Google. Leave blank until ready.</span>
                </div>
                <div className="field">
                  <label htmlFor="ws-check-in">Check-in booking link</label>
                  <input id="ws-check-in" name="checkInSchedulingUrl" type="url" maxLength={2048} defaultValue={workspace?.checkInSchedulingUrl ?? ""} placeholder="https://calendar.google.com/calendar/appointments/schedules/…" />
                  <span className="hint">Set up a 15-minute check-in in Google. Leave blank until ready.</span>
                </div>
                <div className="small muted">
                  In Google Calendar, choose Sharing options → Website embed → Inline booking page and copy only the iframe src URL. Use the same calendar for all three schedules, enable conflict checking, and add a required company/project field. Google manages hours, durations, Meet links, and emails. Save links after testing each schedule.
                </div>
                <div className="field">
                  <label htmlFor="ws-intro">Team intro</label>
                  <input id="ws-intro" name="teamIntro" defaultValue={workspace?.teamIntro ?? ""} maxLength={120} placeholder="Josh & Sam, co-founders" />
                  <span className="hint">Signs the welcome note and emails.</span>
                </div>
                <div className="field">
                  <label htmlFor="ws-video">Welcome video (optional)</label>
                  <input id="ws-video" name="welcomeVideoUrl" type="url" defaultValue={workspace?.welcomeVideoUrl ?? ""} placeholder="https://www.loom.com/share/…" />
                  <span className="hint">Leave empty until you record one. Nothing shows without it.</span>
                </div>
                <div className="field">
                  <label htmlFor="ws-review">Review link</label>
                  <input id="ws-review" name="reviewUrl" type="url" defaultValue={workspace?.reviewUrl ?? ""} placeholder="https://g.page/r/…/review" />
                  <span className="hint">Launched clients see “Leave us a quick review”.</span>
                </div>
                <div className="field">
                  <label htmlFor="ws-reward">Referral reward</label>
                  <input id="ws-reward" name="referralReward" defaultValue={workspace?.referralReward ?? ""} maxLength={160} placeholder="you get $500 off your next invoice" />
                  <span className="hint">Reads as: “When they start a project, …”</span>
                </div>
                <div>
                  <button className="btn btn-ghost btn-small" type="submit">
                    Save
                  </button>
                </div>
              </form>
            </section>
</div><aside>            <section className="card" id="referrals" aria-labelledby="referrals-title">
              <div className="card-head">
                <h2 id="referrals-title">Referrals</h2>
                <span className="muted small">{referralList.length}</span>
              </div>
              {referralList.length === 0 ? (
                <p className="small muted">Clients get a personal referral link on their Results page. Leads land here.</p>
              ) : (
                <ul className="task-list">
                  {referralList.map((r) => (
                    <li key={r.id} style={{ display: "grid", gap: 6 }}>
                      <div>
                        <strong style={{ fontWeight: 500 }}>{r.name}</strong>{" "}
                        <a className="small" href={`mailto:${r.email}`}>
                          {r.email}
                        </a>
                        <p className="small muted">
                          {r.company ? `${r.company} · ` : ""}via {r.referrerEmail} · {formatDateTime(r.createdAt)}
                        </p>
                        {r.idea && <p className="small">{r.idea}</p>}
                      </div>
                      <form action={setReferralStatus} className="inline-form">
                        <input type="hidden" name="referralId" value={r.id} />
                        <select name="status" defaultValue={r.status} aria-label="Referral status">
                          <option value="new">New</option>
                          <option value="contacted">Contacted</option>
                          <option value="won">Won</option>
                          <option value="lost">Lost</option>
                        </select>
                        <button className="btn btn-ghost btn-small" type="submit">
                          Save
                        </button>
                      </form>
                    </li>
                  ))}
                </ul>
              )}
            </section>

</aside></div></main>;
}

