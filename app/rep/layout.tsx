import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { signOut } from "@/app/actions";
import { MobileTabBar } from "@/components/MobileTabBar";
import { Logo } from "@/components/Logo";
import { RepNav } from "@/components/rep/RepNav";
import { requireRep } from "@/lib/access";
import { getDb } from "@/lib/db";
import { repProfiles } from "@/lib/db/schema";
import "./rep.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: { default: "Sales Rep Desk", template: "%s · UnBusy Sales Rep Desk" } };

/**
 * The sales rep's desk. A world of its own: separate from /admin and from
 * client projects, with its own look. Reps see their leads and their money,
 * never how UnBusy builds.
 */
export default async function RepLayout({ children }: { children: React.ReactNode }) {
  const { viewer, rep } = await requireRep();
  const [profile] = await getDb()
    .select({ name: repProfiles.displayName, status: repProfiles.status })
    .from(repProfiles)
    .where(eq(repProfiles.membershipId, rep.id))
    .limit(1);
  const name = profile?.name ?? viewer.email;
  return (
    <div className="rp">
      <a className="rp-skip" href="#rp-main">Skip to content</a>
      <header className="rp-bar">
        <Link className="rp-brand" href="/rep" aria-label="UnBusy Sales Rep Desk home">
          <Logo variant="dark" />
          <span>Sales rep</span>
        </Link>
        <RepNav />
        {profile?.status === "paused" && <span className="rp-paused">Paused</span>}
        <Link href="/rep/leads/new" className="rp-cta">+ Add a lead</Link>
        <Link href="/rep/settings" className="rp-me" title={viewer.email}>
          <i>{name.slice(0, 1).toUpperCase()}</i>
          <span>{name.split(" ")[0]}</span>
        </Link>
        <form action={signOut}>
          <button className="rp-signout" type="submit">Sign out</button>
        </form>
      </header>
      <main className="rp-main" id="rp-main">{children}</main>
      <MobileTabBar
        email={viewer.email}
        tabs={[
          { href: "/rep", label: "Desk", icon: "home", exact: true },
          { href: "/rep/leads", label: "Leads", icon: "leads", exact: true },
          { href: "/rep/leads/new", label: "Add lead", icon: "plus" },
          { href: "/rep/earnings", label: "Earnings", icon: "earnings" },
        ]}
        more={[{ href: "/rep/settings", label: "Account", icon: "settings" }]}
      />
    </div>
  );
}
