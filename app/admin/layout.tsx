import Link from "next/link";
import { requireStaff } from "@/lib/access";
import { signOut } from "@/app/actions";
import { AdminNav } from "@/components/AdminNav";
import { SkoxLogo } from "@/components/SkoxLogo";
import "./admin.css";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { viewer } = await requireStaff();
  return <div className="admin-workspace">
    <a className="admin-skip" href="#admin-content">Skip to content</a>
    <aside className="admin-sidebar">
      <Link className="admin-brand" href="/admin" aria-label="SKOX admin home"><SkoxLogo /><span>WORKSPACE</span></Link>
      <p className="admin-nav-label">Manage your business</p><AdminNav />
      <div className="admin-sidebar-bottom"><div className="admin-team-mark" aria-hidden="true">S</div><div><strong>SKOX team</strong><Link href="/settings">{viewer.email}</Link></div></div>
      <form action={signOut}><button className="admin-signout">Sign out ↗</button></form>
    </aside>
    <div className="admin-body" id="admin-content"><header className="admin-toolbar"><span><i /> Team workspace</span><Link href="/admin/onboard" className="btn btn-primary btn-small">+ New client</Link></header>{children}</div>
  </div>;
}
