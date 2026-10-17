"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { LiveSnapshot } from "@/lib/finance-live";
import { newEvents } from "@/lib/live-feed";
import { withBase } from "@/lib/paths";
import { Confetti } from "./Confetti";
import { playChime, primeChime } from "./chime";

/**
 * One poll of /api/finance/live shared by the ticker and the activity feed.
 * Polls every 30 seconds while the tab is visible, and once straight away
 * when it comes back. When a payment lands that wasn't there on the last
 * poll (never on first load), it fires the confetti and, if sound is on,
 * the chime.
 */

export const POLL_MS = 30_000;
const SOUND_KEY = "skox.finance.sound";

type Status = "live" | "reconnecting" | "signed-out";

type LiveState = {
  snap: LiveSnapshot;
  status: Status;
  /** Ids that arrived on the latest poll, to slide in. */
  arrived: ReadonlySet<string>;
  /** Bumps when any ticker figure changes, to replay the flash. */
  flash: number;
  sound: boolean;
  setSound: (on: boolean) => void;
};

const Live = createContext<LiveState | null>(null);

export function useLive() {
  const value = useContext(Live);
  if (!value) throw new Error("useLive must be used inside <LiveProvider>");
  return value;
}

const subscribeSound = (onChange: () => void) => {
  window.addEventListener("storage", onChange);
  window.addEventListener(SOUND_KEY, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(SOUND_KEY, onChange);
  };
};
const readSound = () => {
  try {
    return localStorage.getItem(SOUND_KEY) === "on";
  } catch {
    return false;
  }
};

const figures = (s: LiveSnapshot) => [s.balanceCents, s.collectedMonthCents, s.openPipelineCents, s.dueTodayCount].join("|");

export function LiveProvider({ initial, children }: { initial: LiveSnapshot; children: ReactNode }) {
  const [snap, setSnap] = useState(initial);
  const [status, setStatus] = useState<Status>("live");
  const [arrived, setArrived] = useState<ReadonlySet<string>>(new Set());
  const [flash, setFlash] = useState(0);
  const [burst, setBurst] = useState(0);
  const sound = useSyncExternalStore(subscribeSound, readSound, () => false);
  const last = useRef(initial);
  const soundRef = useRef(sound);
  useEffect(() => {
    soundRef.current = sound;
  }, [sound]);

  function apply(next: LiveSnapshot) {
    const prev = last.current;
    last.current = next;
    const added = newEvents(prev.events, next.events);
    setSnap(next);
    setArrived(new Set(added.map((e) => e.id)));
    if (figures(prev) !== figures(next)) setFlash((n) => n + 1);
    if (added.some((e) => e.verb === "invoice.paid")) {
      setBurst((n) => n + 1);
      if (soundRef.current) playChime();
    }
  }

  useEffect(() => {
    let stopped = false;
    let busy = false;

    async function poll() {
      if (busy || stopped || document.hidden) return;
      busy = true;
      try {
        const res = await fetch(withBase("/api/finance/live"), { cache: "no-store", headers: { accept: "application/json" } });
        if (res.status === 401 || res.status === 404) {
          stopped = true;
          setStatus("signed-out");
          return;
        }
        if (!res.ok) throw new Error(String(res.status));
        apply((await res.json()) as LiveSnapshot);
        setStatus("live");
      } catch {
        setStatus("reconnecting");
      } finally {
        busy = false;
      }
    }

    function onVisible() {
      if (!document.hidden && Date.now() - Date.parse(last.current.at) >= POLL_MS) void poll();
    }

    const timer = window.setInterval(poll, POLL_MS);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const setSound = useCallback((on: boolean) => {
    // Browsers only allow audio after a gesture: this click is it.
    if (on) primeChime();
    try {
      localStorage.setItem(SOUND_KEY, on ? "on" : "off");
    } catch {}
    window.dispatchEvent(new Event(SOUND_KEY));
  }, []);

  return (
    <Live.Provider value={{ snap, status, arrived, flash, sound, setSound }}>
      {children}
      <Confetti fire={burst} />
    </Live.Provider>
  );
}
