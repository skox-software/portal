type DirectoryEntry = {
  client: { name: string };
  projects: { name: string; status: string }[];
};

/** Search within the already-authorized workspace; retain clients with no projects in All. */
export function filterClientDirectory<T extends DirectoryEntry>(
  entries: T[],
  query: string,
  status: string,
): T[] {
  const search = query.trim().toLocaleLowerCase("en-US");
  return entries.flatMap((entry) => {
    const clientMatches = entry.client.name.toLocaleLowerCase("en-US").includes(search);
    const projects = entry.projects.filter((project) =>
      (status === "all" || project.status === status) &&
      (clientMatches || project.name.toLocaleLowerCase("en-US").includes(search)),
    );
    return projects.length || (status === "all" && clientMatches && entry.projects.length === 0)
      ? [{ ...entry, projects }]
      : [];
  });
}
