"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { approvals, feedback, previews } from "@/lib/db/schema";
import { eventInsert } from "@/lib/events";
import { clientRecipients, notifyLater, portalLink, staffRecipients } from "@/lib/notify";
import { can } from "@/lib/permissions";
import { projectForAction } from "@/lib/project-access";
import { projectPrefix, statPrivate } from "@/lib/storage";

/** SKOX posts a round of designs (screenshot) for pinned feedback and, optionally, approval. */
export async function createReviewRound(formData: FormData): Promise<{ ok: boolean; message: string }> {
  const ctx = await projectForAction(formData.get("projectId"));
  if (!ctx.ok) return ctx;
  if (!ctx.access.isStaff) return { ok: false, message: "Only SKOX can post designs." };
  const { project, client, viewer } = ctx;

  const parsed = z
    .object({
      pathname: z.string().startsWith(`${projectPrefix(project.id)}screenshot/`),
      label: z.string().trim().min(1).max(120),
      notes: z.string().trim().max(2000),
      url: z.union([z.literal(""), z.url({ protocol: /^https?$/ })]),
      approval: z.enum(["none", "halfway", "launch", "other"]),
    })
    .safeParse({
      pathname: formData.get("pathname"),
      label: formData.get("label"),
      notes: formData.get("notes") ?? "",
      url: formData.get("url") ?? "",
      approval: formData.get("approval") ?? "none",
    });
  if (!parsed.success) return { ok: false, message: "Give the round a name (e.g. Homepage v2)." };
  const input = parsed.data;
  const stat = await statPrivate(input.pathname);
  if (!stat) return { ok: false, message: "The screenshot didn't finish uploading." };

  const db = getDb();
  const previewId = crypto.randomUUID();
  await db.batch([
    db.insert(previews).values({
      id: previewId,
      workspaceId: project.workspaceId,
      projectId: project.id,
      url: input.url || "",
      label: input.label,
      notes: input.notes || null,
      imageKey: stat.pathname,
      createdBy: viewer.userId,
    }),
    ...(input.approval !== "none"
      ? [
          db.insert(approvals).values({
            workspaceId: project.workspaceId,
            projectId: project.id,
            kind: input.approval,
            previewId,
            requestedBy: viewer.userId,
          }),
        ]
      : []),
    eventInsert({
      workspaceId: project.workspaceId,
      projectId: project.id,
      actorId: viewer.userId,
      verb: "review.requested",
      subjectType: "preview",
      subjectId: previewId,
      payload: { label: input.label, approval: input.approval },
    }),
  ] as unknown as Parameters<typeof db.batch>[0]);

  notifyLater(() => clientRecipients(client.id), {
    subject: `New designs to review: ${input.label}`,
    preheader: "Click anywhere on the design to leave a comment.",
    heading: `${input.label} is ready for your eyes`,
    paragraphs: [
      input.notes || `We've posted new designs for ${project.name}.`,
      "Click anywhere on the design to drop a pin and tell us what you love or what should change.",
      ...(input.approval !== "none" ? ["When you're happy, approve the round right there."] : []),
    ],
    cta: { label: "Review the designs", href: portalLink(`/projects/${project.id}/review?round=${previewId}`) },
  });

  revalidatePath(`/projects/${project.id}/review`);
  return { ok: true, message: `Posted ${input.label}. The client has been emailed.` };
}

export type FeedbackState = { status: "idle" } | { status: "error"; message: string } | { status: "saved"; at: number };

export async function addFeedback(_prev: FeedbackState, formData: FormData): Promise<FeedbackState> {
  const ctx = await projectForAction(formData.get("projectId"));
  if (!ctx.ok) return { status: "error", message: ctx.message };
  if (!can.leaveFeedback(ctx.access)) return { status: "error", message: "You can't comment here." };
  const { project, client, viewer, access } = ctx;

  const coord = z.union([z.literal(""), z.coerce.number().min(0).max(100)]);
  const parsed = z
    .object({
      previewId: z.uuid(),
      body: z.string().trim().min(1).max(2000),
      tag: z.enum(["love", "change", "must_fix"]),
      x: coord,
      y: coord,
    })
    .safeParse({
      previewId: formData.get("previewId"),
      body: formData.get("body"),
      tag: formData.get("tag") ?? "change",
      x: formData.get("x") ?? "",
      y: formData.get("y") ?? "",
    });
  if (!parsed.success) return { status: "error", message: "Write a comment first." };
  const input = parsed.data;

  const db = getDb();
  const [preview] = await db
    .select()
    .from(previews)
    .where(and(eq(previews.id, input.previewId), eq(previews.projectId, project.id)))
    .limit(1);
  if (!preview) return { status: "error", message: "That design round is gone." };

  const id = crypto.randomUUID();
  await db.batch([
    db.insert(feedback).values({
      id,
      workspaceId: project.workspaceId,
      projectId: project.id,
      previewId: preview.id,
      pageUrl: preview.url || "design",
      x: input.x === "" ? null : input.x,
      y: input.y === "" ? null : input.y,
      tag: input.tag,
      body: input.body,
      authorId: viewer.email,
    }),
    eventInsert({
      workspaceId: project.workspaceId,
      projectId: project.id,
      actorId: viewer.userId,
      verb: "feedback.added",
      subjectType: "feedback",
      subjectId: id,
      payload: { tag: input.tag, label: preview.label },
    }),
  ]);

  if (!access.isStaff) {
    const tagText = input.tag === "must_fix" ? "Must fix" : input.tag === "love" ? "Love it" : "Change";
    notifyLater(() => staffRecipients(project.workspaceId), {
      subject: `${tagText}: feedback from ${client.name}`,
      preheader: input.body.slice(0, 120),
      heading: `New feedback on ${preview.label ?? "the designs"}`,
      paragraphs: [`${viewer.email} (${tagText}):`, input.body],
      cta: { label: "Open the review", href: portalLink(`/projects/${project.id}/review?round=${preview.id}`) },
    });
  }

  revalidatePath(`/projects/${project.id}/review`);
  return { status: "saved", at: Date.now() };
}

export async function setFeedbackStatus(formData: FormData) {
  const ctx = await projectForAction(formData.get("projectId"));
  if (!ctx.ok || !ctx.access.isStaff) return;
  const parsed = z
    .object({ feedbackId: z.uuid(), status: z.enum(["open", "in_progress", "done", "wont_do"]) })
    .safeParse({ feedbackId: formData.get("feedbackId"), status: formData.get("status") });
  if (!parsed.success) return;
  const db = getDb();
  const done = parsed.data.status === "done" || parsed.data.status === "wont_do";
  await db.batch([
    db
      .update(feedback)
      .set({ status: parsed.data.status, resolvedAt: done ? new Date() : null })
      .where(and(eq(feedback.id, parsed.data.feedbackId), eq(feedback.projectId, ctx.project.id))),
    eventInsert({
      workspaceId: ctx.project.workspaceId,
      projectId: ctx.project.id,
      actorId: ctx.viewer.userId,
      verb: parsed.data.status === "done" ? "feedback.resolved" : "feedback.status_changed",
      subjectType: "feedback",
      subjectId: parsed.data.feedbackId,
      payload: { status: parsed.data.status },
    }),
  ]);
  revalidatePath(`/projects/${ctx.project.id}/review`);
}

export async function decideApproval(formData: FormData) {
  const ctx = await projectForAction(formData.get("projectId"));
  if (!ctx.ok || !can.approve(ctx.access)) return;
  const parsed = z
    .object({
      approvalId: z.uuid(),
      decision: z.enum(["approved", "changes_requested"]),
      note: z.string().trim().max(2000),
    })
    .safeParse({
      approvalId: formData.get("approvalId"),
      decision: formData.get("decision"),
      note: formData.get("note") ?? "",
    });
  if (!parsed.success) return;
  const { project, client, viewer } = ctx;
  const db = getDb();
  const updated = await db
    .update(approvals)
    .set({
      state: parsed.data.decision,
      note: parsed.data.note || null,
      decidedBy: viewer.email,
      decidedAt: new Date(),
    })
    .where(
      and(
        eq(approvals.id, parsed.data.approvalId),
        eq(approvals.projectId, project.id),
        eq(approvals.state, "requested"),
      ),
    )
    .returning();
  if (updated.length === 0) return;

  await eventInsert({
    workspaceId: project.workspaceId,
    projectId: project.id,
    actorId: viewer.userId,
    verb: "approval.decided",
    subjectType: "approval",
    subjectId: parsed.data.approvalId,
    payload: { state: parsed.data.decision, note: parsed.data.note },
  });

  const approved = parsed.data.decision === "approved";
  notifyLater(() => staffRecipients(project.workspaceId), {
    subject: `${approved ? "Approved" : "Changes requested"} by ${client.name}`,
    preheader: parsed.data.note || `${viewer.email} made a decision on ${project.name}`,
    heading: approved ? `${client.name} approved the round` : `${client.name} asked for changes`,
    paragraphs: [`${viewer.email} ${approved ? "approved" : "requested changes on"} ${project.name}.`, ...(parsed.data.note ? [parsed.data.note] : [])],
    cta: { label: "Open the review", href: portalLink(`/projects/${project.id}/review`) },
  });
  revalidatePath(`/projects/${project.id}/review`);
  revalidatePath(`/projects/${project.id}`);
}
