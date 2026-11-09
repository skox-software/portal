"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { ADMIN_GROUPS, activeNavigation } from "@/lib/workspace-navigation";

export function AdminNav({ inboxCount = 0, dueCount = 0 }: { inboxCount?: number; dueCount?: number }) {
  const pathname = usePathname();
  const nav = useRef<HTMLElement>(null);
  useEffect(() => {
    nav.current?.querySelectorAll("details[open]").forEach(item => item.removeAttribute("open"));
  }, [pathname]);
  useEffect(() => {
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !nav.current?.contains(event.target)) nav.current?.querySelectorAll("details[open]").forEach(item => item.removeAttribute("open"));
    }
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);
  return <nav ref={nav} className="admin-topnav" aria-label="Admin navigation" onKeyDown={event => {
    if (event.key === "Escape") {
      const opened = nav.current?.querySelector<HTMLDetailsElement>("details[open]");
      opened?.removeAttribute("open");
      opened?.querySelector("summary")?.focus();
    }
  }}>
    <Link href="/admin" aria-current={pathname === "/admin" ? "page" : undefined}>Overview</Link>
    <Link href="/admin/control-center" aria-current={pathname.startsWith("/admin/control-center") ? "page" : undefined}>Control Center</Link>
    <Link href="/admin/work" aria-current={pathname.startsWith("/admin/work") ? "page" : undefined}>Our work</Link>
    {ADMIN_GROUPS.map(group => <details key={group.label} data-active={group.links.some(link => activeNavigation(link.href, pathname)) || undefined} onToggle={event => {
      if (event.currentTarget.open) nav.current?.querySelectorAll("details[open]").forEach(item => { if (item !== event.currentTarget) item.removeAttribute("open"); });
    }}>
      <summary>{group.label}<span aria-hidden="true">⌄</span>{group.label === "Relationships" && inboxCount + dueCount > 0 && <span className="workspace-count" aria-label={`${inboxCount + dueCount} items need attention`}>{inboxCount + dueCount}</span>}</summary>
      <div className="admin-topnav-menu">{group.links.map(link => {
        const count = link.href === "/admin/inbox" ? inboxCount : link.href === "/admin/clients" ? dueCount : 0;
        return <Link key={link.href} href={link.href} aria-current={activeNavigation(link.href, pathname) ? "page" : undefined} onClick={event => event.currentTarget.closest("details")?.removeAttribute("open")}>{link.label}{count > 0 && <span className="workspace-count" aria-label={`${count} ${link.href === "/admin/inbox" ? "need a client" : "follow-ups due"}`}>{count}</span>}</Link>;
      })}</div>
    </details>)}
  </nav>;
}
