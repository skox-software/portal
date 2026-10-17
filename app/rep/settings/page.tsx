import { Notice, readMessage } from "@/components/Notice";
import { SubmitButton } from "@/components/SubmitButton";
import { saveRepSettings } from "@/app/rep/actions";
import { requireRep } from "@/lib/access";
import { formatRate } from "@/lib/commission-math";
import { formatDate } from "@/lib/format";
import { myProfile } from "@/lib/rep-data";

export const metadata = { title: "Account" };

export default async function RepSettings({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const { rep } = await requireRep();
  const profile = await myProfile(rep);
  if (!profile) return null;
  return (
    <>
      <p className="rp-kicker">Account</p>
      <h1 className="rp-title">{profile.displayName}</h1>
      <p className="rp-lede">Signed in as {profile.email}.</p>
      <Notice error={readMessage(sp.error)} notice={readMessage(sp.notice)} />
      <div className="rp-section rp-split" style={{ marginTop: 36 }}>
        <form action={saveRepSettings} className="rp-panel rp-form">
          <h2>Your details</h2>
          <div className="field">
            <label htmlFor="rep-name">Your name</label>
            <input id="rep-name" name="displayName" defaultValue={profile.displayName} required minLength={2} maxLength={80} />
          </div>
          <div className="field">
            <label htmlFor="rep-phone">Phone</label>
            <input id="rep-phone" name="phone" type="tel" defaultValue={profile.phone ?? ""} maxLength={40} />
            <span className="hint">So SKOX can reach you about a lead.</span>
          </div>
          <label className="check">
            <input type="checkbox" name="emailUpdates" defaultChecked={profile.emailUpdates} />
            <span>Email me when SKOX sends me new leads. Statements and payments always reach you.</span>
          </label>
          <div><SubmitButton className="btn btn-primary" pendingLabel="Saving…">Save</SubmitButton></div>
        </form>
        <aside className="rp-panel" data-accent>
          <h2>Your deal with SKOX</h2>
          <dl className="rp-facts" style={{ marginTop: 16 }}>
            <dt>Rate</dt><dd>{formatRate(profile.rateBps)} of cash collected</dd>
            <dt>Since</dt><dd>{profile.startedOn ? formatDate(profile.startedOn) : "—"}</dd>
            <dt>Status</dt><dd>{profile.status === "active" ? "Active" : "Paused"}</dd>
            <dt>Agreement</dt><dd>{profile.agreementSignedAt ? "Signed" : "Waiting on SKOX"}</dd>
            <dt>W-9</dt><dd>{profile.w9ReceivedAt ? "Received" : "Not received yet"}</dd>
            <dt>Paid by</dt><dd>{profile.payoutNotes ?? "SKOX will confirm with you"}</dd>
          </dl>
          <p className="rp-note" style={{ marginTop: 18 }}>To change your rate or how you&apos;re paid, talk to SKOX.</p>
        </aside>
      </div>
    </>
  );
}
