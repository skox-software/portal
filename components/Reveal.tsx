"use client";

import { useEffect, useRef } from "react";

/**
 * Eases content in as it scrolls into view. Content is fully visible without
 * JavaScript and for anyone who prefers reduced motion; the effect is only
 * armed once the browser can run it.
 */
export function Reveal({
  children,
  delay = 0,
  as: Tag = "div",
  className,
}: {
  children: React.ReactNode;
  delay?: number;
  as?: "div" | "section" | "li";
  className?: string;
}) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    el.dataset.reveal = "armed";
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            el.dataset.reveal = "in";
            io.disconnect();
          }
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.12 },
    );
    io.observe(el);
    // Never leave content hidden if the observer doesn't fire (embedded browsers, print previews).
    const fallback = window.setTimeout(() => {
      el.dataset.reveal = "in";
      io.disconnect();
    }, 1600);
    return () => {
      io.disconnect();
      window.clearTimeout(fallback);
    };
  }, []);

  return (
    <Tag
      ref={ref as React.Ref<never>}
      className={className ? `reveal ${className}` : "reveal"}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </Tag>
  );
}
