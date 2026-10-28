"use client";

import { useEffect, useRef } from "react";

/**
 * A 1.5-second burst of paper when a payment lands. One canvas over the
 * page, no pointer events, at most 150 pieces; nothing at all for anyone
 * who prefers reduced motion. `fire` is a counter: each bump is one burst.
 */

const COUNT = 140;
const DURATION_MS = 1500;

export function Confetti({ fire }: { fire: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvas.current;
    if (!fire || !el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const g = el.getContext("2d");
    if (!g) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    el.width = w * dpr;
    el.height = h * dpr;
    g.scale(dpr, dpr);

    const scope = el.closest("[data-theme]") ?? document.documentElement;
    const css = getComputedStyle(scope);
    const colors = ["--accent", "--accent", "--ok", "--ink"].map((v) => css.getPropertyValue(v).trim() || "#0b5cff");
    // Thrown up and out from the top third of the screen, then falling.
    const pieces = Array.from({ length: COUNT }, () => {
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.9;
      const speed = 7 + Math.random() * 9;
      return {
        x: w / 2 + (Math.random() - 0.5) * w * 0.25,
        y: h * 0.28,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 5 + Math.random() * 5,
        spin: Math.random() * Math.PI,
        vspin: (Math.random() - 0.5) * 0.4,
        color: colors[Math.floor(Math.random() * colors.length)],
      };
    });

    let frame = 0;
    const start = performance.now();
    const step = (now: number) => {
      const t = now - start;
      g.clearRect(0, 0, w, h);
      if (t >= DURATION_MS) return;
      const fade = t > DURATION_MS - 400 ? (DURATION_MS - t) / 400 : 1;
      for (const p of pieces) {
        p.vy += 0.32;
        p.vx *= 0.985;
        p.x += p.vx;
        p.y += p.vy;
        p.spin += p.vspin;
        g.save();
        g.globalAlpha = fade;
        g.translate(p.x, p.y);
        g.rotate(p.spin);
        g.fillStyle = p.color;
        g.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        g.restore();
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
      g.clearRect(0, 0, w, h);
    };
  }, [fire]);

  return <canvas ref={canvas} className="fconfetti" aria-hidden="true" />;
}
