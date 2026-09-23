import Link from "next/link";
import { requireStaff } from "@/lib/access";
import { signOut } from "@/app/actions";
import { AdminNav } from "@/components/AdminNav";
import { SidebarToggle } from "@/components/SidebarToggle";
import { SkoxLogo } from "@/components/SkoxLogo";
import "./admin.css";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { viewer } = await requireStaff();
  return <div className="admin-workspace">
    <a className="admin-skip" href="#admin-content">Skip to content</a>
    <aside className="admin-sidebar" id="admin-sidebar">
      <Link className="admin-brand" href="/admin" aria-label="SKOX admin home"><SkoxLogo /><span>WORKSPACE</span></Link>
      <p className="admin-nav-label">Manage your business</p><AdminNav />
      <div className="admin-sidebar-bottom"><div className="admin-team-mark" aria-hidden="true" title={viewer.email}>S</div><div><strong>SKOX team</strong><Link href="/settings">{viewer.email}</Link></div></div>
      <div className="admin-sidebar-foot"><form action={signOut}><button className="admin-signout" title="Sign out">Sign out ↗</button></form><SidebarToggle /></div>
    </aside>
    <div className="admin-body" id="admin-content"><header className="admin-toolbar"><span><i /> Team workspace</span><Link href="/admin/onboard" className="btn btn-primary btn-small">+ New client</Link></header>{children}</div>
  </div>;
}
