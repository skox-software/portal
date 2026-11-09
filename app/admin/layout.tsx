import { and, count, eq, isNull } from "drizzle-orm";
import Link from "next/link";
import { requireStaff } from "@/lib/access";
import { getDb } from "@/lib/db";
import { salesToday } from "@/lib/follow-up";
import { dueFollowUps } from "@/lib/follow-up-data";
import { emailThreads } from "@/lib/db/schema";
import { signOut } from "@/app/actions";
import { AdminNav } from "@/components/AdminNav";
import { MobileTabBar } from "@/components/MobileTabBar";
import { WorkspaceBreadcrumbs } from "@/components/WorkspaceBreadcrumbs";
import { Logo } from "@/components/Logo";
import "./admin.css";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { viewer, staff } = await requireStaff();
  // Conversations nobody has filed under a client yet.
  const [{ n: inboxCount }] = await getDb()
    .select({ n: count() })
    .from(emailThreads)
    .where(and(eq(emailThreads.workspaceId, staff.workspaceId), isNull(emailThreads.clientId), isNull(emailThreads.dealId), isNull(emailThreads.archivedAt)));
  // Leads and clients whose follow-up day has come.
  const dueCount = (await dueFollowUps(staff.workspaceId, salesToday())).length;
  return <div className="admin-workspace">
    <a className="admin-skip" href="#admin-content">Skip to content</a>
    <header className="workspace-header">
      <div className="shell workspace-header-top">
        <Link className="workspace-brand" href="/admin" aria-label="UnBusy workspace home"><Logo /><span>Your workspace</span></Link>
        <div className="workspace-account"><Link href="/settings">Email preferences</Link><form action={signOut}><button className="btn btn-ghost btn-small">Sign out</button></form></div>
      </div>
      <div className="shell"><AdminNav inboxCount={inboxCount} dueCount={dueCount} /></div>
    </header>
    <div className="admin-body" id="admin-content" tabIndex={-1}><WorkspaceBreadcrumbs staff />{children}</div>
    <MobileTabBar
      email={viewer.email}
      tabs={[
        { href: "/admin", label: "Overview", icon: "home", exact: true },
        { href: "/admin/leads", label: "Outreach", icon: "phone" },
        { href: "/admin/pipeline", label: "Pipeline", icon: "pipeline" },
        { href: "/admin/inbox", label: "Inbox", icon: "mail", count: inboxCount },
      ]}
      more={[
        { href: "/admin/company", label: "Company", icon: "clients" },
        { href: "/admin/clients", label: "Clients", icon: "clients", count: dueCount },
        { href: "/admin/outreach", label: "Email log", icon: "mail" },
        { href: "/admin/billing", label: "Billing", icon: "billing" },
        { href: "/admin/finance", label: "Finance", icon: "results" },
        { href: "/admin/reps", label: "Team", icon: "clients" },
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
