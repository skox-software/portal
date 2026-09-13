import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { z } from "zod";
import { getViewer, type Viewer } from "@/lib/access";
import { getDb } from "@/lib/db";
import { clients, projects } from "@/lib/db/schema";
import { accessToProject, type ProjectAccess } from "@/lib/permissions";

/**
 * For server actions: resolves the viewer's access to a project without
 * redirecting, so actions can return a readable error instead.
 */
export async function projectForAction(projectId: unknown): Promise<
  | {
      ok: true;
      viewer: Viewer;
      project: typeof projects.$inferSelect;
      client: typeof clients.$inferSelect;
      access: ProjectAccess;
    }
  | { ok: false; message: string }
> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, message: "Your session ended. Sign in again." };
  if (!z.uuid().safeParse(projectId).success) return { ok: false, message: "Unknown project." };
  const [row] = await getDb()
    .select({ project: projects, client: clients })
    .from(projects)
    .innerJoin(clients, eq(clients.id, projects.clientId))
    .where(eq(projects.id, projectId as string))
    .limit(1);
  const access = row ? accessToProject(viewer.memberships, row.project) : null;
  if (!row || !access) return { ok: false, message: "You don't have access to this project." };
  return { ok: true, viewer, project: row.project, client: row.client, access };
}

/** Where a request came from, for signature certificates. */
export async function requestFingerprint() {
  const h = await headers();
  // Vercel sets x-real-ip to the connecting client; prefer it over the
  // client-extendable x-forwarded-for chain.
  const ip = (h.get("x-real-ip") ?? h.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || null;
  return { ip, userAgent: h.get("user-agent")?.slice(0, 400) ?? null };
}
