"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

const typing = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));

/**
 * Keyboard for the lead panel: J / K next and previous, Esc closes,
 * C calls, E opens the email draft, W opens the website, 1–8 press the call outcome buttons.
 * Keys are ignored while typing in a field.
 */
export function PanelKeys({
  leadKey,
  closeHref,
  nextHref,
  prevHref,
}: {
  leadKey: string;
  closeHref: string;
  nextHref: string | null;
  prevHref: string | null;
}) {
  const router = useRouter();
  // A new lead starts at the top of the panel, not where the last one was scrolled.
  useEffect(() => {
    document.querySelector("[data-lead-panel]")?.closest(".crm-split-panel, .pipeline-drawer")?.scrollTo({ top: 0 });
  }, [leadKey]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape") {
        if (typing(e.target)) (e.target as HTMLElement).blur();
        else router.push(closeHref, { scroll: false });
        return;
      }
      if (typing(e.target)) return;
      const panel = document.querySelector<HTMLElement>("[data-lead-panel]");
      const click = (sel: string) => panel?.querySelector<HTMLElement>(sel)?.click();
      switch (e.key) {
        case "j":
          if (nextHref) {
            e.preventDefault();
            router.push(nextHref, { scroll: false });
          }
          break;
        case "k":
          if (prevHref) {
            e.preventDefault();
            router.push(prevHref, { scroll: false });
          }
          break;
        case "c":
          click('a[data-reach="call"]');
          break;
        case "e":
          click('[data-reach="email"]');
          break;
        case "w":
          click('a[data-reach="site"]');
          break;
        default:
          if (/^[1-8]$/.test(e.key)) {
            const button = panel?.querySelector<HTMLButtonElement>(`button[data-shortcut="${e.key}"]`);
            if (button && !button.disabled) {
              e.preventDefault();
              button.click();
            }
          }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeHref, nextHref, prevHref, router]);
  return null;
}
