import { eq } from "drizzle-orm";
import { z } from "zod";
import { getViewer } from "@/lib/access";
import { getDb } from "@/lib/db";
import { emailMessages } from "@/lib/db/schema";
import { staffMembershipIn } from "@/lib/permissions";
import { blobResponse } from "@/lib/storage";

/** An attachment from an Inbox email. UnBusy staff of that workspace only. */
export async function GET(request: Request, ctx: RouteContext<"/api/inbox/attachments/[id]/[index]">) {
  const { id, index } = await ctx.params;
  const viewer = await getViewer();
  if (!viewer) return new Response("Sign in", { status: 401 });
  if (!z.uuid().safeParse(id).success) return new Response("Not found", { status: 404 });

  const [message] = await getDb().select().from(emailMessages).where(eq(emailMessages.id, id)).limit(1);
  if (!message || !staffMembershipIn(viewer.memberships, message.workspaceId)) return new Response("Not found", { status: 404 });
  const file = message.attachments[Number(index)];
  if (!file?.storageKey) return new Response("Not found", { status: 404 });

  const inline = new URL(request.url).searchParams.get("download") !== "1";
  // Same rule as project files: only images and PDFs open in the browser.
  const safeInline = inline && /^(image\/(png|jpeg|webp|gif)|application\/pdf)$/.test(file.contentType);
  return blobResponse(file.storageKey, { fileName: file.name, inline: safeInline });
}
