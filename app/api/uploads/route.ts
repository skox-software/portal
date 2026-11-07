import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getViewer } from "@/lib/access";
import { getDb } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { accessToProject, staffMembershipIn } from "@/lib/permissions";
import { SALES_MAX_BYTES, isSalesPath } from "@/lib/sales-files";
import { MAX_UPLOAD_BYTES, projectPrefix } from "@/lib/storage";
import { eq } from "drizzle-orm";

/**
 * Issues short-lived upload tokens so browsers upload straight to private
 * Blob storage (no server body-size limits). A token is only issued to someone
 * with access to the project, only for that project's folder, and only for
 * the file types the purpose allows. Staff-only purposes are enforced here.
 * Sales files (the team's own sales material) go to the workspace's sales
 * folder and only to staff of that workspace.
 */

const salesPayload = z.object({ scope: z.literal("sales"), workspaceId: z.uuid() });

const payload = z.object({
  projectId: z.uuid(),
  purpose: z.enum(["file", "document", "screenshot"]),
});

const TYPES: Record<z.infer<typeof payload>["purpose"], string[] | undefined> = {
  document: ["application/pdf"],
  screenshot: ["image/png", "image/jpeg", "image/webp", "image/gif"],
  file: undefined,
};

export async function POST(request: Request) {
  const body = (await request.json()) as HandleUploadBody;
  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const viewer = await getViewer();
        if (!viewer) throw new Error("Sign in to upload.");
        const raw = JSON.parse(clientPayload ?? "{}");
        const sales = salesPayload.safeParse(raw);
        if (sales.success) {
          const { workspaceId } = sales.data;
          if (!staffMembershipIn(viewer.memberships, workspaceId)) throw new Error("Only the UnBusy team can upload sales files.");
          if (!isSalesPath(pathname, workspaceId)) throw new Error("Bad upload path.");
          return {
            maximumSizeInBytes: SALES_MAX_BYTES,
            addRandomSuffix: true,
            tokenPayload: JSON.stringify({ workspaceId, scope: "sales", userId: viewer.userId }),
          };
        }
        const parsed = payload.safeParse(raw);
        if (!parsed.success) throw new Error("Bad upload request.");
        const { projectId, purpose } = parsed.data;

        const [project] = await getDb().select().from(projects).where(eq(projects.id, projectId)).limit(1);
        const access = project ? accessToProject(viewer.memberships, project) : null;
        if (!access) throw new Error("No access to this project.");
        if (purpose !== "file" && !access.isStaff) throw new Error("Only UnBusy can upload that.");
        if (!pathname.startsWith(`${projectPrefix(projectId)}${purpose}/`) || pathname.includes("..")) {
          throw new Error("Bad upload path.");
        }

        return {
          allowedContentTypes: TYPES[purpose],
          maximumSizeInBytes: MAX_UPLOAD_BYTES,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ projectId, purpose, userId: viewer.userId }),
        };
      },
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
