import { eq } from "drizzle-orm";
import { z } from "zod";
import { getViewer } from "@/lib/access";
import { getDb } from "@/lib/db";
import { salesFiles } from "@/lib/db/schema";
import { staffMembershipIn } from "@/lib/permissions";
import { inlineKind, singleByteRange } from "@/lib/sales-files";
import { blobResponse } from "@/lib/storage";

/** A sales file, for the UnBusy team only. Videos, images and PDFs open in the page; the rest download. */
export async function GET(request: Request, ctx: RouteContext<"/api/sales-files/[id]">) {
  const { id } = await ctx.params;
  const viewer = await getViewer();
  if (!viewer) return new Response("Sign in", { status: 401 });
  if (!z.uuid().safeParse(id).success) return new Response("Not found", { status: 404 });

  const [file] = await getDb().select().from(salesFiles).where(eq(salesFiles.id, id)).limit(1);
  // Staff of the file's own workspace only; anyone else gets the same answer as a missing file.
  if (!file || !staffMembershipIn(viewer.memberships, file.workspaceId)) return new Response("Not found", { status: 404 });

  const inline = new URL(request.url).searchParams.get("download") !== "1" && inlineKind(file.contentType) !== null;
  return blobResponse(file.storageKey, {
    fileName: file.fileName,
    inline,
    range: singleByteRange(request.headers.get("range")),
  });
}
