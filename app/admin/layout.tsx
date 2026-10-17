import { and, count, eq, isNull } from "drizzle-orm";
import Link from "next/link";
import { requireStaff } from "@/lib/access";
import { getDb } from "@/lib/db";
import { emailThreads } from "@/lib/db/schema";
import { signOut } from "@/app/actions";
import { AdminNav } from "@/components/AdminNav";
import { MobileTabBar } from "@/components/MobileTabBar";
import { SidebarToggle } from "@/components/SidebarToggle";
import { SkoxLogo } from "@/components/SkoxLogo";
import "./admin.css";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { viewer, staff } = await requireStaff();
  // Conversations nobody has filed under a client yet.
  const [{ n: inboxCount }] = await getDb()
    .select({ n: count() })
    .from(emailThreads)
    .where(and(eq(emailThreads.workspaceId, staff.workspaceId), isNull(emailThreads.clientId), isNull(emailThreads.dealId), isNull(emailThreads.archivedAt)));
  return <div className="admin-workspace">
    <a className="admin-skip" href="#admin-content">Skip to content</a>
    <aside className="admin-sidebar" id="admin-sidebar">
      <Link className="admin-brand" href="/admin" aria-label="SKOX admin home"><SkoxLogo /><span>WORKSPACE</span></Link>
      <p className="admin-nav-label">Manage your business</p><AdminNav inboxCount={inboxCount} />
      <div className="admin-sidebar-bottom"><div className="admin-team-mark" aria-hidden="true" title={viewer.email}>S</div><div><strong>SKOX team</strong><Link href="/settings">{viewer.email}</Link></div></div>
      <div className="admin-sidebar-foot"><form action={signOut}><button className="admin-signout" title="Sign out">Sign out ↗</button></form><SidebarToggle /></div>
    </aside>
    <div className="admin-body" id="admin-content"><header className="admin-toolbar"><span><i /> Team workspace</span><Link href="/admin/onboard" className="btn btn-primary btn-small">+ New client</Link></header>{children}</div>
    <MobileTabBar
      email={viewer.email}
      tabs={[
        { href: "/admin", label: "Overview", icon: "home", exact: true },
        { href: "/admin/pipeline", label: "Pipeline", icon: "pipeline" },
        { href: "/admin/clients", label: "Clients", icon: "clients" },
        { href: "/admin/inbox", label: "Inbox", icon: "mail", count: inboxCount },
      ]}
      more={[
        { href: "/admin/billing", label: "Billing", icon: "billing" },
        { href: "/admin/reps", label: "Sales reps", icon: "clients" },
        { href: "/admin/commissions", label: "Commissions", icon: "earnings" },
        { href: "/admin/onboard", label: "New client", icon: "plus" },
        { href: "/admin/projects", label: "Projects", icon: "projects" },
        { href: "/admin/requests", label: "Requests", icon: "requests" },
        { href: "/admin/activity", label: "Activity", icon: "activity" },
        { href: "/admin/settings", label: "Workspace settings", icon: "settings" },
        { href: "/settings", label: "Email preferences", icon: "mail" },
      ]}
    />
  </div>;
}
