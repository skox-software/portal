"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

const ROTATE_MS = 20_000;
const REFRESH_MS = 60_000;

/**
 * Shows one wall panel at a time, moving on every 20 seconds, and re-renders
 * the server data every minute. All panels stay mounted in one grid cell, so
 * switching is a crossfade with no reflow. Arrow keys step, space pauses.
 */
export function WallRotator({ panels }: { panels: { key: string; title: string; node: ReactNode }[] }) {
  const router = useRouter();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  // Bumped on every step so the progress bar restarts.
  const [turn, setTurn] = useState(0);
  const go = (to: number) => {
    setIndex((to + panels.length) % panels.length);
    setTurn((t) => t + 1);
  };

  useEffect(() => {
    if (paused) return;
    const id = window.setInterval(() => {
      if (document.hidden) return;
      setIndex((i) => (i + 1) % panels.length);
      setTurn((t) => t + 1);
    }, ROTATE_MS);
    return () => window.clearInterval(id);
  }, [paused, panels.length, turn]);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (!document.hidden) router.refresh();
    }, REFRESH_MS);
    return () => window.clearInterval(id);
  }, [router]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight") go(index + 1);
      else if (e.key === "ArrowLeft") go(index - 1);
      else if (e.key === " ") {
        e.preventDefault();
        setPaused((p) => !p);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="fwall-rotator">
      <nav className="fwall-tabs" aria-label="Wall panels">
        {panels.map((p, i) => (
          <button key={p.key} type="button" aria-current={i === index ? "true" : undefined} onClick={() => go(i)}>
            {p.title}
          </button>
        ))}
        <button type="button" className="fwall-pause" aria-pressed={paused} onClick={() => setPaused((p) => !p)}>
          {paused ? "Resume" : "Pause"}
        </button>
      </nav>
      <div className="fwall-progress" aria-hidden="true">
        {!paused && <span key={turn} style={{ animationDuration: `${ROTATE_MS}ms` }} />}
      </div>
      <div className="fwall-stage">
        {panels.map((p, i) => (
          <div key={p.key} className="fwall-slide" data-active={i === index ? "" : undefined} aria-hidden={i !== index} inert={i !== index}>
            {p.node}
          </div>
        ))}
      </div>
    </div>
  );
}
