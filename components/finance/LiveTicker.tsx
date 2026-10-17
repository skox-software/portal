"use client";

import { useSyncExternalStore } from "react";
import { formatMoney } from "@/lib/format";
import { useLive } from "./LiveProvider";
import { Odometer } from "./Odometer";

/**
 * The strip across the top of Finance: the money figures that move during
 * the day, rolling to new values as the poll brings them, with a short amber
 * flash when anything changed. Wraps onto two lines on a phone.
 */
export function LiveTicker({ wall = false }: { wall?: boolean }) {
  const { snap, status, flash } = useLive();
  const balanceLabel = snap.balanceSource === "payments" ? "Payments balance" : "Business account";
  return (
    <div className={`fticker${wall ? " fticker-wall" : ""}`} data-status={status}>
      {flash > 0 && <span key={flash} className="fticker-flash" aria-hidden="true" />}
      <dl className="fticker-items">
        <div>
          <dt>{balanceLabel}</dt>
          <dd>{snap.balanceCents === null ? <span title="Stripe is unavailable">—</span> : <Odometer text={formatMoney(snap.balanceCents)} />}</dd>
        </div>
        <div>
          <dt>Collected this month</dt>
          <dd><Odometer text={formatMoney(snap.collectedMonthCents)} /></dd>
        </div>
        <div>
          <dt>Pipeline, weighted</dt>
          <dd><Odometer text={formatMoney(snap.openPipelineCents)} /></dd>
        </div>
        <div>
          <dt>Invoices due today</dt>
          <dd><Odometer text={String(snap.dueTodayCount)} /></dd>
        </div>
      </dl>
      <div className="fticker-meta">
        <span className="fticker-state"><i aria-hidden="true" />{status === "live" ? "live" : status === "reconnecting" ? "reconnecting" : "paused"} · <Ago at={snap.at} /></span>
        {!wall && <SoundToggle />}
      </div>
    </div>
  );
}

// One shared one-second clock for every "updated 12s ago" on the page.
const subscribeClock = (onTick: () => void) => {
  const id = window.setInterval(onTick, 1000);
  return () => window.clearInterval(id);
};
const readClock = () => Math.floor(Date.now() / 1000);

function Ago({ at }: { at: string }) {
  const now = useSyncExternalStore(subscribeClock, readClock, () => null);
  if (now === null) return <span>updated just now</span>;
  const s = Math.max(0, now - Math.floor(Date.parse(at) / 1000));
  return <span className="fticker-ago">updated {s < 5 ? "just now" : s < 60 ? `${s}s ago` : `${Math.floor(s / 60)}m ago`}</span>;
}

export function SoundToggle() {
  const { sound, setSound } = useLive();
  return (
    <button type="button" className="fsound" aria-pressed={sound} onClick={() => setSound(!sound)} title={sound ? "Turn the payment chime off" : "Play a chime when a payment lands"}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M11 5 6 9H3v6h3l5 4z" />
        {sound ? <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" /> : <path d="m16 9 5 6M21 9l-5 6" />}
      </svg>
      <span>Sound {sound ? "on" : "off"}</span>
    </button>
  );
}
