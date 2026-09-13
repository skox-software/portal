"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { tasks } from "@/lib/db/schema";
import { eventInsert } from "@/lib/events";
import { notifyLater, portalLink, staffRecipients } from "@/lib/notify";
import { projectForAction } from "@/lib/project-access";

/** A client ticks off something on their to-do list; SKOX hears about it. */
export async function completeClientTask(formData: FormData) {
  const ctx = await projectForAction(formData.get("projectId"));
  if (!ctx.ok) return;
  const taskId = String(formData.get("taskId") ?? "");
  if (!z.uuid().safeParse(taskId).success) return;
  const { project, viewer, client } = ctx;
  const db = getDb();
  const [task] = await db
    .update(tasks)
    .set({ doneAt: new Date(), doneBy: viewer.userId })
    .where(and(eq(tasks.id, taskId), eq(tasks.projectId, project.id), eq(tasks.side, "client"), isNull(tasks.doneAt)))
    .returning();
  if (!task) return;
  await eventInsert({
    workspaceId: project.workspaceId,
    projectId: project.id,
    actorId: viewer.userId,
    verb: "task.completed",
    subjectType: "task",
    subjectId: task.id,
    payload: { title: task.title, by: viewer.email },
  });
  if (!ctx.access.isStaff) {
    notifyLater(() => staffRecipients(project.workspaceId), {
      subject: `${client.name} finished: ${task.title}`,
      preheader: `${viewer.email} ticked it off in the portal`,
      heading: "Done on the client side",
      paragraphs: [`${viewer.email} marked "${task.title}" as done for ${project.name}.`],
      cta: { label: "Open the project", href: portalLink(`/admin/projects/${project.id}`) },
    });
  }
  revalidatePath(`/projects/${project.id}`);
}
