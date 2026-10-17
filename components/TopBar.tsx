import Link from "next/link";
import { signOut } from "@/app/actions";
import { SkoxLogo } from "@/components/SkoxLogo";
import type { Viewer } from "@/lib/access";
import { staffMembershipIn } from "@/lib/permissions";

export function TopBar({ viewer, portal }: { viewer: Viewer; portal?: string }) {
  const team = staffMembershipIn(viewer.memberships);
  const isStaff = team?.role === "staff_owner";
  const title = portal ?? (isStaff ? "Admin Portal" : team ? "Employee Portal" : "Client Portal");
  return (
    <header className="topbar">
      <div className="shell topbar-inner">
        <Link href="/" className="brand" aria-label={`SKOX ${title} home`}>
          <SkoxLogo className="brand-logo" />
          <span className="brand-name">{title}</span>
        </Link>
        <nav className="topnav" aria-label="Main">
          {isStaff ? <Link href="/admin">Admin overview</Link> : team ? <Link href="/sales">Sales pipeline</Link> : <Link href="/">Your projects</Link>}
          {isStaff && <Link href="/admin/billing">Billing</Link>}
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
