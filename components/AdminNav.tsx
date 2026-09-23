"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  ["/admin", "Overview", "◈"],
  ["/admin/pipeline", "Pipeline", "⇉"],
  ["/admin/clients", "Clients", "◎"],
  ["/admin/projects", "Projects", "▦"],
  ["/admin/billing", "Billing", "$"],
  ["/admin/requests", "Requests", "↗"],
  ["/admin/activity", "Activity", "◷"],
  ["/admin/settings", "Settings", "⚙"],
];

export function AdminNav() {
  const pathname = usePathname();
  return <nav className="admin-nav" aria-label="Admin navigation">{items.map(([href, title, icon]) => {
    const active = href === "/admin" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
    return <Link key={href} href={href} title={title} aria-current={active ? "page" : undefined}><span aria-hidden="true">{icon}</span><span className="admin-nav-text">{title}</span></Link>;
  })}</nav>;
}
