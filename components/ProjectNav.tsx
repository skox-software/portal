import Link from "next/link";

export type ProjectTab = "home" | "review" | "documents" | "files" | "billing" | "support" | "results";

const TABS: { key: ProjectTab; label: string; path: string }[] = [
  { key: "home", label: "Overview", path: "" },
  { key: "review", label: "Review", path: "/review" },
  { key: "documents", label: "Documents", path: "/documents" },
  { key: "files", label: "Files", path: "/files" },
  { key: "billing", label: "Billing", path: "/billing" },
  { key: "support", label: "Requests", path: "/support" },
  { key: "results", label: "Results", path: "/results" },
];

/** Tabs across every project page. Counts show what needs the client. */
export function ProjectNav({
  projectId,
  active,
  counts = {},
}: {
  projectId: string;
  active: ProjectTab;
  counts?: Partial<Record<ProjectTab, number>>;
}) {
  return (
    <nav className="project-nav" aria-label="Project sections">
      {TABS.map((t) => {
        const n = counts[t.key] ?? 0;
        return (
          <Link
            key={t.key}
            href={`/projects/${projectId}${t.path}`}
            aria-current={active === t.key ? "page" : undefined}
          >
            {t.label}
            {n > 0 && (
              <span className="nav-count" aria-label={`${n} need you`}>
                {n}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
