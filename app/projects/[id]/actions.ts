"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { memberships, tasks } from "@/lib/db/schema";
import { eventInsert } from "@/lib/events";
import { backWith } from "@/lib/http";
import { notifyLater, portalLink, staffRecipients } from "@/lib/notify";
import { can, canInviteRole, normalizeEmail } from "@/lib/permissions";
import { welcomeLink } from "@/lib/onboarding-server";
import { projectForAction } from "@/lib/project-access";
import { allow } from "@/lib/rate-limit";

/** Approvers (and SKOX) add teammates from the client's side. */
export async function inviteTeammate(formData: FormData) {
  const ctx = await projectForAction(formData.get("projectId"));
  if (!ctx.ok) return;
  const { project, client, viewer, access } = ctx;
  const back = `/projects/${project.id}#team`;
  const parsed = z
    .object({ email: z.email().max(200), role: z.enum(["client_approver", "client_member"]) })
    .safeParse({ email: normalizeEmail(String(formData.get("email") ?? "")), role: formData.get("role") });
  if (!parsed.success) backWith(back, "error", "Enter a valid email address.");
  if (!canInviteRole(access, parsed.data.role)) backWith(back, "error", "Only approvers can invite teammates.");

  const db = getDb();
  const [existing] = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.clientId, client.id), eq(memberships.email, parsed.data.email)))
    .limit(1);
  if (existing) backWith(back, "notice", `${parsed.data.email} already has access.`);
  if (!access.isStaff && !(await allow(`invite:${viewer.userId}`, 15, 24 * 60 * 60_000))) {
    backWith(back, "error", "You've invited a lot of people today. Ask SKOX to add the rest.");
  }

  const id = crypto.randomUUID();
  await db.batch([
    db.insert(memberships).values({
      id,
      workspaceId: project.workspaceId,
      clientId: client.id,
      email: parsed.data.email,
      role: parsed.data.role,
      invitedBy: viewer.userId,
    }),
    eventInsert({
      workspaceId: project.workspaceId,
      projectId: project.id,
      actorId: viewer.userId,
      verb: "membership.invited",
      subjectType: "membership",
      subjectId: id,
      payload: { email: parsed.data.email, role: parsed.data.role, by: viewer.email },
    }),
  ]);

  notifyLater(() => [parsed.data.email], {
    subject: `You're invited to ${project.name} on the SKOX portal`,
    preheader: `Follow ${project.name} with SKOX: progress, designs, documents and more.`,
    heading: `You're invited to ${project.name}`,
    paragraphs: [
      `${viewer.email} added you to ${client.name}'s project portal with SKOX.`,
      `Sign in with this email address (${parsed.data.email}). We'll send you a 6-digit code, no password needed.`,
    ],
    cta: { label: "Open the portal", href: welcomeLink(parsed.data.email) },
  });
  if (!access.isStaff) {
    notifyLater(() => staffRecipients(project.workspaceId), {
      subject: `${client.name} added ${parsed.data.email}`,
      preheader: `${viewer.email} invited a teammate`,
      heading: "New person on the client side",
      paragraphs: [`${viewer.email} invited ${parsed.data.email} to ${project.name}.`],
    });
  }
  revalidatePath(`/projects/${project.id}`);
  backWith(back, "notice", `Invited ${parsed.data.email}. They'll get an email with how to sign in.`);
}

export async function removeTeammate(formData: FormData) {
  const ctx = await projectForAction(formData.get("projectId"));
  if (!ctx.ok) return;
  const { project, client, viewer, access } = ctx;
  const back = `/projects/${project.id}#team`;
  const membershipId = String(formData.get("membershipId") ?? "");
  if (!z.uuid().safeParse(membershipId).success) return;
  if (!can.inviteTeammates(access)) backWith(back, "error", "Only approvers can manage the team.");
  const db = getDb();
  const [row] = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.id, membershipId), eq(memberships.clientId, client.id)))
    .limit(1);
  if (!row) return;
  if (row.email === viewer.email) backWith(back, "error", "You can't remove yourself. Ask SKOX.");
  if (!access.isStaff && row.role === "client_approver") backWith(back, "error", "Ask SKOX to remove an approver.");
  await db.batch([
    db.delete(memberships).where(eq(memberships.id, row.id)),
    eventInsert({
      workspaceId: project.workspaceId,
      projectId: project.id,
      actorId: viewer.userId,
      verb: "membership.removed",
      subjectType: "membership",
      subjectId: row.id,
      payload: { email: row.email, by: viewer.email },
    }),
  ]);
  revalidatePath(`/projects/${project.id}`);
  backWith(back, "notice", `${row.email} no longer has access.`);
}

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
