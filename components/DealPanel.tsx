import { outreachConfig } from "@/lib/cold-outreach";
import { and, desc, eq, inArray } from "drizzle-orm";
import Link from "next/link";
import { createDeal, moveDealStage, saveDeal } from "@/app/admin/pipeline/actions";
import { ContactLog } from "@/components/ContactLog";
import { CopyButton } from "@/components/CopyButton";
import { EmailDraft } from "@/components/EmailDraft";
import { FollowUpControl } from "@/components/FollowUpControl";
import { Notice } from "@/components/Notice";
import { PanelKeys } from "@/components/PanelKeys";
import { SubmitButton } from "@/components/SubmitButton";
import { getDb } from "@/lib/db";
import { events, memberships, type Deal } from "@/lib/db/schema";
import { parseBrief, readBrief, type CallBrief } from "@/lib/call-brief";
import { buildEmailDraft } from "@/lib/email-draft";
import { outreachSender, senderLine, signedByOther } from "@/lib/lead-email";
import { formatDate, timeAgo } from "@/lib/format";
import { loadEmailStatuses } from "@/lib/email-status-data";
import { outcomeLabel } from "@/lib/follow-up";
import { DEAL_KINDS, FIRST_DEAL_STAGE, OUTREACH_STAGES, STAGE_LABEL, STAGES, stageLabel, TRACK_LABEL, trackOf, type DealStage } from "@/lib/pipeline";
import { EMAIL_STATUS_LABEL, type EmailStatus } from "@/lib/resend-events";

/** What a history line says. Everything that happened to the lead, in its own words. */
function describe(verb: string, p: Record<string, unknown>) {
  const s = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : "");
  switch (verb) {
    case "deal.call_logged":
      return outcomeLabel(s("outcome"));
    case "deal.note_added":
      return "Note";
    case "deal.email_sent":
      return `Emailed${s("to") ? ` ${s("to")}` : ""}`;
    case "deal.email_scheduled":
      return "Email scheduled";
    case "deal.email_status":
      return `Email ${EMAIL_STATUS_LABEL[s("status") as EmailStatus]?.toLowerCase() ?? "update"}${s("reason") ? ` · ${s("reason")}` : ""}`;
    case "deal.created":
      return "Added";
    case "deal.imported":
      return "Imported";
    case "deal.unsubscribed":
      return s("via") === "staff" ? "Marked do not email" : "Unsubscribed from email";
    case "deal.meeting_booked":
      return "Meeting booked";
    case "follow_up.set":
      return `Reminder set for ${formatDate(s("dueOn")).replace(/, \d{4}$/, "")}`;
    case "follow_up.done":
      return "Reminder done";
    case "follow_up.cleared":
      return "Reminder removed";
    case "deal.stage_changed":
      return `Moved to ${stageLabel(s("to"))}`;
    case "deal.updated": {
      const changed = Array.isArray(p.changed) ? (p.changed as { field: string }[]) : [];
      if (s("to")) return `Moved to ${stageLabel(s("to"))}`;
      return changed.length ? `${changed.map((c) => c.field).join(", ")} updated` : "Details edited";
    }
    default:
      return null;
  }
}

/** "Moved to X" lines for a call or an email that also moved the lead. */
const movedBy = (verb: string, p: Record<string, unknown>) => (verb === "deal.call_logged" && typeof p.to === "string" ? stageLabel(p.to) : null);

export type PanelNav = {
  /** "/admin/pipeline" or "/admin/clients": where saves come back to. */
  base: "/admin/pipeline" | "/admin/clients";
  /** The list's filters as a query string ("?view=list&q=…"), kept through saves. */
  back: string;
  closeHref: string;
  nextId: string | null;
  nextHref: string | null;
  prevHref: string | null;
  /** "3 of 40 in Outreach 1". */
  position: string | null;
};

/**
 * One lead, ready to work. Top to bottom: who they are and how to reach them,
 * which stage they're in, where to log this contact, and everything that's
 * happened so far. Shared by Pipeline and Clients.
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
  const db = getDb();
  const history = deal
    ? await db
        .select()
        .from(events)
        .where(and(eq(events.workspaceId, deal.workspaceId), eq(events.subjectType, "deal"), eq(events.subjectId, deal.id)))
        .orderBy(desc(events.createdAt))
        .limit(200)
    : [];
  const actorIds = [...new Set(history.map((e) => e.actorId).filter((a): a is string => !!a))];
  const actors = actorIds.length
    ? await db
        .select({ userId: memberships.userId, email: memberships.email })
        .from(memberships)
        .where(and(eq(memberships.workspaceId, deal!.workspaceId), inArray(memberships.userId, actorIds)))
    : [];
  const who = (actorId: string | null) => {
    if (!actorId) return null;
    if (actorId === "website") return "Website";
    const email = actors.find((a) => a.userId === actorId)?.email;
    if (!email) return null;
    return email.toLowerCase() === me.toLowerCase() ? "You" : email.split("@")[0].replace(/^./, (c) => c.toUpperCase());
  };
  const lines = history.flatMap((e) => {
    const p = (e.payload ?? {}) as Record<string, unknown>;
    const what = describe(e.verb, p);
    return what ? [{ e, p, what }] : [];
  });
  const lastReach = history.find((e) => e.verb === "deal.call_logged" || e.verb === "deal.email_sent");
  const lastReachWhat = lastReach ? describe(lastReach.verb, (lastReach.payload ?? {}) as Record<string, unknown>) : null;

  const emailStatus = deal ? (await loadEmailStatuses(deal.workspaceId, deal.id)).get(deal.id) ?? null : null;
  const tel = deal?.phone ? `tel:${deal.phone.replace(/[^\d+]/g, "")}` : null;
  // Older leads keep the research brief inside notes; only the seller's own words show, as "Earlier notes".
  const fromNotes = parseBrief(deal?.notes);
  const brief: CallBrief | null = readBrief(deal?.brief) ?? fromNotes.brief;
  let outreachBlocked: string | undefined;
  try { outreachConfig(); } catch { outreachBlocked = "Cold outreach is disabled until the business mailing address and email safeguards are configured and verified."; }
  // Drafts are written and signed as whoever is signed in; they send from that person's outreach address.
  const sender = outreachSender(me);
  const draft = deal ? buildEmailDraft({ company: deal.company, contactName: deal.contactName, website: deal.website, brief, author: sender }) : null;
  const track = deal ? trackOf(deal.stage) : null;
  const hidden = (
    <>
      {deal && <input type="hidden" name="dealId" value={deal.id} />}
      <input type="hidden" name="base" value={nav.base} />
      <input type="hidden" name="back" value={nav.back} />
    </>
  );

  return (
    <div className="lead-panel" data-lead-panel>
      <PanelKeys leadKey={deal?.id ?? "new"} closeHref={nav.closeHref} nextHref={nav.nextHref} prevHref={nav.prevHref} />
      <div className="lead-panel-head">
        <div>
          {nav.position && <p className="eyebrow">{nav.position}</p>}
          <h2 id="deal-form-title">{deal ? deal.company : "New lead"}</h2>
          {deal?.contactName && <p className="muted small">{deal.contactName}</p>}
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

      <Notice error={error} notice={notice} />

      {deal && (
        <div className="lead-panel-status">
          <span className="crm-stage" data-stage={deal.stage}>
            <i aria-hidden="true" />
            {track && TRACK_LABEL[track]} · {stageLabel(deal.stage)}
          </span>
          <span className="small">
            {lastReach ? (
              <>
                Last reached out <strong>{timeAgo(lastReach.createdAt, now)}</strong>
                {lastReachWhat && <span className="muted"> ({lastReachWhat})</span>}
              </>
            ) : (
              <span className="muted">Not contacted yet</span>
            )}
          </span>
          <FollowUpControl key={`fu-${deal.id}`} kind="deal" id={deal.id} name={deal.company} dueOn={deal.nextStepOn} note={deal.nextStep} today={today} />
        </div>
      )}

      {deal?.doNotEmail && (
        <p className="brief-warning small" role="note">
          <strong>Don&apos;t email</strong> {emailStatus?.status === "bounced" ? "the last email bounced" : emailStatus?.status === "complained" ? "they marked our email as spam" : "they opted out"}.
        </p>
      )}

      <DealForm deal={deal} owners={owners} reps={reps} me={me} linked={!!linkedProject} nav={nav} tel={tel} />

      {deal && draft && (
        <div className="lead-email">
          <EmailDraft key={deal.id} dealId={deal.id} to={deal.contactEmail} draft={draft} base={nav.base} back={nav.back} initiallyOpen={emailOpen} saved={brief?.emailDraft} delivery={emailStatus && { ...emailStatus, when: new Date(emailStatus.at).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }) }} canSend fromLine={senderLine(sender)} signedBy={draft ? signedByOther(draft.body, sender) : null} doNotEmail={deal.doNotEmail} outreachBlocked={outreachBlocked} />
        </div>
      )}

      {deal && linkedProject && (
        <p className="small muted">
          Onboarded as <Link href={`/admin/projects/${linkedProject.id}`}>{linkedProject.name}</Link>. Its stage follows the project&apos;s status.
        </p>
      )}

      {deal && !linkedProject && (
        <form action={moveDealStage} className="stage-bar" aria-label="Stage">
          {hidden}
          <div className="stage-bar-row" role="group" aria-label={TRACK_LABEL[track!]}>
            {(track === "outreach" ? OUTREACH_STAGES : STAGES.filter((s) => trackOf(s) === "deals")).map((s) => (
              <SubmitButton key={s} className="stage-bar-step" name="to" value={s} aria-current={deal.stage === s ? "step" : undefined} disabled={deal.stage === s} data-stage={s} pendingLabel="…">
                {s === "outreach_closed" ? "Close" : STAGE_LABEL[s]}
              </SubmitButton>
            ))}
          </div>
          {track === "outreach" ? (
            <SubmitButton className="btn btn-primary btn-small" name="to" value={FIRST_DEAL_STAGE} pendingLabel="Moving…">
              Move to Potential Deals →
            </SubmitButton>
          ) : (
            <div className="stage-bar-extra">
              {deal.stage === "won" && (
                <Link className="btn btn-primary btn-small" href={`/admin/onboard?deal=${deal.id}`}>
                  Start onboarding →
                </Link>
              )}
              <SubmitButton className="btn btn-ghost btn-small" name="to" value="outreach_1" pendingLabel="Moving…" title="Back to Pre-qualified, history kept">
                ← Back to outreach
              </SubmitButton>
            </div>
          )}
        </form>
      )}

      {deal && <ContactLog key={deal.id} dealId={deal.id} stage={deal.stage as DealStage} base={nav.base} back={nav.back} nextId={nav.nextId} />}

      {deal && (
        <section className="lead-history" aria-label="History">
          <h3>History</h3>
          {lines.length === 0 && !fromNotes.rest ? (
            <p className="muted small">Nothing yet. Calls, emails, notes and stage moves show up here.</p>
          ) : (
            <ol>
              {lines.map(({ e, p, what }) => {
                const note = typeof p.note === "string" ? p.note : null;
                const changed = e.verb === "deal.updated" && Array.isArray(p.changed) ? (p.changed as { field: string; from: string | null; to: string | null }[]) : [];
                const moved = movedBy(e.verb, p);
                const by = who(e.actorId);
                return (
                  <li key={e.id} data-kind={e.verb === "deal.call_logged" ? "call" : e.verb === "deal.note_added" ? "note" : e.verb.startsWith("deal.email") ? "email" : undefined}>
                    <strong>{what}</strong>
                    {moved && <span> · moved to {moved}</span>}
                    {note && <p>{note}</p>}
                    {changed.map((c) => (
                      <p key={c.field} className="small muted">
                        {c.field}: {c.from || "empty"} → {c.to || "empty"}
                      </p>
                    ))}
                    <time className="muted small" dateTime={e.createdAt.toISOString()} title={e.createdAt.toLocaleString("en-US", { timeZone: "America/New_York" })}>
                      {timeAgo(e.createdAt, now)}
                      {by ? ` · ${by}` : ""}
                    </time>
                  </li>
                );
              })}
              {fromNotes.rest && (
                <li data-kind="note">
                  <strong>Earlier notes</strong>
                  <p className="lead-earlier-notes">{fromNotes.rest}</p>
                </li>
              )}
            </ol>
          )}
        </section>
      )}
    </div>
  );
}

/** The four things that matter on a call, each with its one-tap action, plus everything else folded under "More". */
function DealForm({
  deal,
  owners,
  reps,
  me,
  linked,
  nav,
  tel,
}: {
  deal: Deal | null;
  owners: string[];
  reps: { id: string; name: string; active: boolean }[];
  me: string;
  linked: boolean;
  nav: PanelNav;
  tel: string | null;
}) {
  const f = (id: string) => `deal-${id}`;
  return (
    <form key={deal?.id ?? "new"} action={deal ? saveDeal : createDeal} className="lead-form lead-contact">
      {deal && <input type="hidden" name="dealId" value={deal.id} />}
      <input type="hidden" name="base" value={nav.base} />
      <input type="hidden" name="back" value={nav.back} />
      <div className="lead-contact-row">
        <label htmlFor={f("company")}>Name</label>
        <input id={f("company")} name="company" required maxLength={120} autoFocus={!deal} defaultValue={deal?.company ?? ""} placeholder="Business or contact name" />
      </div>
      <div className="lead-contact-row">
        <label htmlFor={f("contactName")}>Contact</label>
        <input id={f("contactName")} name="contactName" maxLength={120} defaultValue={deal?.contactName ?? ""} placeholder="Who to ask for" />
      </div>
      <div className="lead-contact-row">
        <label htmlFor={f("phone")}>Phone</label>
        <input id={f("phone")} name="phone" type="tel" maxLength={40} defaultValue={deal?.phone ?? ""} placeholder="Add a phone number" />
        {tel && (
          <a className="btn btn-primary btn-small" href={tel} data-reach="call" title="Call (C)">
            Call
          </a>
        )}
        {deal?.badNumber && <span className="lead-flag" title="The last call found this number dead or wrong. Change it to clear the flag.">Bad number</span>}
      </div>
      <div className="lead-contact-row">
        <label htmlFor={f("contactEmail")}>Email</label>
        <input id={f("contactEmail")} name="contactEmail" type="email" defaultValue={deal?.contactEmail ?? ""} placeholder="Add an email" />
        {deal?.contactEmail && <CopyButton value={deal.contactEmail} />}
        {deal?.contactEmail && (
          <a className="btn btn-ghost btn-small" href={`mailto:${deal.contactEmail}`} title="Open in your mail app">
            Mail ↗
          </a>
        )}
      </div>
      <div className="lead-contact-row">
        <label htmlFor={f("website")}>Website</label>
        <input id={f("website")} name="website" type="url" defaultValue={deal?.website ?? ""} placeholder="https://" />
        {deal?.website && (
          <a className="btn btn-ghost btn-small" href={deal.website} target="_blank" rel="noreferrer" data-reach="site" title="Website (W)">
            Open ↗
          </a>
        )}
      </div>

      {!deal && (
        <div className="lead-contact-row">
          <label htmlFor={f("stage")}>Stage</label>
          <select id={f("stage")} name="stage" defaultValue="outreach_1">
            {STAGES.map((s) => (
              <option key={s} value={s}>
                {TRACK_LABEL[trackOf(s)]} · {STAGE_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
      )}

      <details className="lead-more">
        <summary>More</summary>
        <div className="form-grid">
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
            </div>
          )}
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
            <select id={f("kind")} name="kind" defaultValue={deal?.kind ?? "website"}>
              {DEAL_KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
          </div>
          {deal?.stage === "lost" && (
            <div className="field">
              <label htmlFor={f("lostReason")}>Why we lost it</label>
              <input id={f("lostReason")} name="lostReason" maxLength={300} defaultValue={deal.lostReason ?? ""} placeholder="Not set" />
            </div>
          )}
        </div>
        {deal && (
          <p className="small muted">
            Added {formatDate(deal.createdAt.toISOString().slice(0, 10))} · in this stage since {formatDate(deal.stageChangedAt.toISOString().slice(0, 10))}
            {linked ? " · onboarded" : ""}
          </p>
        )}
        {deal && (
          <button className="btn btn-ghost btn-small pipeline-delete" name="intent" value="delete" formNoValidate>
            Remove lead
          </button>
        )}
      </details>

      <div className="pipeline-form-actions">
        <SubmitButton className={deal ? "btn btn-ghost btn-small" : "btn btn-primary"} pendingLabel="Saving…">
          {deal ? "Save details" : "Add lead"}
        </SubmitButton>
      </div>
    </form>
  );
}
