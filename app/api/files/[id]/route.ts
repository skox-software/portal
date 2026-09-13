import { eq } from "drizzle-orm";
import { z } from "zod";
import { getViewer } from "@/lib/access";
import { getDb } from "@/lib/db";
import { files, projects } from "@/lib/db/schema";
import { accessToProject } from "@/lib/permissions";
import { blobResponse } from "@/lib/storage";

export async function GET(request: Request, ctx: RouteContext<"/api/files/[id]">) {
  const { id } = await ctx.params;
  const viewer = await getViewer();
  if (!viewer) return new Response("Sign in", { status: 401 });
  if (!z.uuid().safeParse(id).success) return new Response("Not found", { status: 404 });

  const [row] = await getDb()
    .select({ file: files, project: projects })
    .from(files)
    .innerJoin(projects, eq(projects.id, files.projectId))
    .where(eq(files.id, id))
    .limit(1);
  if (!row || !accessToProject(viewer.memberships, row.project)) return new Response("Not found", { status: 404 });

  const inline = new URL(request.url).searchParams.get("download") !== "1";
  // Only show images and PDFs inline; everything else downloads, so an uploaded
  // HTML file can never run in the portal's origin.
  const safeInline = inline && /^(image\/(png|jpeg|webp|gif)|application\/pdf)$/.test(row.file.contentType ?? "");
  return blobResponse(row.file.storageKey, { fileName: row.file.name, inline: safeInline });
}
