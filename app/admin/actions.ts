"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { requireStaff } from "@/lib/access";
import { ensureAuthAccount } from "@/lib/auth/accounts";
import { getDb } from "@/lib/db";
import {
  clients,
  dateChanges,
  memberships,
  milestones,
  previews,
  projects,
  referrals,
  tasks,
  updates,
  workspaces,
} from "@/lib/db/schema";
import { eventInsert } from "@/lib/events";
import { midpoint, PROJECT_KINDS } from "@/lib/format";
import { backWith } from "@/lib/http";
import { googleBookingEmbedUrl, safeBookingUrl } from "@/lib/meetings";
import { normalizeEmail } from "@/lib/permissions";
import { deleteProjectInput, projectDeletionQuery, type DeletedProject, type DeleteProjectState } from "@/lib/project-deletion";
import { deleteProjectFiles } from "@/lib/storage";

/*
 * Every action re-checks that the caller is SKOX staff and that the thing it
 * touches belongs to the caller's workspace, then records an event in the
 * same batch as the change.
 */

const text = (max: number) => z.string().trim().max(max);
const isoDate = z.iso.date();
const optionalUrl = z.union([z.literal(""), z.url({ protocol: /^https?$/ })]);

function addDays(isoDate: string, days: number) {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

function formFields(formData: FormData) {
  return Object.fromEntries(
    [...formData.entries()].map(([k, v]) => [k, typeof v === "string" ? v : ""]),
  );
}

async function ownProject(projectId: string, workspaceId: string) {
  if (!z.uuid().safeParse(projectId).success) return null;
  const [project] = await getDb()
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.workspaceId, workspaceId)))
    .limit(1);
  return project ?? null;
}

async function ownClient(clientId: string, workspaceId: string) {
  if (!z.uuid().safeParse(clientId).success) return null;
  const [client] = await getDb()
    .select()
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.workspaceId, workspaceId)))
    .limit(1);
  return client ?? null;
}

/* ---- Clients & people ---- */

export async function createClient(formData: FormData) {
  const { viewer, staff } = await requireStaff();
  const parsed = z.object({ name: text(120).min(1) }).safeParse(formFields(formData));
  if (!parsed.success) backWith("/admin", "error", "Give the client a name.");

  const id = crypto.randomUUID();
  await getDb().batch([
    getDb().insert(clients).values({ id, workspaceId: staff.workspaceId, name: parsed.data.name }),
    eventInsert({
      workspaceId: staff.workspaceId,
      actorId: viewer.userId,
      verb: "client.created",
      subjectType: "client",
      subjectId: id,
      payload: { name: parsed.data.name },
    }),
  ]);
  redirect(`/admin/clients/${id}`);
}

export async function saveWorkspaceSettings(formData: FormData) {
  const { staff } = await requireStaff();
  const link = z.union([z.literal(""), z.url({ protocol: /^https$/ })]);
  const bookingLink = z.string().trim().max(2048).refine((value) => !value || !!googleBookingEmbedUrl(value), "Use the Google appointment URL from Inline booking page, not a short link or embed code.");
  const kickoffLink = z.string().trim().max(2048).refine((value) => !value || !!safeBookingUrl(value), "Kickoff booking links must be valid HTTPS URLs without credentials.");
  const parsed = z
    .object({
      reviewUrl: link,
      referralReward: text(160),
      schedulingUrl: kickoffLink,
      projectReviewSchedulingUrl: bookingLink,
      checkInSchedulingUrl: bookingLink,
      welcomeVideoUrl: link,
      teamIntro: text(120),
    })
    .safeParse({
      reviewUrl: formData.get("reviewUrl") ?? "",
      referralReward: formData.get("referralReward") ?? "",
      schedulingUrl: formData.get("schedulingUrl") ?? "",
      projectReviewSchedulingUrl: formData.get("projectReviewSchedulingUrl") ?? "",
      checkInSchedulingUrl: formData.get("checkInSchedulingUrl") ?? "",
      welcomeVideoUrl: formData.get("welcomeVideoUrl") ?? "",
      teamIntro: formData.get("teamIntro") ?? "",
    });
  if (!parsed.success) backWith("/admin", "error", parsed.error.issues[0]?.message ?? "Check the workspace settings.");
  await getDb()
    .update(workspaces)
    .set({
      reviewUrl: parsed.data.reviewUrl || null,
      referralReward: parsed.data.referralReward || null,
      schedulingUrl: parsed.data.schedulingUrl || null,
      projectReviewSchedulingUrl: googleBookingEmbedUrl(parsed.data.projectReviewSchedulingUrl),
      checkInSchedulingUrl: googleBookingEmbedUrl(parsed.data.checkInSchedulingUrl),
      welcomeVideoUrl: parsed.data.welcomeVideoUrl || null,
      teamIntro: parsed.data.teamIntro || null,
    })
    .where(eq(workspaces.id, staff.workspaceId));
  revalidatePath("/admin");
  revalidatePath("/projects/[id]/meetings", "page");
  revalidatePath("/projects/[id]/welcome", "page");
  backWith("/admin", "notice", "Settings saved.");
}

export async function setReferralStatus(formData: FormData) {
  const { viewer, staff } = await requireStaff();
  const parsed = z
    .object({ referralId: z.uuid(), status: z.enum(["new", "contacted", "won", "lost"]) })
    .safeParse({ referralId: formData.get("referralId"), status: formData.get("status") });
  if (!parsed.success) return;
  await getDb().batch([
    getDb()
      .update(referrals)
      .set({ status: parsed.data.status })
      .where(and(eq(referrals.id, parsed.data.referralId), eq(referrals.workspaceId, staff.workspaceId))),
    eventInsert({
      workspaceId: staff.workspaceId,
      actorId: viewer.userId,
      verb: "referral.status_changed",
      subjectType: "referral",
      subjectId: parsed.data.referralId,
      payload: { status: parsed.data.status },
    }),
  ]);
  revalidatePath("/admin");
}

export async function inviteMember(formData: FormData) {
  const { viewer, staff } = await requireStaff();
  const fields = formFields(formData);
  const back = `/admin/clients/${fields.clientId}`;
  const parsed = z
    .object({
      clientId: z.uuid(),
      email: z.email(),
      role: z.enum(["client_approver", "client_member"]),
    })
    .safeParse({ ...fields, email: normalizeEmail(fields.email ?? "") });
  if (!parsed.success) backWith(back, "error", "Enter a valid email address and choose a role.");

  const client = await ownClient(parsed.data.clientId, staff.workspaceId);
  if (!client) backWith("/admin", "error", "That client doesn't exist.");

  const [existing] = await getDb()
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.clientId, client.id), eq(memberships.email, parsed.data.email)))
    .limit(1);
  if (existing) backWith(back, "error", `${parsed.data.email} already has access to ${client.name}.`);

  const account = await ensureAuthAccount(parsed.data.email);
  if (!account.ok) {
    backWith(back, "error", `Couldn't set up a sign-in account for ${parsed.data.email}. Try again in a minute.`);
  }

  const id = crypto.randomUUID();
  await getDb().batch([
    getDb().insert(memberships).values({
      id,
      workspaceId: staff.workspaceId,
      clientId: client.id,
      email: parsed.data.email,
      role: parsed.data.role,
      invitedBy: viewer.userId,
    }),
    eventInsert({
      workspaceId: staff.workspaceId,
      actorId: viewer.userId,
      verb: "membership.invited",
      subjectType: "membership",
      subjectId: id,
      payload: { email: parsed.data.email, role: parsed.data.role, clientId: client.id },
    }),
  ]);
  revalidatePath(back);
  backWith(back, "notice", `Added ${parsed.data.email}. Tell them to sign in at portal.skoxsoftware.com with that email.`);
}

export async function removeMember(formData: FormData) {
  const { viewer, staff } = await requireStaff();
  const membershipId = String(formData.get("membershipId") ?? "");
  if (!z.uuid().safeParse(membershipId).success) backWith("/admin", "error", "Unknown person.");

  const [row] = await getDb()
    .select()
    .from(memberships)
    .where(and(eq(memberships.id, membershipId), eq(memberships.workspaceId, staff.workspaceId)))
    .limit(1);
  // Staff rows are not managed from a client page.
  if (!row?.clientId) backWith("/admin", "error", "Unknown person.");

  await getDb().batch([
    getDb().delete(memberships).where(eq(memberships.id, row.id)),
    eventInsert({
      workspaceId: staff.workspaceId,
      actorId: viewer.userId,
      verb: "membership.removed",
      subjectType: "membership",
      subjectId: row.id,
      payload: { email: row.email, clientId: row.clientId },
    }),
  ]);
  const back = `/admin/clients/${row.clientId}`;
  revalidatePath(back);
  backWith(back, "notice", `${row.email} no longer has access.`);
}

/* ---- Projects ---- */

export async function deleteProject(_state: DeleteProjectState, formData: FormData): Promise<DeleteProjectState> {
  const { viewer, staff } = await requireStaff();
  const parsed = deleteProjectInput.safeParse(formFields(formData));
  if (!parsed.success) return { error: "Type the project name to confirm deletion." };

  let deleted: DeletedProject | undefined;
  try {
    const result = await getDb().execute<DeletedProject>(projectDeletionQuery({
      ...parsed.data,
      workspaceId: staff.workspaceId,
      actorId: viewer.userId,
    }));
    deleted = result.rows[0];
  } catch (error) {
    console.error("[projects] could not delete project", error);
    return { error: "Couldn't delete the project. Please try again." };
  }
  if (!deleted) {
    return { error: "The project name doesn't match, the project was already deleted, or you no longer have access. Refresh Mission control and try again." };
  }

  const project = deleted;
  after(() => deleteProjectFiles(project.id));
  // Refresh staff lists, client views and any open project tabs together.
  revalidatePath("/", "layout");
  backWith("/admin", "notice", `${project.name} deleted.`);
}

export async function createProject(formData: FormData) {
  const { viewer, staff } = await requireStaff();
  const fields = formFields(formData);
  const back = `/admin/clients/${fields.clientId}`;
  const parsed = z
    .object({
      clientId: z.uuid(),
      name: text(140).min(1),
      kind: z.enum(PROJECT_KINDS.map((k) => k.value) as [string, ...string[]]),
      startedOn: isoDate,
      deliveryDate: isoDate,
    })
    .safeParse(fields);
  if (!parsed.success) backWith(back, "error", "Add a name, type, start date and delivery date.");
  const input = parsed.data;
  if (input.deliveryDate < input.startedOn) {
    backWith(back, "error", "The delivery date can't be before the start date.");
  }

  const client = await ownClient(input.clientId, staff.workspaceId);
  if (!client) backWith("/admin", "error", "That client doesn't exist.");

  const db = getDb();
  const id = crypto.randomUUID();
  const base = { workspaceId: staff.workspaceId, projectId: id };
  await db.batch([
    db.insert(projects).values({
      id,
      workspaceId: staff.workspaceId,
      clientId: client.id,
      name: input.name,
      kind: input.kind,
      startedOn: input.startedOn,
      deliveryDate: input.deliveryDate,
    }),
    db.insert(milestones).values([
      { ...base, kind: "kickoff", title: "Kickoff", dueOn: input.startedOn, position: 0 },
      {
        ...base,
        kind: "halfway",
        title: "Halfway review",
        dueOn: midpoint(input.startedOn, input.deliveryDate),
        position: 1,
      },
      { ...base, kind: "launch", title: "Launch", dueOn: input.deliveryDate, position: 2 },
    ]),
    // The kickoff checklist: what we always need from a client in week one.
    db.insert(tasks).values(
      [
        { title: "Upload your logo and brand files", days: 3, completesOn: "file_upload" as const },
        { title: "Share any logins or access we'll need (Requests tab, never passwords in email)", days: 5, completesOn: null },
        { title: "Upload the text and photos you want on the product", days: 7, completesOn: "file_upload" as const },
      ].map((t) => ({
        ...base,
        side: "client" as const,
        title: t.title,
        completesOn: t.completesOn,
        dueOn: addDays(input.startedOn, t.days),
        createdBy: viewer.userId,
      })),
    ),
    eventInsert({
      workspaceId: staff.workspaceId,
      projectId: id,
      actorId: viewer.userId,
      verb: "project.created",
      subjectType: "project",
      subjectId: id,
      payload: { name: input.name, deliveryDate: input.deliveryDate },
    }),
  ]);
  redirect(`/admin/projects/${id}`);
}

export async function changeDeliveryDate(formData: FormData) {
  const { viewer, staff } = await requireStaff();
  const fields = formFields(formData);
  const back = `/admin/projects/${fields.projectId}`;
  const parsed = z
    .object({ projectId: z.uuid(), deliveryDate: isoDate, reason: text(500).min(3) })
    .safeParse(fields);
  if (!parsed.success) backWith(back, "error", "Pick the new date and say why it moved.");

  const project = await ownProject(parsed.data.projectId, staff.workspaceId);
  if (!project) backWith("/admin", "error", "That project doesn't exist.");
  if (project.deliveryDate === parsed.data.deliveryDate) {
    backWith(back, "error", "That's already the delivery date.");
  }

  const db = getDb();
  await db.batch([
    db.update(projects).set({ deliveryDate: parsed.data.deliveryDate, dateTentative: false }).where(eq(projects.id, project.id)),
    db
      .update(milestones)
      .set({ dueOn: parsed.data.deliveryDate })
      .where(and(eq(milestones.projectId, project.id), eq(milestones.kind, "launch"))),
    db.insert(dateChanges).values({
      workspaceId: staff.workspaceId,
      projectId: project.id,
      fromDate: project.deliveryDate,
      toDate: parsed.data.deliveryDate,
      reason: parsed.data.reason,
      changedBy: viewer.userId,
    }),
    eventInsert({
      workspaceId: staff.workspaceId,
      projectId: project.id,
      actorId: viewer.userId,
      verb: "project.date_changed",
      subjectType: "project",
      subjectId: project.id,
      payload: { from: project.deliveryDate, to: parsed.data.deliveryDate, reason: parsed.data.reason },
    }),
  ]);
  revalidatePath(back);
  backWith(back, "notice", "Delivery date updated. The client sees the new date and your reason.");
}

export async function setProjectStatus(formData: FormData) {
  const { viewer, staff } = await requireStaff();
  const fields = formFields(formData);
  const back = `/admin/projects/${fields.projectId}`;
  const parsed = z
    .object({
      projectId: z.uuid(),
      status: z.enum(["kickoff", "building", "review", "launched", "paused"]),
    })
    .safeParse(fields);
  if (!parsed.success) backWith(back, "error", "Choose a status.");

  const project = await ownProject(parsed.data.projectId, staff.workspaceId);
  if (!project) backWith("/admin", "error", "That project doesn't exist.");

  await getDb().batch([
    getDb().update(projects).set({ status: parsed.data.status }).where(eq(projects.id, project.id)),
    eventInsert({
      workspaceId: staff.workspaceId,
      projectId: project.id,
      actorId: viewer.userId,
      verb: "project.status_changed",
      subjectType: "project",
      subjectId: project.id,
      payload: { from: project.status, to: parsed.data.status },
    }),
  ]);
  revalidatePath(back);
  backWith(back, "notice", "Status updated.");
}

export async function addMilestone(formData: FormData) {
  const { viewer, staff } = await requireStaff();
  const fields = formFields(formData);
  const back = `/admin/projects/${fields.projectId}`;
  const parsed = z
    .object({ projectId: z.uuid(), title: text(140).min(1), dueOn: z.union([z.literal(""), isoDate]) })
    .safeParse(fields);
  if (!parsed.success) backWith(back, "error", "Give the milestone a title.");

  const project = await ownProject(parsed.data.projectId, staff.workspaceId);
  if (!project) backWith("/admin", "error", "That project doesn't exist.");

  const id = crypto.randomUUID();
  await getDb().batch([
    getDb().insert(milestones).values({
      id,
      workspaceId: staff.workspaceId,
      projectId: project.id,
      kind: "custom",
      title: parsed.data.title,
      dueOn: parsed.data.dueOn || null,
      position: 10,
    }),
    eventInsert({
      workspaceId: staff.workspaceId,
      projectId: project.id,
      actorId: viewer.userId,
      verb: "milestone.added",
      subjectType: "milestone",
      subjectId: id,
      payload: { title: parsed.data.title },
    }),
  ]);
  revalidatePath(back);
  backWith(back, "notice", "Milestone added.");
}

export async function setMilestoneState(formData: FormData) {
  const { viewer, staff } = await requireStaff();
  const fields = formFields(formData);
  const back = `/admin/projects/${fields.projectId}`;
  const parsed = z
    .object({
      projectId: z.uuid(),
      milestoneId: z.uuid(),
      state: z.enum(["upcoming", "in_progress", "done"]),
    })
    .safeParse(fields);
  if (!parsed.success) backWith(back, "error", "Choose a state.");

  const project = await ownProject(parsed.data.projectId, staff.workspaceId);
  if (!project) backWith("/admin", "error", "That project doesn't exist.");

  await getDb().batch([
    getDb()
      .update(milestones)
      .set({ state: parsed.data.state })
      .where(and(eq(milestones.id, parsed.data.milestoneId), eq(milestones.projectId, project.id))),
    eventInsert({
      workspaceId: staff.workspaceId,
      projectId: project.id,
      actorId: viewer.userId,
      verb: "milestone.state_changed",
      subjectType: "milestone",
      subjectId: parsed.data.milestoneId,
      payload: { state: parsed.data.state },
    }),
  ]);
  revalidatePath(back);
  backWith(back, "notice", "Milestone updated.");
}

export async function addTask(formData: FormData) {
  const { viewer, staff } = await requireStaff();
  const fields = formFields(formData);
  const back = `/admin/projects/${fields.projectId}`;
  const parsed = z
    .object({
      projectId: z.uuid(),
      title: text(200).min(1),
      side: z.enum(["client", "skox"]),
      dueOn: z.union([z.literal(""), isoDate]),
    })
    .safeParse(fields);
  if (!parsed.success) backWith(back, "error", "Describe the task and who it's on.");

  const project = await ownProject(parsed.data.projectId, staff.workspaceId);
  if (!project) backWith("/admin", "error", "That project doesn't exist.");

  const id = crypto.randomUUID();
  await getDb().batch([
    getDb().insert(tasks).values({
      id,
      workspaceId: staff.workspaceId,
      projectId: project.id,
      side: parsed.data.side,
      title: parsed.data.title,
      dueOn: parsed.data.dueOn || null,
      createdBy: viewer.userId,
    }),
    eventInsert({
      workspaceId: staff.workspaceId,
      projectId: project.id,
      actorId: viewer.userId,
      verb: "task.added",
      subjectType: "task",
      subjectId: id,
      payload: { title: parsed.data.title, side: parsed.data.side },
    }),
  ]);
  revalidatePath(back);
  backWith(back, "notice", parsed.data.side === "client" ? "Added to the client's list." : "Task added.");
}

export async function toggleTask(formData: FormData) {
  const { viewer, staff } = await requireStaff();
  const fields = formFields(formData);
  const back = `/admin/projects/${fields.projectId}`;
  const parsed = z.object({ projectId: z.uuid(), taskId: z.uuid() }).safeParse(fields);
  if (!parsed.success) backWith(back, "error", "Unknown task.");

  const project = await ownProject(parsed.data.projectId, staff.workspaceId);
  if (!project) backWith("/admin", "error", "That project doesn't exist.");

  const [task] = await getDb()
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, parsed.data.taskId), eq(tasks.projectId, project.id)))
    .limit(1);
  if (!task) backWith(back, "error", "Unknown task.");

  const done = task.doneAt === null;
  await getDb().batch([
    getDb()
      .update(tasks)
      .set(done ? { doneAt: new Date(), doneBy: viewer.userId } : { doneAt: null, doneBy: null })
      .where(eq(tasks.id, task.id)),
    eventInsert({
      workspaceId: staff.workspaceId,
      projectId: project.id,
      actorId: viewer.userId,
      verb: done ? "task.completed" : "task.reopened",
      subjectType: "task",
      subjectId: task.id,
    }),
  ]);
  revalidatePath(back);
  backWith(back, "notice", done ? "Marked done." : "Reopened.");
}

export async function postUpdate(formData: FormData) {
  const { viewer, staff } = await requireStaff();
  const fields = formFields(formData);
  const back = `/admin/projects/${fields.projectId}`;
  const parsed = z
    .object({
      projectId: z.uuid(),
      shipped: text(4000),
      next: text(4000),
      needed: text(4000),
      previewUrl: optionalUrl,
      previewLabel: text(120),
      videoUrl: optionalUrl,
    })
    .safeParse(fields);
  if (!parsed.success) backWith(back, "error", "Check the links: they need to start with https://");
  const input = parsed.data;
  if (!input.shipped && !input.next && !input.needed) {
    backWith(back, "error", "Write at least one of shipped, next or needed.");
  }

  const project = await ownProject(input.projectId, staff.workspaceId);
  if (!project) backWith("/admin", "error", "That project doesn't exist.");

  const db = getDb();
  const updateId = crypto.randomUUID();
  const previewId = input.previewUrl ? crypto.randomUUID() : null;
  await db.batch([
    ...(previewId
      ? [
          db.insert(previews).values({
            id: previewId,
            workspaceId: staff.workspaceId,
            projectId: project.id,
            url: input.previewUrl,
            label: input.previewLabel || null,
            createdBy: viewer.userId,
          }),
        ]
      : []),
    db.insert(updates).values({
      id: updateId,
      workspaceId: staff.workspaceId,
      projectId: project.id,
      shipped: input.shipped,
      next: input.next,
      needed: input.needed,
      videoUrl: input.videoUrl || null,
      previewId,
      authorId: viewer.userId,
    }),
    eventInsert({
      workspaceId: staff.workspaceId,
      projectId: project.id,
      actorId: viewer.userId,
      verb: "update.posted",
      subjectType: "update",
      subjectId: updateId,
      payload: { hasPreview: Boolean(previewId), hasVideo: Boolean(input.videoUrl) },
    }),
  ] as unknown as Parameters<typeof db.batch>[0]);
  revalidatePath(back);
  revalidatePath(`/projects/${project.id}`);
  backWith(back, "notice", "Update posted. The client sees it on their project home.");
}
