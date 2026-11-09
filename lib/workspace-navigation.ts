export const ADMIN_GROUPS = [
  { label: "Relationships", links: [
    { href: "/admin/leads", label: "Outreach" },
    { href: "/admin/pipeline", label: "Pipeline" },
    { href: "/admin/clients", label: "Clients" },
    { href: "/admin/inbox", label: "Inbox" },
    { href: "/admin/outreach", label: "Email log" },
  ] },
  { label: "Projects", links: [
    { href: "/admin/projects", label: "All projects" },
    { href: "/admin/requests", label: "Requests" },
    { href: "/admin/onboard", label: "New client" },
  ] },
  { label: "Money", links: [
    { href: "/admin/billing", label: "Billing" },
    { href: "/admin/finance", label: "Finance" },
    { href: "/admin/commissions", label: "Commissions" },
  ] },
  { label: "Team & settings", links: [
    { href: "/admin/company", label: "Company" },
    { href: "/admin/reps", label: "Team" },
    { href: "/admin/activity", label: "Activity" },
    { href: "/admin/settings", label: "Workspace settings" },
    { href: "/settings", label: "Email preferences" },
  ] },
];
export function activeNavigation(href: string, pathname: string) {
  return href === "/admin" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}
export function workspaceLocation(pathname: string, staff: boolean) {
  const parts = pathname.split("/").filter(Boolean);
  const home = staff ? "/admin" : "/";
  if (pathname === home) return { title: staff ? "Overview" : "Your projects", back: null };
  if (parts[0] === "projects" && parts[1]) {
    const base = `/projects/${parts[1]}`;
    if (parts[2] === "documents" && parts[3]) return { title: "Document", back: { href: `${base}/documents`, label: "Back to documents" } };
    const names: Record<string, string> = { review: "Review", meetings: "Meetings", files: "Files", documents: "Documents", billing: "Billing", support: "Requests", results: "Results", welcome: "Welcome" };
    return { title: names[parts[2]] ?? "Project overview", back: { href: parts[2] ? base : home, label: parts[2] ? "Back to project" : staff ? "Back to overview" : "Back to your projects" } };
  }
  const links = ADMIN_GROUPS.flatMap(group => group.links);
  const section = links.find(link => link.href === `/${parts.slice(0, 2).join("/")}`);
  if (parts[0] === "admin" && parts.length > 2) {
    const parent = `/${parts.slice(0, -1).join("/")}`;
    return { title: parts.length > 3 ? "Project details" : `${section?.label ?? "Workspace"} details`, back: { href: parent, label: `Back to ${parts.length > 3 ? "project" : section?.label.toLowerCase() ?? "overview"}` } };
  }
  return { title: links.find(link => link.href === pathname)?.label ?? "Workspace", back: { href: home, label: staff ? "Back to overview" : "Back to your projects" } };
}
