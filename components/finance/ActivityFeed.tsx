"use client";

import type { LiveIcon } from "@/lib/live-feed";
import { formatMoney } from "@/lib/format";
import { useLive } from "./LiveProvider";

/** 24px line paths, the same grid and stroke as AppIcons. */
const ICONS: Record<LiveIcon, string> = {
  paid: "M20 6 9 17l-5-5",
  invoice: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h4",
  won: "M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6l-5.4 2.9 1.2-6-4.5-4.2 6.1-.7z",
  stage: "M5 12h14M13 6l6 6-6 6",
  lost: "M18 6 6 18M6 6l12 12",
  call: "M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z",
  deal: "M12 5v14M5 12h14",
  commission: "M12 2v20M17 6.5C17 4.6 14.8 3.5 12 3.5S7 4.7 7 6.8c0 4.7 10 2.6 10 7.6 0 2.2-2.2 3.6-5 3.6s-5.2-1.2-5.2-3.4",
  statement: "M4 6h16M4 12h16M4 18h10",
};

const TIME = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
const DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
const SHORT = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" });

/** "9:42 AM" today, "Oct 14" before. Florida time, so server and browser agree. */
function when(iso: string, todayKey: string) {
  const d = new Date(iso);
  return DAY.format(d) === todayKey ? TIME.format(d) : SHORT.format(d);
}

/**
 * The right rail: the last 25 things that moved money or deals, newest
 * first. Items that arrive on a poll slide in at the top.
 */
export function ActivityFeed() {
  const { snap, arrived } = useLive();
  const todayKey = DAY.format(new Date(snap.at));
  return (
    <section className="ffeed" aria-labelledby="ffeed-title">
      <div className="ffeed-head">
        <h2 id="ffeed-title">Activity</h2>
        <span>Last {snap.events.length || 25}</span>
      </div>
      {snap.events.length === 0 ? (
        <p className="ffeed-empty">Payments, new invoices, stage moves, calls and commission will appear here as they happen.</p>
      ) : (
        <ol className="ffeed-list">
          {snap.events.map((e) => (
            <li key={e.id} className={arrived.has(e.id) ? "is-new" : undefined} data-icon={e.icon}>
              <span className="ffeed-icon" aria-hidden="true">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={ICONS[e.icon]} /></svg>
              </span>
              <span className="ffeed-text">{e.text}</span>
              {e.amountCents !== undefined && <span className="ffeed-amount">{formatMoney(e.amountCents)}</span>}
              <time dateTime={e.at}>{when(e.at, todayKey)}</time>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
