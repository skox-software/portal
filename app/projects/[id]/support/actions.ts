"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { comments, supportRequests } from "@/lib/db/schema";
import { eventInsert } from "@/lib/events";
import { PRIORITY_LABEL, REQUEST_STATUS_LABEL } from "@/lib/format";
import { backWith } from "@/lib/http";
import { clientRecipients, notifyLater, portalLink, staffRecipients } from "@/lib/notify";
import { can } from "@/lib/permissions";
import { projectForAction } from "@/lib/project-access";

export async function createRequest(formData: FormData) {
  const ctx = await projectForAction(formData.get("projectId"));
  if (!ctx.ok) return;
  const { project, client, viewer, access } = ctx;
  const back = `/projects/${project.id}/support`;
  if (!can.requestSupport(access)) backWith(back, "error", "Requests come from the client side.");

  const parsed = z
    .object({
      title: z.string().trim().min(3).max(160),
      body: z.string().trim().min(1).max(5000),
      priority: z.enum(["low", "normal", "urgent"]),
    })
    .safeParse({ title: formData.get("title"), body: formData.get("body"), priority: formData.get("priority") ?? "normal" });
  if (!parsed.success) backWith(back, "error", "Say what you need in the title and describe it below.");
  const input = parsed.data;

  const id = crypto.randomUUID();
  await getDb().batch([
    getDb().insert(supportRequests).values({
      id,
      workspaceId: project.workspaceId,
      projectId: project.id,
      title: input.title,
      body: input.body,
      priority: input.priority,
      createdBy: viewer.userId,
      createdByEmail: viewer.email,
    }),
    eventInsert({
      workspaceId: project.workspaceId,
      projectId: project.id,
      actorId: viewer.userId,
      verb: "request.created",
      subjectType: "request",
      subjectId: id,
      payload: { title: input.title, priority: input.priority },
    }),
  ]);

  notifyLater(() => staffRecipients(project.workspaceId), {
    subject: `${input.priority === "urgent" ? "URGENT " : ""}Request from ${client.name}: ${input.title}`,
    preheader: input.body.slice(0, 140),
    heading: input.title,
    paragraphs: [`${viewer.email} · ${project.name} · ${PRIORITY_LABEL[input.priority]} priority`, input.body],
    cta: { label: "Open the request", href: portalLink(`${back}#r-${id}`) },
  });

  revalidatePath(back);
  backWith(`${back}#r-${id}`, "notice", "Got it. We'll reply here and by email.");
}

export async function replyToRequest(formData: FormData) {
  const ctx = await projectForAction(formData.get("projectId"));
  if (!ctx.ok) return;
  const { project, client, viewer, access } = ctx;
  const back = `/projects/${project.id}/support`;
  const parsed = z
    .object({
      requestId: z.uuid(),
      body: z.string().trim().max(5000),
      status: z.union([z.literal(""), z.enum(["new", "in_progress", "waiting_on_client", "done"])]),
    })
    .safeParse({ requestId: formData.get("requestId"), body: formData.get("body") ?? "", status: formData.get("status") ?? "" });
  if (!parsed.success) return;
  const input = parsed.data;
  if (!input.body && !input.status) return;

  const db = getDb();
  const [request] = await db
    .select()
    .from(supportRequests)
    .where(and(eq(supportRequests.id, input.requestId), eq(supportRequests.projectId, project.id)))
    .limit(1);
  if (!request) return;

  // Clients can reply (which hands it back to SKOX) but only staff set status.
  const nextStatus = access.isStaff ? input.status || request.status : request.status === "waiting_on_client" ? "in_progress" : request.status;
  const ops = [];
  if (input.body) {
    ops.push(
      db.insert(comments).values({
        workspaceId: project.workspaceId,
        parentType: "request",
        parentId: request.id,
        body: input.body,
        authorId: viewer.email,
      }),
    );
  }
  if (nextStatus !== request.status) {
    ops.push(
      db
        .update(supportRequests)
        .set({ status: nextStatus, resolvedAt: nextStatus === "done" ? new Date() : null })
        .where(eq(supportRequests.id, request.id)),
    );
  }
  ops.push(
    eventInsert({
      workspaceId: project.workspaceId,
      projectId: project.id,
      actorId: viewer.userId,
      verb: nextStatus !== request.status ? "request.status_changed" : "request.replied",
      subjectType: "request",
      subjectId: request.id,
      payload: { title: request.title, status: nextStatus },
    }),
  );
  await db.batch(ops as unknown as Parameters<typeof db.batch>[0]);

  const link = portalLink(`${back}#r-${request.id}`);
  if (access.isStaff) {
    notifyLater(() => [request.createdByEmail], {
      subject: nextStatus === "done" ? `Done: ${request.title}` : `Update on your request: ${request.title}`,
      preheader: input.body.slice(0, 140) || REQUEST_STATUS_LABEL[nextStatus],
      heading: nextStatus === "done" ? "Your request is done" : "We replied to your request",
      paragraphs: [request.title, ...(input.body ? [input.body] : []), `Status: ${REQUEST_STATUS_LABEL[nextStatus]}`],
      cta: { label: "Open the request", href: link },
    });
  } else {
    notifyLater(() => staffRecipients(project.workspaceId), {
      subject: `${client.name} replied: ${request.title}`,
      preheader: input.body.slice(0, 140),
      heading: `Reply from ${client.name}`,
      paragraphs: [`${viewer.email} on "${request.title}":`, input.body],
      cta: { label: "Open the request", href: link },
    });
  }
  void clientRecipients;
  revalidatePath(back);
}
