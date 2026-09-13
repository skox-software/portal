"use server";

import { and, asc, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { files, tasks } from "@/lib/db/schema";
import { eventInsert } from "@/lib/events";
import { clientRecipients, notifyLater, portalLink, staffRecipients } from "@/lib/notify";
import { can } from "@/lib/permissions";
import { projectForAction } from "@/lib/project-access";
import { formatBytes, projectPrefix, statPrivate } from "@/lib/storage";

export async function registerFile(formData: FormData): Promise<{ ok: boolean; message: string }> {
  const ctx = await projectForAction(formData.get("projectId"));
  if (!ctx.ok) return ctx;
  if (!can.uploadFiles(ctx.access)) return { ok: false, message: "You can't upload to this project." };
  const { project, viewer, access, client } = ctx;

  const pathname = String(formData.get("pathname") ?? "");
  const fileName = String(formData.get("fileName") ?? "").slice(0, 200) || "file";
  if (!pathname.startsWith(`${projectPrefix(project.id)}file/`)) return { ok: false, message: "Bad upload." };
  const stat = await statPrivate(pathname);
  if (!stat) return { ok: false, message: "The upload didn't finish. Try again." };

  const fromClient = !access.isStaff;
  const id = crypto.randomUUID();
  // A client upload ticks off the oldest "upload your files" to-do.
  const [checklistItem] = fromClient
    ? await getDb()
        .select({ id: tasks.id, title: tasks.title })
        .from(tasks)
        .where(and(eq(tasks.projectId, project.id), eq(tasks.completesOn, "file_upload"), isNull(tasks.doneAt)))
        .orderBy(asc(tasks.createdAt))
        .limit(1)
    : [];
  const db = getDb();
  await db.batch([
    ...(checklistItem
      ? [
          getDb().update(tasks).set({ doneAt: new Date(), doneBy: viewer.userId }).where(eq(tasks.id, checklistItem.id)),
          eventInsert({
            workspaceId: project.workspaceId,
            projectId: project.id,
            actorId: viewer.userId,
            verb: "task.completed",
            subjectType: "task",
            subjectId: checklistItem.id,
            payload: { title: checklistItem.title, by: viewer.email, auto: true },
          }),
        ]
      : []),
    getDb().insert(files).values({
      id,
      workspaceId: project.workspaceId,
      projectId: project.id,
      storageKey: stat.pathname,
      name: fileName,
      sizeBytes: stat.size,
      contentType: stat.contentType,
      uploadedBy: viewer.userId,
      uploadedByEmail: viewer.email,
      fromClient,
    }),
    eventInsert({
      workspaceId: project.workspaceId,
      projectId: project.id,
      actorId: viewer.userId,
      verb: "file.uploaded",
      subjectType: "file",
      subjectId: id,
      payload: { name: fileName, fromClient: String(fromClient) },
    }),
  ] as unknown as Parameters<typeof db.batch>[0]);

  const link = portalLink(`/projects/${project.id}/files`);
  if (fromClient) {
    notifyLater(() => staffRecipients(project.workspaceId), {
      subject: `${client.name} uploaded ${fileName}`,
      preheader: `${viewer.email} added a file to ${project.name}`,
      heading: "New file from the client",
      paragraphs: [`${viewer.email} uploaded ${fileName} (${formatBytes(stat.size)}) to ${project.name}.`],
      cta: { label: "Open files", href: link },
    });
  } else {
    notifyLater(() => clientRecipients(client.id), {
      subject: `New file for ${project.name}: ${fileName}`,
      preheader: "SKOX shared a file with you",
      heading: "SKOX shared a file",
      paragraphs: [`${fileName} is ready in your portal.`],
      cta: { label: "Open files", href: link },
    });
  }

  revalidatePath(`/projects/${project.id}/files`);
  revalidatePath(`/projects/${project.id}`);
  return {
    ok: true,
    message: checklistItem ? `Uploaded ${fileName}. Ticked off “${checklistItem.title}”.` : `Uploaded ${fileName}.`,
  };
}

export async function deleteFile(formData: FormData) {
  const fileId = String(formData.get("fileId") ?? "");
  if (!z.uuid().safeParse(fileId).success) return;
  const db = getDb();
  const [file] = await db.select().from(files).where(eq(files.id, fileId)).limit(1);
  if (!file) return;
  const ctx = await projectForAction(file.projectId);
  if (!ctx.ok) return;
  if (!ctx.access.isStaff && file.uploadedBy !== ctx.viewer.userId) return;
  await db.batch([
    db.delete(files).where(eq(files.id, file.id)),
    eventInsert({
      workspaceId: file.workspaceId,
      projectId: file.projectId,
      actorId: ctx.viewer.userId,
      verb: "file.removed",
      subjectType: "file",
      subjectId: file.id,
      payload: { name: file.name },
    }),
  ]);
  revalidatePath(`/projects/${file.projectId}/files`);
}
