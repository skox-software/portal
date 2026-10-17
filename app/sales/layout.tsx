import Link from "next/link";
import { signOut } from "@/app/actions";
import { requireSalesTeam } from "@/lib/sales-access";
import { SkoxLogo } from "@/components/SkoxLogo";
import { SidebarToggle } from "@/components/SidebarToggle";
import "../admin/admin.css";
import "./sales.css";
export const dynamic = "force-dynamic";
export const metadata = { title: { default: "SKOX Employee Portal", template: "%s · SKOX Employee Portal" } };
export default async function SalesLayout({ children }: { children: React.ReactNode }) {
  const { viewer, member } = await requireSalesTeam();
  return <div className="admin-workspace"><a className="admin-skip" href="#sales-content">Skip to content</a><aside className="admin-sidebar"><Link className="admin-brand" href="/sales" aria-label="SKOX Employee Portal home"><SkoxLogo /><span>EMPLOYEE PORTAL</span></Link><p className="admin-nav-label">Your sales workspace</p><nav className="admin-nav" aria-label="Employee navigation"><Link href="/sales" aria-current="page"><span>⇉</span><span className="admin-nav-text">My pipeline</span></Link>{member.role === "staff_owner" && <><Link href="/admin"><span>◈</span><span className="admin-nav-text">Admin Portal</span></Link><Link href="/admin/team"><span>◎</span><span className="admin-nav-text">People & access</span></Link></>}</nav><div className="admin-sidebar-bottom"><div className="admin-team-mark">S</div><div><strong>{member.role === "staff_owner" ? "Admin viewing sales" : "Sales team"}</strong><Link href="/settings">{viewer.email}</Link></div></div><div className="admin-sidebar-foot"><form action={signOut}><button className="admin-signout">Sign out ↗</button></form><SidebarToggle /></div></aside><div className="admin-body" id="sales-content"><header className="admin-toolbar"><span><i /> Employee Portal</span>{member.role === "staff_owner" && <Link href="/admin/team" className="btn btn-small">Switch employee</Link>}</header>{children}</div></div>;
}
