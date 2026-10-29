import Link from "next/link";
import { MobileTabBar, type TabItem } from "@/components/MobileTabBar";
import { Notice } from "@/components/Notice";
import { ProjectNav, type ProjectTab } from "@/components/ProjectNav";
import { TopBar } from "@/components/TopBar";
import { kindLabel, STATUS_LABEL } from "@/lib/format";
import { can } from "@/lib/permissions";
import type { ProjectShell } from "@/lib/project-shell";

export function ProjectHeader({
  shell,
  tab,
  title,
  intro,
  error,
  notice,
}: {
  shell: ProjectShell;
  tab: ProjectTab;
  title?: string;
  intro?: string;
  error?: string;
  notice?: string;
}) {
  const { viewer, project, client, access, counts } = shell;
  const base = `/projects/${project.id}`;
  const item = (key: ProjectTab, label: string, path: string, icon: TabItem["icon"]): TabItem => ({
    href: `${base}${path}`,
    label,
    icon,
    count: counts[key] ?? 0,
    active: tab === key,
  });
  return (
    <>
      <TopBar viewer={viewer} />
      <div className="project-band">
        <div className="shell">
          <div className="page-head page-head-tight">
            <div>
              <p className="eyebrow">
                {client.name} · {kindLabel(project.kind)}
              </p>
              <h1>{title ?? project.name}</h1>
              {intro && <p className="page-intro">{intro}</p>}
            </div>
            <div className="row">
              <span className={project.status === "launched" ? "chip chip-ok" : "chip chip-amber"}>
                {STATUS_LABEL[project.status]}
              </span>
              {can.manageProject(access) && (
                <Link className="btn btn-ghost btn-small" href={`/admin/projects/${project.id}`}>
                  Manage project
                </Link>
              )}
            </div>
          </div>
          <ProjectNav projectId={project.id} active={tab} counts={counts} />
        </div>
      </div>
      {access.isStaff && (
        <div className="shell">
          <p className="staff-banner">
            You&apos;re viewing this as UnBusy. Controls marked <span className="chip chip-skox">UnBusy only</span> are
            hidden from the client.
          </p>
        </div>
      )}
      <div className="shell">
        <Notice error={error} notice={notice} />
      </div>
      <MobileTabBar
        email={viewer.email}
        tabs={[
          item("home", "Overview", "", "home"),
          item("review", "Review", "/review", "review"),
          item("billing", "Billing", "/billing", "billing"),
          item("support", "Requests", "/support", "requests"),
        ]}
        more={[
          item("meetings", "Meetings", "/meetings", "meetings"),
          item("documents", "Documents", "/documents", "documents"),
          item("files", "Files", "/files", "files"),
          item("results", "Results", "/results", "results"),
          { href: "/", label: access.isStaff ? "Admin" : "All projects", icon: "projects", active: false },
          { href: "/settings", label: "Email preferences", icon: "mail", active: false },
        ]}
      />
    </>
  );
}
