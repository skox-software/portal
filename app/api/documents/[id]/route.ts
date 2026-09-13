import { eq } from "drizzle-orm";
import { z } from "zod";
import { getViewer } from "@/lib/access";
import { getDb } from "@/lib/db";
import { documents, projects } from "@/lib/db/schema";
import { accessToProject } from "@/lib/permissions";
import { blobResponse } from "@/lib/storage";

/** Streams a document (or its signed copy) to someone with project access. */
export async function GET(request: Request, ctx: RouteContext<"/api/documents/[id]">) {
  const { id } = await ctx.params;
  const viewer = await getViewer();
  if (!viewer) return new Response("Sign in", { status: 401 });
  if (!z.uuid().safeParse(id).success) return new Response("Not found", { status: 404 });

  const [row] = await getDb()
    .select({ doc: documents, project: projects })
    .from(documents)
    .innerJoin(projects, eq(projects.id, documents.projectId))
    .where(eq(documents.id, id))
    .limit(1);
  if (!row || !accessToProject(viewer.memberships, row.project)) return new Response("Not found", { status: 404 });

  const url = new URL(request.url);
  const signed = url.searchParams.get("signed") === "1" && row.doc.signedStorageKey;
  const key = signed ? row.doc.signedStorageKey! : row.doc.storageKey;
  const name = signed ? row.doc.fileName.replace(/\.pdf$/i, "") + " (signed).pdf" : row.doc.fileName;
  return blobResponse(key, { fileName: name, inline: url.searchParams.get("download") !== "1" });
}
