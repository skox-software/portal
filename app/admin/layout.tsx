import { and, count, eq, isNull } from "drizzle-orm";
import Link from "next/link";
import { requireStaff } from "@/lib/access";
import { getDb } from "@/lib/db";
import { emailThreads, projects } from "@/lib/db/schema";
import { signOut } from "@/app/actions";
import { AdminNav } from "@/components/AdminNav";
import { MobileTabBar } from "@/components/MobileTabBar";
import { SidebarToggle } from "@/components/SidebarToggle";
import { SkoxLogo } from "@/components/SkoxLogo";
import "./admin.css";

export const metadata = { title: { default: "SKOX Admin Portal", template: "%s · SKOX Admin Portal" } };

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { viewer, staff } = await requireStaff();
  // Conversations nobody has filed under a client yet.
  const [{ n: inboxCount }] = await getDb()
    .select({ n: count() })
    .from(emailThreads)
    .where(and(eq(emailThreads.workspaceId, staff.workspaceId), isNull(emailThreads.clientId), isNull(emailThreads.dealId), isNull(emailThreads.archivedAt)));
  const clientViews = await getDb().select({ id: projects.id, name: projects.name }).from(projects).where(eq(projects.workspaceId, staff.workspaceId));
  return <div className="admin-workspace">
    <a className="admin-skip" href="#admin-content">Skip to content</a>
    <aside className="admin-sidebar" id="admin-sidebar">
      <Link className="admin-brand" href="/admin" aria-label="SKOX admin home"><SkoxLogo /><span>ADMIN PORTAL</span></Link>
      <p className="admin-nav-label">Manage your business</p><AdminNav inboxCount={inboxCount} />
      <div className="admin-sidebar-bottom"><div className="admin-team-mark" aria-hidden="true" title={viewer.email}>S</div><div><strong>SKOX team</strong><Link href="/settings">{viewer.email}</Link></div></div>
      <div className="admin-sidebar-foot"><form action={signOut}><button className="admin-signout" title="Sign out">Sign out ↗</button></form><SidebarToggle /></div>
    </aside>
    <div className="admin-body" id="admin-content"><header className="admin-toolbar"><span><i /> Admin Portal</span><div className="row"><details className="portal-switch"><summary className="btn btn-ghost btn-small">View portal ▾</summary><div><Link href="/admin">Admin Portal</Link><Link href="/sales">Employee Portal — my leads</Link><Link href="/admin/team">View an employee’s pipeline</Link>{clientViews.map(p => <Link key={p.id} href={`/projects/${p.id}`}>Client Portal — {p.name}</Link>)}</div></details><Link href="/admin/onboard" className="btn btn-primary btn-small">+ New client</Link></div></header>{children}</div>
    <MobileTabBar
      email={viewer.email}
      tabs={[
        { href: "/admin", label: "Overview", icon: "home", exact: true },
        { href: "/admin/pipeline", label: "Pipeline", icon: "pipeline" },
        { href: "/admin/clients", label: "Clients", icon: "clients" },
        { href: "/admin/inbox", label: "Inbox", icon: "mail", count: inboxCount },
      ]}
      more={[
        { href: "/admin/team", label: "People & access", icon: "clients" },
        { href: "/sales", label: "Employee Portal", icon: "pipeline" },
        { href: "/admin/billing", label: "Billing", icon: "billing" },
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
