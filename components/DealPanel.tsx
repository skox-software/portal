import { outreachConfig } from "@/lib/cold-outreach";
import { and, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { createDeal, markDoNotEmail, saveDeal } from "@/app/admin/pipeline/actions";
import { CallBriefCard } from "@/components/CallBriefCard";
import { EmailDraft } from "@/components/EmailDraft";
import { FollowUpControl } from "@/components/FollowUpControl";
import { LogCallForm } from "@/components/LogCallForm";
import { Notice } from "@/components/Notice";
import { PanelKeys } from "@/components/PanelKeys";
import { SubmitButton } from "@/components/SubmitButton";
import { leadSourcer } from "@/lib/commissions";
import { getDb } from "@/lib/db";
import { events, type Deal } from "@/lib/db/schema";
import { briefIsEmpty, parseBrief, readBrief, type CallBrief } from "@/lib/call-brief";
import { buildEmailDraft } from "@/lib/email-draft";
import { outreachSender, senderLine, signedByOther } from "@/lib/lead-email";
import { formatDate, timeAgo } from "@/lib/format";
import { loadEmailStatuses } from "@/lib/email-status-data";
import { describeFollowUp, outcomeLabel } from "@/lib/follow-up";
import { leadClock } from "@/lib/local-time";
import { COLUMNS, DEAL_KINDS } from "@/lib/pipeline";
import { EMAIL_STATUS_LABEL, type EmailStatus } from "@/lib/resend-events";

const STAGES = [...COLUMNS.filter((c) => c.key !== "in_build" && c.key !== "shipped"), { key: "lost", label: "Lost" }] as const;
const stageName = (key: string) => STAGES.find((s) => s.key === key)?.label ?? key;

export type PanelNav = {
  /** "/admin/pipeline" or "/admin/clients": where saves come back to. */
  base: "/admin/pipeline" | "/admin/clients";
  /** The list's filters as a query string ("?view=list&q=…"), kept through saves. */
  back: string;
  closeHref: string;
  nextId: string | null;
  nextHref: string | null;
  prevHref: string | null;
  /** "3 of 40 in Lead". */
  position: string | null;
};

/**
 * One lead, ready to work: the call brief on top, then one tap to log what
 * happened, the history, and the details to edit. Shared by Pipeline and Clients.
 */
export async function DealPanel({
  deal,
  owners,
  reps = [],
  me,
  linkedProject,
  nav,
  today,
  now,
  notice,
  error,
  emailOpen = false,
}: {
  /** Open with the email draft showing (the board card's Email chip). */
  emailOpen?: boolean;
  deal: Deal | null;
  owners: string[];
  reps?: { id: string; name: string; active: boolean }[];
  me: string;
  linkedProject: { id: string; name: string } | null;
  nav: PanelNav;
  today: string;
  now: Date;
  notice?: string;
  error?: string;
}) {
  const sourcer = deal ? await leadSourcer(deal.workspaceId, deal.createdBy) : null;
  const history = deal
    ? await getDb()
        .select()
        .from(events)
        .where(and(eq(events.workspaceId, deal.workspaceId), eq(events.subjectType, "deal"), eq(events.subjectId, deal.id)))
        .orderBy(desc(events.createdAt))
        .limit(12)
    : [];
  const emailStatus = deal ? (await loadEmailStatuses(deal.workspaceId, deal.id)).get(deal.id) ?? null : null;
  const due = deal ? describeFollowUp(deal.nextStepOn, today) : null;
  const tel = deal?.phone ? `tel:${deal.phone.replace(/[^\d+]/g, "")}` : null;
  // Older leads may still carry the brief inside notes; show it either way, and keep notes for the seller's own words.
  const fromNotes = parseBrief(deal?.notes);
  const brief: CallBrief | null = readBrief(deal?.brief) ?? fromNotes.brief;
  const clock = deal ? leadClock(deal, now) : null;
  let outreachBlocked: string | undefined;
  try { outreachConfig(); } catch { outreachBlocked = "Cold outreach is disabled until the business mailing address and email safeguards are configured and verified."; }
  // Drafts are written and signed as whoever is signed in; they send from that person's outreach address.
  const sender = outreachSender(me);
  const draft = deal ? buildEmailDraft({ company: deal.company, contactName: deal.contactName, website: deal.website, brief, author: sender }) : null;

  return (
    <div className="lead-panel" data-lead-panel>
      <PanelKeys leadKey={deal?.id ?? "new"} closeHref={nav.closeHref} nextHref={nav.nextHref} prevHref={nav.prevHref} />
      <div className="lead-panel-head">
        <div>
          {nav.position && <p className="eyebrow">{nav.position}</p>}
          <h2 id="deal-form-title">{deal ? deal.company : "New deal"}</h2>
          {deal && (deal.contactName || deal.industry || deal.location) && (
            <p className="muted small">{[deal.contactName, deal.industry, deal.location].filter(Boolean).join(" · ")}</p>
          )}
        </div>
        <div className="lead-panel-nav">
          {nav.prevHref && (
            <Link className="btn btn-ghost btn-small" href={nav.prevHref} scroll={false} title="Previous (K)" aria-label="Previous lead">
              ↑
            </Link>
          )}
          {nav.nextHref && (
            <Link className="btn btn-ghost btn-small" href={nav.nextHref} scroll={false} title="Next (J)" aria-label="Next lead">
              ↓
            </Link>
          )}
          <Link className="btn btn-ghost btn-small" href={nav.closeHref} scroll={false} title="Close (Esc)">
            Close
          </Link>
        </div>
      </div>

      {deal && (
        <div className="lead-panel-status">
          <span className="crm-stage" data-stage={deal.stage}>
            <i aria-hidden="true" />
            {stageName(deal.stage)}
          </span>
          <FollowUpControl key={`fu-${deal.id}`} kind="deal" id={deal.id} name={deal.company} dueOn={deal.nextStepOn} note={deal.nextStep} today={today} />
          {due && deal.nextStep && <span className="muted small">{deal.nextStep}</span>}
          {clock && (
            <span className="brief-clock" data-callable={clock.callable ? "" : undefined}>
              {clock.label} their time
            </span>
          )}
          <span className="muted small">{deal.lastContactedAt ? `Last contact ${timeAgo(deal.lastContactedAt, now)}` : "Not contacted yet"}</span>
          {sourcer && (
            <span className="muted small" title="Whoever sourced a lead gets 40% when the other founder closes it; closing your own lead is 100%.">
              Sourced by {sourcer.email.toLowerCase() === me.toLowerCase() ? "you" : sourcer.name}
            </span>
          )}
        </div>
      )}

      {deal?.badNumber && (
        <p className="brief-warning" role="note">
          <strong>Bad number</strong> The last call found {deal.phone ?? "this number"} dead or wrong. Fix the phone in Details to clear this.
        </p>
      )}

      {deal?.doNotEmail && (
        <p className="brief-warning" role="note">
          {emailStatus?.status === "bounced" ? (
            <><strong>Bad email</strong> Our email to {deal.contactEmail ?? "this contact"} bounced{emailStatus.reason ? ` (${emailStatus.reason})` : ""}. Sending is blocked; find a better address and call instead.</>
          ) : emailStatus?.status === "complained" ? (
            <><strong>Bad email</strong> {deal.contactEmail ?? "This contact"} marked our email as spam. Sending is blocked; don&apos;t email them again.</>
          ) : (
            <><strong>Do not email</strong> {deal.contactEmail ?? "This contact"} opted out. Sending is blocked; call only if they asked you to.</>
          )}
        </p>
      )}

      {deal && (
        <div className="pipeline-quick">
          {tel && (
            <a className="btn btn-primary btn-small" href={tel} data-reach="call" title="Call (C)">
              Call {deal.phone}
            </a>
          )}
          {draft && <EmailDraft key={deal.id} dealId={deal.id} to={deal.contactEmail} draft={draft} base={nav.base} back={nav.back} initiallyOpen={emailOpen} saved={brief?.emailDraft} delivery={emailStatus && { ...emailStatus, when: new Date(emailStatus.at).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }) }} canSend fromLine={senderLine(sender)} signedBy={draft ? signedByOther(draft.body, sender) : null} doNotEmail={deal.doNotEmail} outreachBlocked={outreachBlocked} />}
          {deal.contactEmail && !deal.doNotEmail && (
            <form action={markDoNotEmail}>
              <input type="hidden" name="dealId" value={deal.id} />
              <input type="hidden" name="base" value={nav.base} />
              <input type="hidden" name="back" value={nav.back} />
              <SubmitButton className="btn btn-ghost btn-small" pendingLabel="Saving…" title="They replied 'no thanks' or asked not to be emailed">
                Do not email
              </SubmitButton>
            </form>
          )}
          {deal.website && (
            <a className="btn btn-ghost btn-small" href={deal.website} target="_blank" rel="noreferrer" data-reach="site" title="Website (W)">
              Website ↗
            </a>
          )}
        </div>
      )}

      <Notice error={error} notice={notice} />
      {linkedProject && (
        <p className="small muted">
          Onboarded as <Link href={`/admin/projects/${linkedProject.id}`}>{linkedProject.name}</Link>. Its stage follows the project&apos;s status.
        </p>
      )}

      {deal && brief && !briefIsEmpty(brief) && <CallBriefCard brief={brief} />}

      {deal && deal.stage !== "lost" && (
        <LogCallForm key={deal.id} dealId={deal.id} today={today} base={nav.base} back={nav.back} nextId={nav.nextId} nextStep={deal.nextStep} />
      )}

      <DealForm deal={deal} notes={fromNotes.rest} preview={brief?.preview ?? ""} owners={owners} reps={reps} me={me} linked={!!linkedProject} nav={nav} />

      {history.length > 0 && (
        <section className="lead-history" aria-label="History">
          <h3>History</h3>
          <ol>
            {history.map((e) => {
              const p = (e.payload ?? {}) as Record<string, string>;
              const what =
                e.verb === "deal.call_logged"
                  ? outcomeLabel(p.outcome)
                  : e.verb === "follow_up.set"
                    ? `Reminder set for ${formatDate(p.dueOn).replace(/, \d{4}$/, "")}`
                    : e.verb === "follow_up.done"
                      ? "Reminder done"
                      : e.verb === "follow_up.cleared"
                        ? "Reminder removed"
                        : e.verb === "deal.created"
                          ? "Added"
                        : e.verb === "deal.unsubscribed"
                          ? p.via === "staff" ? "Marked do not email" : "Unsubscribed from email"
                        : e.verb === "deal.email_sent"
                          ? "Emailed"
                        : e.verb === "deal.email_status"
                          ? `Email ${EMAIL_STATUS_LABEL[p.status as EmailStatus]?.toLowerCase() ?? "update"}${p.reason ? ` · ${p.reason}` : ""}`
                    : e.verb === "deal.stage_changed" || (e.verb === "deal.updated" && p.to)
                      ? `Moved to ${stageName(p.to)}`
                      : "Details edited";
              return (
                <li key={e.id} data-kind={e.verb === "deal.call_logged" ? "call" : undefined}>
                  <strong>{what}</strong>
                  {e.verb === "deal.call_logged" && p.to && <span> · moved to {stageName(p.to)}</span>}
                  {p.note && <p>{p.note}</p>}
                  {p.followUp && <span className="muted small"> Follow up {formatDate(p.followUp).replace(/, \d{4}$/, "")}</span>}
                  <time className="muted small" dateTime={e.createdAt.toISOString()}>
                    {timeAgo(e.createdAt, now)}
                  </time>
                </li>
              );
            })}
          </ol>
        </section>
      )}
    </div>
  );
}

function DealForm({
  deal,
  notes,
  preview,
  owners,
  reps,
  me,
  linked,
  nav,
}: {
  deal: Deal | null;
  /** The seller's own notes, without the brief lines. */
  notes: string;
  preview: string;
  owners: string[]; reps: { id: string; name: string; active: boolean }[]; me: string; linked: boolean; nav: PanelNav }) {
  const f = (id: string) => `deal-${id}`;
  return (
    <form key={deal?.id ?? "new"} action={deal ? saveDeal : createDeal} className="stack lead-form">
      {deal && <input type="hidden" name="dealId" value={deal.id} />}
      <input type="hidden" name="base" value={nav.base} />
      <input type="hidden" name="back" value={nav.back} />
      {nav.nextId && <input type="hidden" name="nextId" value={nav.nextId} />}
      {deal && <h3 className="lead-form-title">Details</h3>}
      {!deal && (
        <div className="field">
          <label htmlFor={f("company")}>Company</label>
          <input id={f("company")} name="company" required maxLength={120} autoFocus placeholder="Company name" />
        </div>
      )}
      <div className="field">
        <label htmlFor={f("notes")}>Your notes</label>
        <textarea id={f("notes")} name="notes" rows={notes ? 5 : 3} maxLength={4000} defaultValue={notes} placeholder="Anything you learn on calls. The call brief above stays separate." />
      </div>
      <div className="form-grid">
        <div className="field">
          <label htmlFor={f("contactName")}>Contact</label>
          <input id={f("contactName")} name="contactName" maxLength={120} defaultValue={deal?.contactName ?? ""} placeholder="Not set" />
        </div>
        <div className="field">
          <label htmlFor={f("contactEmail")}>Contact email</label>
          <input id={f("contactEmail")} name="contactEmail" type="email" defaultValue={deal?.contactEmail ?? ""} placeholder="Not set" />
        </div>
        <div className="field">
          <label htmlFor={f("phone")}>Phone</label>
          <input id={f("phone")} name="phone" maxLength={40} defaultValue={deal?.phone ?? ""} placeholder="Not set" />
        </div>
        <div className="field">
          <label htmlFor={f("website")}>Website</label>
          <input id={f("website")} name="website" type="url" defaultValue={deal?.website ?? ""} placeholder="https://" />
        </div>
        <div className="field">
          <label htmlFor={f("stage")}>Stage</label>
          <select id={f("stage")} name="stage" defaultValue={deal?.stage ?? "lead"} disabled={linked}>
            {STAGES.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={f("owner")}>Owner</label>
          <select id={f("owner")} name="ownerEmail" defaultValue={deal ? deal.ownerEmail ?? "" : me}>
            <option value="">Unassigned</option>
            {owners.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </div>
        {(reps.length > 0 || deal?.repMembershipId) && (
          <div className="field">
            <label htmlFor={f("rep")}>Sales rep</label>
            <select id={f("rep")} name="repMembershipId" defaultValue={deal?.repMembershipId ?? ""}>
              <option value="">No rep</option>
              {reps
                .filter((r) => r.active || r.id === deal?.repMembershipId)
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                    {r.active ? "" : " (paused)"}
                  </option>
                ))}
            </select>
            <span className="hint">{deal?.repSource === "self" ? "The rep brought this lead." : "Earns their rate on every payment once this becomes a client."}</span>
          </div>
        )}
        <div className="field">
          <label htmlFor={f("nextStepOn")}>Follow up on</label>
          <input id={f("nextStepOn")} name="nextStepOn" type="date" defaultValue={deal?.nextStepOn ?? ""} />
        </div>
        <div className="field">
          <label htmlFor={f("nextStep")}>Next step</label>
          <input id={f("nextStep")} name="nextStep" maxLength={200} defaultValue={deal?.nextStep ?? ""} placeholder="Not set" />
        </div>
        {deal?.stage === "lost" && (
          <div className="field">
            <label htmlFor={f("lostReason")}>Why we lost it</label>
            <input id={f("lostReason")} name="lostReason" maxLength={300} defaultValue={deal.lostReason ?? ""} placeholder="Not set" />
          </div>
        )}
      </div>
      <details className="lead-more" open={!deal}>
        <summary>More fields</summary>
        <div className="form-grid">
          {deal && (
            <div className="field">
              <label htmlFor={f("company")}>Company</label>
              <input id={f("company")} name="company" required maxLength={120} defaultValue={deal.company} />
            </div>
          )}
          <div className="field">
            <label htmlFor={f("preview")}>Website preview link</label>
            <input id={f("preview")} name="preview" type="url" defaultValue={preview} placeholder="https://" />
            <span className="hint">Shown on the brief and added to the email draft.</span>
          </div>
          <div className="field">
            <label htmlFor={f("value")}>Value (USD)</label>
            <input id={f("value")} name="value" inputMode="decimal" defaultValue={deal?.valueCents != null ? String(deal.valueCents / 100) : ""} placeholder="Not set" />
          </div>
          <div className="field">
            <label htmlFor={f("industry")}>Industry</label>
            <input id={f("industry")} name="industry" maxLength={80} defaultValue={deal?.industry ?? ""} placeholder="Not set" />
          </div>
          <div className="field">
            <label htmlFor={f("location")}>Location</label>
            <input id={f("location")} name="location" maxLength={80} defaultValue={deal?.location ?? ""} placeholder="Not set" />
          </div>
          <div className="field">
            <label htmlFor={f("leadSource")}>Lead source</label>
            <input id={f("leadSource")} name="leadSource" maxLength={80} list="lead-sources" defaultValue={deal?.leadSource ?? ""} placeholder="Not set" />
            <datalist id="lead-sources">
              {["Website", "Scoping form", "Referral", "Cold outbound", "LinkedIn", "Apollo visit", "Website chat", "Event"].map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </div>
          <div className="field">
            <label htmlFor={f("kind")}>Type</label>
            <select id={f("kind")} name="kind" defaultValue={deal?.kind ?? "web-app"}>
              {DEAL_KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </details>
      <div className="pipeline-form-actions">
        {nav.nextId && (
          <SubmitButton className="btn btn-primary" name="intent" value="next" pendingLabel="Saving…">
            Save &amp; next
          </SubmitButton>
        )}
        <SubmitButton className={nav.nextId ? "btn btn-ghost" : "btn btn-primary"} pendingLabel="Saving…">
          {deal ? "Save" : "Add deal"}
        </SubmitButton>
        {deal && !linked && deal.stage === "won" && (
          <Link className="btn btn-ghost" href={`/admin/onboard?deal=${deal.id}`}>
            Start onboarding →
          </Link>
        )}
        {deal && (
          <button className="btn btn-ghost pipeline-delete" name="intent" value="delete" formNoValidate>
            Remove
          </button>
        )}
      </div>
      {deal && (
        <p className="small muted">
          Added {formatDate(deal.createdAt.toISOString().slice(0, 10))} · in stage since {formatDate(deal.stageChangedAt.toISOString().slice(0, 10))}
        </p>
      )}
    </form>
  );
}
