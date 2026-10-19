import Link from "next/link";
import { buildQueue, TIER_LABEL, type QueueItem, type QueueSource, type Who } from "@/lib/overview-math";
import { Owner } from "./Owner";

const ICON: Record<QueueSource, string> = {
  follow_up: "☎",
  invoice: "$",
  commission: "%",
  deal: "⇉",
  outreach: "✉",
  meeting: "◷",
  inbox: "✉",
  request: "↗",
  approval: "!",
  document: "✎",
  idea: "★",
  feedback: "◎",
  onboarding: "◈",
  referral: "+",
  contact: "◎",
};

const SHOWN = 10;

function Row({ item }: { item: QueueItem }) {
  return (
    <li>
      <Link className="admin-action ov-item" data-priority={item.tier === "now" ? "high" : "normal"} href={item.href}>
        <span className="admin-action-icon" aria-hidden="true">
          {ICON[item.source]}
        </span>
        <div>
          <strong>{item.text}</strong>
          {item.detail && <small>{item.detail}</small>}
        </div>
        <span className="ov-tier" data-tier={item.tier}>
          {TIER_LABEL[item.tier]}
        </span>
        <Owner email={item.owner} />
      </Link>
    </li>
  );
}

/** The one list of what needs a person: ranked Now, Today, This week. */
export function Queue({ items, who, me }: { items: QueueItem[]; who: Who; me: string }) {
  const q = buildQueue(items, who, me);
  const now = q.items.filter((i) => i.tier === "now").length;
  return (
    <section className="admin-panel" id="attention">
      <div className="admin-panel-head ov-queue-head">
        <div>
          <h2>Needs you</h2>
          <p>{now ? `${now} need${now === 1 ? "s" : ""} doing now. ` : ""}Ranked by urgency, oldest first.</p>
        </div>
        <nav className="crm-views" aria-label="Whose items">
          <Link href="/admin" aria-current={who === "me" ? "page" : undefined} scroll={false}>
            Mine <span>{q.mineCount}</span>
          </Link>
          <Link href="/admin?who=all" aria-current={who === "all" ? "page" : undefined} scroll={false}>
            Everyone <span>{q.teamCount}</span>
          </Link>
        </nav>
      </div>
      {q.items.length ? (
        <ul className="admin-action-list">
          {q.items.slice(0, SHOWN).map((item) => (
            <Row key={item.key} item={item} />
          ))}
        </ul>
      ) : (
        <p className="admin-empty">
          Nothing on your plate.
          {q.othersCount > 0 && (
            <>
              {" "}
              <Link href="/admin?who=all">{q.othersCount} thing{q.othersCount === 1 ? "" : "s"} for the rest of the team →</Link>
            </>
          )}
        </p>
      )}
      {q.items.length > SHOWN && (
        <details className="ov-more">
          <summary className="admin-empty">Show {q.items.length - SHOWN} more</summary>
          <ul className="admin-action-list">
            {q.items.slice(SHOWN).map((item) => (
              <Row key={item.key} item={item} />
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
