"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  ["/admin", "Overview", "◈"],
  ["/admin/pipeline", "Pipeline", "⇉"],
  ["/admin/clients", "Clients", "◎"],
  ["/admin/inbox", "Inbox", "✉"],
  ["/admin/projects", "Projects", "▦"],
  ["/admin/billing", "Billing", "$"],
  ["/admin/finance", "Finance", "◔"],
  ["/admin/reps", "Team", "☍"],
  ["/admin/commissions", "Commissions", "%"],
  ["/admin/requests", "Requests", "↗"],
  ["/admin/activity", "Activity", "◷"],
  ["/admin/settings", "Settings", "⚙"],
];

export function AdminNav({ inboxCount = 0, dueCount = 0 }: { inboxCount?: number; dueCount?: number }) {
  const pathname = usePathname();
  return <nav className="admin-nav" aria-label="Admin navigation">{items.map(([href, title, icon]) => {
    const active = href === "/admin" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
    return <Link key={href} href={href} title={title} aria-current={active ? "page" : undefined}><span aria-hidden="true">{icon}</span><span className="admin-nav-text">{title}</span>{href === "/admin/inbox" && inboxCount > 0 && <span className="admin-nav-count" aria-label={`${inboxCount} need a client`}>{inboxCount}</span>}{href === "/admin/clients" && dueCount > 0 && <span className="admin-nav-count" aria-label={`${dueCount} follow-up${dueCount === 1 ? "" : "s"} due`} title={`${dueCount} follow-up${dueCount === 1 ? "" : "s"} due today`}>{dueCount}</span>}</Link>;
  })}</nav>;
}
