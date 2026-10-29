import Link from "next/link";
import { Notice, readMessage } from "@/components/Notice";
import { SubmitButton } from "@/components/SubmitButton";
import { createRepLead } from "@/app/rep/actions";
import { requireRep } from "@/lib/access";
import { formatRate } from "@/lib/commission-math";
import { myProfile } from "@/lib/rep-data";

export const metadata = { title: "Add a lead" };

export default async function NewRepLead({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { rep } = await requireRep();
  const [sp, profile] = await Promise.all([searchParams, myProfile(rep)]);
  return (
    <>
      <Link className="rp-back" href="/rep/leads">← Leads</Link>
      <div className="rp-split">
        <div>
          <p className="rp-kicker">Bring your own</p>
          <h1 className="rp-title">Add a lead</h1>
          <p className="rp-lede">A business you know that needs a better website or web app. If nobody has added it yet, it&apos;s yours, and so is {profile ? formatRate(profile.rateBps) : "your cut"} of everything they ever pay UnBusy.</p>
          <Notice error={readMessage(sp.error)} notice={readMessage(sp.notice)} />
          <form action={createRepLead} className="rp-panel rp-form" style={{ marginTop: 28 }}>
            <div className="field">
              <label htmlFor="lead-company">Business name</label>
              <input id="lead-company" name="company" required minLength={2} maxLength={160} autoComplete="organization" />
            </div>
            <div className="rp-grid2">
              <div className="field">
                <label htmlFor="lead-contact">Contact name</label>
                <input id="lead-contact" name="contactName" maxLength={120} autoComplete="off" />
              </div>
              <div className="field">
                <label htmlFor="lead-phone">Phone</label>
                <input id="lead-phone" name="phone" type="tel" maxLength={40} autoComplete="off" />
              </div>
              <div className="field">
                <label htmlFor="lead-email">Email</label>
                <input id="lead-email" name="contactEmail" type="email" maxLength={200} autoComplete="off" />
              </div>
            </div>
            <div className="rp-grid2">
              <div className="field">
                <label htmlFor="lead-website">Current website</label>
                <input id="lead-website" name="website" maxLength={300} placeholder="Empty if they have none" autoComplete="off" />
              </div>
              <div className="field">
                <label htmlFor="lead-industry">Industry</label>
                <input id="lead-industry" name="industry" maxLength={80} autoComplete="off" />
              </div>
              <div className="field">
                <label htmlFor="lead-location">City, state</label>
                <input id="lead-location" name="location" maxLength={120} autoComplete="off" />
              </div>
            </div>
            <div className="field">
              <label htmlFor="lead-notes">How you know them</label>
              <textarea id="lead-notes" name="repNotes" maxLength={2000} rows={3} />
              <span className="hint">How you met, what they&apos;ve said about their site, the best time to call.</span>
            </div>
            <div><SubmitButton className="btn btn-primary" pendingLabel="Checking…">Claim this lead</SubmitButton></div>
          </form>
        </div>
        <aside className="rp-panel" data-accent style={{ marginTop: 8 }}>
          <h2>The rules</h2>
          <ol className="rp-steps" style={{ marginTop: 16 }}>
            <li><span><strong>First to add wins.</strong> We check every business UnBusy already knows by name, phone, email and website.</span></li>
            <li><span><strong>A phone or an email.</strong> We need at least one way to reach them.</span></li>
            <li><span><strong>It&apos;s yours for good.</strong> If they become a client, you earn on every payment they make.</span></li>
          </ol>
        </aside>
      </div>
    </>
  );
}
