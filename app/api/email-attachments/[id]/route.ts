import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getViewer } from "@/lib/access";
import { getDb } from "@/lib/db";
import { emailAttachments } from "@/lib/db/schema";
import { staffMembershipIn } from "@/lib/permissions";
import { blobResponse } from "@/lib/storage";

/** Downloads a copied inbound email attachment. SKOX staff only. */
export async function GET(_request: Request, ctx: RouteContext<"/api/email-attachments/[id]">) {
  const { id } = await ctx.params;
  const viewer = await getViewer();
  if (!viewer) return new Response("Sign in", { status: 401 });
  const staff = staffMembershipIn(viewer.memberships);
  if (!staff || !z.uuid().safeParse(id).success) return new Response("Not found", { status: 404 });

  const [file] = await getDb()
    .select()
    .from(emailAttachments)
    .where(and(eq(emailAttachments.id, id), eq(emailAttachments.workspaceId, staff.workspaceId)))
    .limit(1);
  if (!file?.storageKey) return new Response("Not found", { status: 404 });

  // Always a download: attachments come from outside and must never render in the portal's origin.
  return blobResponse(file.storageKey, { fileName: file.name, inline: false });
}
