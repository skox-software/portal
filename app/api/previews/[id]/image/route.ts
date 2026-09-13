import { eq } from "drizzle-orm";
import { z } from "zod";
import { getViewer } from "@/lib/access";
import { getDb } from "@/lib/db";
import { previews, projects } from "@/lib/db/schema";
import { accessToProject } from "@/lib/permissions";
import { blobResponse } from "@/lib/storage";

export async function GET(_request: Request, ctx: RouteContext<"/api/previews/[id]/image">) {
  const { id } = await ctx.params;
  const viewer = await getViewer();
  if (!viewer) return new Response("Sign in", { status: 401 });
  if (!z.uuid().safeParse(id).success) return new Response("Not found", { status: 404 });
  const [row] = await getDb()
    .select({ preview: previews, project: projects })
    .from(previews)
    .innerJoin(projects, eq(projects.id, previews.projectId))
    .where(eq(previews.id, id))
    .limit(1);
  if (!row?.preview.imageKey || !accessToProject(viewer.memberships, row.project)) {
    return new Response("Not found", { status: 404 });
  }
  return blobResponse(row.preview.imageKey, { fileName: `${row.preview.label ?? "design"}.png`, inline: true });
}
