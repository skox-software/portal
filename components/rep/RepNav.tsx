"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/rep", label: "Desk" },
  { href: "/rep/leads", label: "Leads" },
  { href: "/rep/earnings", label: "Earnings" },
  { href: "/rep/settings", label: "Account" },
];

function active(href: string, path: string) {
  if (href === "/rep") return path === "/rep";
  if (href === "/rep/leads") return path === "/rep/leads" || (path.startsWith("/rep/leads/") && path !== "/rep/leads/new");
  return path === href || path.startsWith(`${href}/`);
}

export function RepNav() {
  const path = usePathname();
  return (
    <nav className="rp-nav" aria-label="Partner desk">
      {ITEMS.map((i) => (
        <Link key={i.href} href={i.href} aria-current={active(i.href, path) ? "page" : undefined}>
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
