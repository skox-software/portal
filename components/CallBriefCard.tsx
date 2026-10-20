import { warningLabel, type CallBrief } from "@/lib/call-brief";

/** Links inside SOURCES and the like, so they can be opened from the card. */
function Linked({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s;,)]+)/g);
  return (
    <>
      {parts.map((p, i) =>
        /^https?:\/\//.test(p) ? (
          <a key={i} href={p} target="_blank" rel="noreferrer">
            {p.replace(/^https?:\/\/(www\.)?/, "").slice(0, 48)}
            {p.replace(/^https?:\/\/(www\.)?/, "").length > 48 ? "…" : ""}
          </a>
        ) : (
          p
        ),
      )}
    </>
  );
}

/**
 * The call brief, read-only, at the top of the lead: who to ask for, the line
 * to open with, why we're calling and what to ask. Research detail is folded
 * away. Warnings sit on top so they're read before dialling.
 */
export function CallBriefCard({ brief }: { brief: CallBrief }) {
  const more = [
    brief.upgradeAngle && { label: "Upgrade angle", text: brief.upgradeAngle },
    brief.about && { label: "About them", text: brief.about },
    brief.stillActive && { label: "Still active", text: brief.stillActive },
    brief.call && { label: "Number checked", text: brief.call },
    brief.sources && { label: "Sources", text: brief.sources },
  ].filter(Boolean) as { label: string; text: string }[];

  return (
    <section className="brief" aria-label="Call brief">
      {brief.warnings?.map((w, i) => (
        <p key={i} className="brief-warning" role="note">
          <strong>{warningLabel(w.kind)}</strong> {w.text}
        </p>
      ))}
      <div className="brief-top">
        {brief.tag && (
          <span className="brief-tag" data-tag={brief.tag}>
            {brief.tag}
          </span>
        )}
        {brief.vertical && <span className="muted small">{brief.vertical}</span>}
        {typeof brief.leadScore === "number" && (
          <span className="brief-score small" title={brief.scoreWhy || "Lead brain score"}>
            Score {brief.leadScore}
          </span>
        )}
      </div>
      {brief.askFor && (
        <p className="brief-ask">
          <span>Ask for</span> <strong>{brief.askFor}</strong>
        </p>
      )}
      {brief.outlook && (
        <p className="brief-outlook small" data-outlook={/^WINDING DOWN/i.test(brief.outlook) ? "down" : /^GROWING/i.test(brief.outlook) ? "up" : "flat"}>
          <span>Outlook</span> {brief.outlook}
        </p>
      )}
      {brief.gatekeeper && (
        <p className="brief-gatekeeper small">
          Last time <strong>{brief.gatekeeper}</strong> answered. Ask for {brief.askFor && !/^the owner/i.test(brief.askFor) ? brief.askFor.split(/,| or /)[0] : "the owner"} by name.
        </p>
      )}
      {brief.opener && (
        <blockquote className="brief-opener">
          <span className="brief-label">Say</span>
          {brief.opener}
        </blockquote>
      )}
      <dl className="brief-points">
        {brief.why && (
          <div>
            <dt>Why we&apos;re calling</dt>
            <dd>{brief.why}</dd>
          </div>
        )}
        {brief.alsoMention && (
          <div>
            <dt>Also mention</dt>
            <dd>{brief.alsoMention}</dd>
          </div>
        )}
        {brief.askThem && (
          <div className="brief-question">
            <dt>Ask them</dt>
            <dd>{brief.askThem}</dd>
          </div>
        )}
        {brief.preview && (
          <div>
            <dt>Preview</dt>
            <dd>
              <a href={brief.preview} target="_blank" rel="noreferrer">
                {brief.preview.replace(/^https?:\/\//, "")} ↗
              </a>
            </dd>
          </div>
        )}
      </dl>
      {more.map((m) => (
        <details key={m.label} className="brief-more">
          <summary>{m.label}</summary>
          <p>
            <Linked text={m.text} />
          </p>
        </details>
      ))}
    </section>
  );
}
