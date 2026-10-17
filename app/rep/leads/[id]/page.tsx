import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { LogCallForm } from "@/components/LogCallForm";
import { Notice, readMessage } from "@/components/Notice";
import { SubmitButton } from "@/components/SubmitButton";
import { Icon, MAIL_ICON, PHONE_ICON, telHref } from "@/components/rep/Dial";
import { RepTrack } from "@/components/rep/RepTrack";
import { logRepCall, markMeetingBooked, saveRepNotes } from "@/app/rep/actions";
import { requireRep } from "@/lib/access";
import { getDb } from "@/lib/db";
import { workspaces } from "@/lib/db/schema";
import { formatDate, formatDateTime } from "@/lib/format";
import { outcomeLabel, salesToday } from "@/lib/follow-up";
import { myLead, myLeadHistory, myLeads } from "@/lib/rep-data";
import { repCanWork } from "@/lib/rep-status";

export const metadata = { title: "Lead" };

function historyLine(verb: string, payload: Record<string, unknown>) {
  if (verb === "deal.call_logged") return `${outcomeLabel(String(payload.outcome ?? ""))}${payload.note ? `: ${payload.note}` : ""}`;
  if (verb === "deal.meeting_booked") return `Booked the scope call for ${payload.when}${payload.note ? `: ${payload.note}` : ""}`;
  if (verb === "deal.created") return "You added this lead";
  return null;
}

const STATUS_NOTE = {
  working: null,
  booked: "The scope call is on SKOX's calendar. Keep the relationship warm; SKOX takes the call.",
  with_skox: "SKOX is quoting and closing this one. Nothing for you to do. You'll see it move to Won.",
  won: "They signed. Every payment they make to SKOX lands in your money feed.",
  lost: "This one closed without a deal.",
} as const;

export default async function RepLeadPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!z.uuid().safeParse(id).success) notFound();
  const { viewer, rep } = await requireRep();
  const lead = await myLead(rep, id);
  if (!lead) notFound();
  const [history, all, [ws]] = await Promise.all([
    myLeadHistory(rep, viewer.userId, id),
    myLeads(rep),
    getDb().select({ schedulingUrl: workspaces.schedulingUrl }).from(workspaces).where(eq(workspaces.id, rep.workspaceId)).limit(1),
  ]);
  const today = salesToday();
  const workable = all.filter((l) => repCanWork(l.status));
  const at = workable.findIndex((l) => l.id === id);
  const nextId = at >= 0 ? workable[at + 1]?.id ?? null : null;
  const canWork = repCanWork(lead.status);
  const site = lead.website ? (lead.website.includes("://") ? lead.website : `https://${lead.website}`) : null;
  const lines = history.map((h) => ({ at: h.createdAt, text: historyLine(h.verb, (h.payload ?? {}) as Record<string, unknown>) })).filter((h) => h.text);

  return (
    <>
      <Link className="rp-back" href="/rep/leads">← Leads</Link>
      <header className="rp-lead-head">
        <div>
          <p className="rp-kicker">{lead.repSource === "self" ? "You brought this lead" : "From SKOX"}{[lead.industry, lead.location].filter(Boolean).length ? ` · ${[lead.industry, lead.location].filter(Boolean).join(" · ")}` : ""}</p>
          <h1 className="rp-title">{lead.company}</h1>
          <RepTrack status={lead.status} />
        </div>
        {canWork && (lead.phone || lead.contactEmail) && (
          <div className="rp-actions">
            {lead.phone && <a className="rp-btn" data-primary href={telHref(lead.phone)}><Icon d={PHONE_ICON} />Call {lead.contactName?.split(" ")[0] ?? "now"}</a>}
            {lead.contactEmail && <a className="rp-btn" href={`mailto:${lead.contactEmail}`}><Icon d={MAIL_ICON} />Email</a>}
          </div>
        )}
      </header>
      <Notice error={readMessage(sp.error)} notice={readMessage(sp.notice)} />

      <div className="rp-section rp-split" style={{ marginTop: 36 }}>
        <div>
          {STATUS_NOTE[lead.status] && (
            <div className="rp-panel" data-accent={lead.status === "won" ? "" : undefined}>
              <p className="rp-note"><strong>{lead.status === "won" ? "Won." : lead.status === "lost" ? "Closed." : "Status."}</strong> {STATUS_NOTE[lead.status]}</p>
            </div>
          )}
          {canWork && (
            <div className="rp-panel">
              <LogCallForm action={logRepCall} dealId={lead.id} today={today} base="/rep/leads" back="" nextId={nextId} nextStep={lead.nextStep} />
            </div>
          )}
          {canWork && (
            <div className="rp-panel" data-accent>
              <h2>{lead.status === "booked" ? "Call booked" : "Book the scope call"}</h2>
              <p>
                {lead.status === "booked"
                  ? "If the time changed, book it again with the new time."
                  : "This is the win. When they agree to talk, pick a time on SKOX's calendar, then record it here. SKOX runs the call and handles all pricing."}
                {ws?.schedulingUrl && <> <a href={ws.schedulingUrl} target="_blank" rel="noreferrer" style={{ color: "var(--amber)" }}>Open SKOX&apos;s calendar ↗</a></>}
              </p>
              <form action={markMeetingBooked} className="rp-form">
                <input type="hidden" name="dealId" value={lead.id} />
                <div className="rp-grid2">
                  <div className="field">
                    <label htmlFor="meet-day">Day of the call</label>
                    <input id="meet-day" name="day" type="date" min={today} required />
                  </div>
                  <div className="field">
                    <label htmlFor="meet-time">Time (Eastern)</label>
                    <input id="meet-time" name="time" maxLength={40} placeholder="2:30pm" />
                  </div>
                </div>
                <div className="field">
                  <label htmlFor="meet-note">Anything SKOX should know</label>
                  <textarea id="meet-note" name="note" rows={2} maxLength={1000} placeholder="What they want, who'll be on the call" />
                </div>
                <div><SubmitButton className="btn btn-primary" pendingLabel="Saving…">Mark call booked</SubmitButton></div>
              </form>
            </div>
          )}
          <div className="rp-panel">
            <h2>Your activity</h2>
            {lines.length === 0 ? (
              <p>Nothing logged yet.</p>
            ) : (
              <ul className="rp-history">
                {lines.map((h, i) => <li key={i}><span><time>{formatDateTime(h.at)}</time>{h.text}</span></li>)}
              </ul>
            )}
          </div>
        </div>

        <aside>
          <div className="rp-panel">
            <h2>Contact</h2>
            <dl className="rp-facts" style={{ marginTop: 14 }}>
              <dt>Name</dt><dd>{lead.contactName ?? "Not known"}</dd>
              <dt>Phone</dt><dd>{lead.phone ? <a href={telHref(lead.phone)}>{lead.phone}</a> : "None"}</dd>
              <dt>Email</dt><dd>{lead.contactEmail ? <a href={`mailto:${lead.contactEmail}`}>{lead.contactEmail}</a> : "None"}</dd>
              <dt>Website</dt><dd>{site ? <a href={site} target="_blank" rel="noreferrer">{lead.website}</a> : "None"}</dd>
              <dt>Next</dt><dd>{lead.nextStepOn ? `${formatDate(lead.nextStepOn)}${lead.nextStep ? ` · ${lead.nextStep}` : ""}` : "Not set"}</dd>
              <dt>Last call</dt><dd>{lead.lastContactedAt ? formatDateTime(lead.lastContactedAt) : "Never"}</dd>
            </dl>
          </div>
          <div className="rp-panel">
            <h2>Your notes</h2>
            <p>Only you and SKOX see these.</p>
            <form action={saveRepNotes} className="rp-form">
              <input type="hidden" name="dealId" value={lead.id} />
              <label className="sr-only" htmlFor="rep-notes">Your notes</label>
              <textarea id="rep-notes" name="repNotes" rows={6} maxLength={4000} defaultValue={lead.repNotes ?? ""} />
              <div><SubmitButton className="btn btn-ghost btn-small" pendingLabel="Saving…">Save notes</SubmitButton></div>
            </form>
          </div>
        </aside>
      </div>
    </>
  );
}
