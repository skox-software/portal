import Link from "next/link";
import { signOut } from "@/app/actions";
import { SkoxLogo } from "@/components/SkoxLogo";
import type { Viewer } from "@/lib/access";
import { staffMembershipIn } from "@/lib/permissions";

type Section = "mission" | "pipeline" | "clients" | "inbox";

const STAFF_NAV: { key: Section; href: string; label: string }[] = [
  { key: "mission", href: "/admin", label: "Mission control" },
  { key: "pipeline", href: "/admin/pipeline", label: "Pipeline" },
  { key: "clients", href: "/admin/clients", label: "Clients" },
  { key: "inbox", href: "/admin/inbox", label: "Inbox" },
];

export function TopBar({ viewer, current }: { viewer: Viewer; current?: Section }) {
  const isStaff = Boolean(staffMembershipIn(viewer.memberships));
  return (
    <header className="topbar">
      <div className="shell topbar-inner">
        <Link href="/" className="brand" aria-label="SKOX Client Portal home">
          <SkoxLogo className="brand-logo" />
          <span className="brand-name">Client Portal</span>
        </Link>
        <nav className="topnav" aria-label="Main">
          {isStaff ? (
            STAFF_NAV.map((item) => (
              <Link key={item.key} href={item.href} aria-current={current === item.key ? "page" : undefined}>
                {item.label}
              </Link>
            ))
          ) : (
            <Link href="/">Your projects</Link>
          )}
        </nav>
        <div className="who">
          <Link href="/settings" className="who-email" title="Email preferences">
            {viewer.email}
          </Link>
          <form action={signOut}>
            <button type="submit" className="btn btn-ghost btn-small">
              Sign out
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
