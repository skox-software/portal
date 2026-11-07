"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { requireStaff } from "@/lib/access";
import { getDb } from "@/lib/db";
import { salesFiles } from "@/lib/db/schema";
import { eventInsert } from "@/lib/events";
import { isSalesPath, salesTitle } from "@/lib/sales-files";
import { deletePrivate, statPrivate } from "@/lib/storage";

/** Records a sales file the browser just uploaded to the workspace's sales folder. */
export async function registerSalesFile(formData: FormData): Promise<{ ok: boolean; message: string }> {
  const { viewer, staff } = await requireStaff();
  const workspaceId = staff.workspaceId;
  if (String(formData.get("workspaceId") ?? "") !== workspaceId) return { ok: false, message: "Bad upload." };

  const pathname = String(formData.get("pathname") ?? "");
  const fileName = String(formData.get("fileName") ?? "").slice(0, 200) || "file";
  if (!isSalesPath(pathname, workspaceId)) return { ok: false, message: "Bad upload." };
  const stat = await statPrivate(pathname);
  if (!stat) return { ok: false, message: "The upload didn't finish. Try again." };

  const title = salesTitle(formData.get("title"), fileName);
  const note = String(formData.get("note") ?? "").trim().slice(0, 500) || null;
  const id = crypto.randomUUID();
  const db = getDb();
  await db.batch([
    db.insert(salesFiles).values({
      id,
      workspaceId,
      title,
      note,
      storageKey: stat.pathname,
      fileName,
      sizeBytes: stat.size,
      contentType: stat.contentType,
      uploadedBy: viewer.userId,
      uploadedByEmail: viewer.email,
    }),
    eventInsert({
      workspaceId,
      actorId: viewer.userId,
      verb: "sales_file.added",
      subjectType: "sales_file",
      subjectId: id,
      payload: { title, name: fileName, by: viewer.email },
    }),
  ]);

  revalidatePath("/admin/sales-files");
  return { ok: true, message: `Added ${title}.` };
}

/** Removes a sales file for everyone on the team, and its stored copy. */
export async function removeSalesFile(formData: FormData) {
  const { viewer, staff } = await requireStaff();
  const fileId = String(formData.get("fileId") ?? "");
  if (!z.uuid().safeParse(fileId).success) return;
  const db = getDb();
  const [file] = await db
    .select()
    .from(salesFiles)
    .where(and(eq(salesFiles.id, fileId), eq(salesFiles.workspaceId, staff.workspaceId)))
    .limit(1);
  if (!file) return;
  await db.batch([
    db.delete(salesFiles).where(eq(salesFiles.id, file.id)),
    eventInsert({
      workspaceId: file.workspaceId,
      actorId: viewer.userId,
      verb: "sales_file.removed",
      subjectType: "sales_file",
      subjectId: file.id,
      payload: { title: file.title, name: file.fileName, by: viewer.email },
    }),
  ]);
  after(() => deletePrivate(file.storageKey));
  revalidatePath("/admin/sales-files");
}
