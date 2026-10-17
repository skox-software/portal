import { and, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { createDeal, saveDeal } from "@/app/admin/pipeline/actions";
import { LogCallForm } from "@/components/LogCallForm";
import { Notice } from "@/components/Notice";
import { PanelKeys } from "@/components/PanelKeys";
import { SubmitButton } from "@/components/SubmitButton";
import { getDb } from "@/lib/db";
import { events, type Deal } from "@/lib/db/schema";
import { formatDate, timeAgo } from "@/lib/format";
import { describeFollowUp, followUpState, outcomeLabel } from "@/lib/follow-up";
import { COLUMNS, DEAL_KINDS } from "@/lib/pipeline";

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
 * One lead, ready to work: reach them, log what happened, set the follow-up,
 * see the history, then edit details if needed. Shared by Pipeline and Clients.
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
}: {
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
  const history = deal
    ? await getDb()
        .select()
        .from(events)
        .where(and(eq(events.workspaceId, deal.workspaceId), eq(events.subjectType, "deal"), eq(events.subjectId, deal.id)))
        .orderBy(desc(events.createdAt))
        .limit(12)
    : [];
  const due = deal ? describeFollowUp(deal.nextStepOn, today) : null;
  const tel = deal?.phone ? `tel:${deal.phone.replace(/[^\d+]/g, "")}` : null;

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
          {due && (
            <span className="lead-due" data-state={followUpState(deal.nextStepOn, today)}>
              {due}
              {deal.nextStep ? ` · ${deal.nextStep}` : ""}
            </span>
          )}
          <span className="muted small">{deal.lastContactedAt ? `Last contact ${timeAgo(deal.lastContactedAt, now)}` : "Not contacted yet"}</span>
        </div>
      )}

      {deal && (tel || deal.contactEmail || deal.website) && (
        <div className="pipeline-quick">
          {tel && (
            <a className="btn btn-primary btn-small" href={tel} data-reach="call" title="Call (C)">
              Call {deal.phone}
            </a>
          )}
          {deal.contactEmail && (
            <a className="btn btn-ghost btn-small" href={`mailto:${deal.contactEmail}`} data-reach="email" title="Email (E)">
              Email
            </a>
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

      {deal && deal.stage !== "lost" && (
        <LogCallForm key={deal.id} dealId={deal.id} today={today} base={nav.base} back={nav.back} nextId={nav.nextId} nextStep={deal.nextStep} />
      )}

      <DealForm deal={deal} owners={owners} reps={reps} me={me} linked={!!linkedProject} nav={nav} />

      {history.length > 0 && (
        <section className="lead-history" aria-label="History">
          <h3>History</h3>
          <ol>
            {history.map((e) => {
              const p = (e.payload ?? {}) as Record<string, string>;
              const what =
                e.verb === "deal.call_logged"
                  ? outcomeLabel(p.outcome)
                  : e.verb === "deal.created"
                    ? "Added"
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

function DealForm({ deal, owners, reps, me, linked, nav }: { deal: Deal | null; owners: string[]; reps: { id: string; name: string; active: boolean }[]; me: string; linked: boolean; nav: PanelNav }) {
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
      {/* Notes first: imported leads carry their call sheet here. */}
      <div className="field">
        <label htmlFor={f("notes")}>Notes</label>
        <textarea id={f("notes")} name="notes" rows={deal?.notes ? 8 : 4} maxLength={4000} defaultValue={deal?.notes ?? ""} />
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
