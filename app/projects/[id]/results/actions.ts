"use server";

import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { carePlans, ideas, memberships, projects, reports, resources, shareLinks } from "@/lib/db/schema";
import { eventInsert } from "@/lib/events";
import { formatMonth } from "@/lib/format";
import { backWith } from "@/lib/http";
import { clientRecipients, notifyLater, portalLink, staffRecipients } from "@/lib/notify";
import { can } from "@/lib/permissions";
import { projectForAction } from "@/lib/project-access";

const optionalNumber = z.union([z.literal(""), z.coerce.number().min(0).max(1_000_000_000)]);
const num = (v: "" | number) => (v === "" ? null : v);

export async function saveReport(formData: FormData) {
  const ctx = await projectForAction(formData.get("projectId"));
  if (!ctx.ok || !ctx.access.isStaff) return;
  const { project, client, viewer } = ctx;
  const back = `/projects/${project.id}/results`;
  const parsed = z
    .object({
      month: z.string().regex(/^\d{4}-\d{2}$/),
      visitors: optionalNumber,
      leads: optionalNumber,
      uptimePct: z.union([z.literal(""), z.coerce.number().min(0).max(100)]),
      speedScore: z.union([z.literal(""), z.coerce.number().int().min(0).max(100)]),
      hoursUsed: optionalNumber,
      highlights: z.string().trim().max(4000),
    })
    .safeParse(Object.fromEntries(["month", "visitors", "leads", "uptimePct", "speedScore", "hoursUsed", "highlights"].map((k) => [k, formData.get(k) ?? ""])));
  if (!parsed.success) backWith(back, "error", "Pick the month and use plain numbers.");
  const input = parsed.data;
  const month = `${input.month}-01`;
  const values = {
    visitors: num(input.visitors),
    leads: num(input.leads),
    uptimePct: num(input.uptimePct),
    speedScore: num(input.speedScore),
    hoursUsed: num(input.hoursUsed),
    highlights: input.highlights,
  };
  const db = getDb();
  await db.batch([
    db
      .insert(reports)
      .values({ workspaceId: project.workspaceId, projectId: project.id, month, createdBy: viewer.userId, ...values })
      .onConflictDoUpdate({ target: [reports.projectId, reports.month], set: values }),
    eventInsert({
      workspaceId: project.workspaceId,
      projectId: project.id,
      actorId: viewer.userId,
      verb: "report.published",
      subjectType: "report",
      subjectId: month,
      payload: { month },
    }),
  ]);
  if (formData.get("notify") === "on") {
    notifyLater(() => clientRecipients(client.id), {
      subject: `Your ${formatMonth(month)} results for ${project.name}`,
      preheader: input.highlights.slice(0, 140) || "Your monthly performance report is available in the portal.",
      heading: `${formatMonth(month)} performance report`,
      paragraphs: [
        ...(values.visitors != null ? [`${values.visitors.toLocaleString("en-US")} visitors`] : []),
        ...(values.leads != null ? [`${values.leads.toLocaleString("en-US")} leads`] : []),
        ...(input.highlights ? [input.highlights] : []),
      ],
      cta: { label: "See the full report", href: portalLink(back) },
    });
  }
  revalidatePath(back);
  backWith(back, "notice", `${formatMonth(month)} report saved.`);
}

export async function saveCarePlan(formData: FormData) {
  const ctx = await projectForAction(formData.get("projectId"));
  if (!ctx.ok || !ctx.access.isStaff) return;
  const { project, viewer } = ctx;
  const back = `/projects/${project.id}/results`;
  const parsed = z
    .object({
      name: z.string().trim().min(1).max(80),
      hoursIncluded: z.coerce.number().min(0).max(1000),
      priceNote: z.string().trim().max(120),
      includes: z.string().trim().max(2000),
      startedOn: z.union([z.literal(""), z.iso.date()]),
    })
    .safeParse(Object.fromEntries(["name", "hoursIncluded", "priceNote", "includes", "startedOn"].map((k) => [k, formData.get(k) ?? ""])));
  if (!parsed.success) backWith(back, "error", "Name the plan and set the hours included.");
  const values = {
    name: parsed.data.name,
    hoursIncluded: parsed.data.hoursIncluded,
    priceNote: parsed.data.priceNote || null,
    includes: parsed.data.includes,
    startedOn: parsed.data.startedOn || null,
  };
  const db = getDb();
  await db.batch([
    db
      .insert(carePlans)
      .values({ workspaceId: project.workspaceId, projectId: project.id, ...values })
      .onConflictDoUpdate({ target: carePlans.projectId, set: values }),
    eventInsert({
      workspaceId: project.workspaceId,
      projectId: project.id,
      actorId: viewer.userId,
      verb: "care_plan.saved",
      subjectType: "care_plan",
      subjectId: project.id,
      payload: { name: values.name },
    }),
  ]);
  revalidatePath(back);
  backWith(back, "notice", "Care plan saved.");
}

export async function postIdea(formData: FormData) {
  const ctx = await projectForAction(formData.get("projectId"));
  if (!ctx.ok || !ctx.access.isStaff) return;
  const { project, client, viewer } = ctx;
  const back = `/projects/${project.id}/results`;
  const parsed = z
    .object({ title: z.string().trim().min(3).max(120), pitch: z.string().trim().min(1).max(3000), estimate: z.string().trim().max(80) })
    .safeParse({ title: formData.get("title"), pitch: formData.get("pitch"), estimate: formData.get("estimate") ?? "" });
  if (!parsed.success) backWith(back, "error", "Give the idea a title and a short pitch.");
  const id = crypto.randomUUID();
  await getDb().batch([
    getDb().insert(ideas).values({
      id,
      workspaceId: project.workspaceId,
      projectId: project.id,
      title: parsed.data.title,
      pitch: parsed.data.pitch,
      estimate: parsed.data.estimate || null,
      createdBy: viewer.userId,
    }),
    eventInsert({
      workspaceId: project.workspaceId,
      projectId: project.id,
      actorId: viewer.userId,
      verb: "idea.posted",
      subjectType: "idea",
      subjectId: id,
      payload: { title: parsed.data.title },
    }),
  ]);
  notifyLater(() => clientRecipients(client.id), {
    subject: `An idea for ${client.name}: ${parsed.data.title}`,
    preheader: parsed.data.pitch.slice(0, 140),
    heading: parsed.data.title,
    paragraphs: [parsed.data.pitch, ...(parsed.data.estimate ? [`Estimated scope: ${parsed.data.estimate}`] : [])],
    cta: { label: "Tell us what you think", href: portalLink(`${back}#ideas`) },
  });
  revalidatePath(back);
  backWith(back, "notice", "Idea posted and emailed to the client.");
}

export async function respondToIdea(formData: FormData) {
  const ctx = await projectForAction(formData.get("projectId"));
  if (!ctx.ok || !can.respondToIdeas(ctx.access)) return;
  const { project, client, viewer } = ctx;
  const parsed = z
    .object({ ideaId: z.uuid(), response: z.enum(["interested", "not_now"]) })
    .safeParse({ ideaId: formData.get("ideaId"), response: formData.get("response") });
  if (!parsed.success) return;
  const db = getDb();
  const [idea] = await db
    .update(ideas)
    .set({ status: parsed.data.response, respondedByEmail: viewer.email, respondedAt: new Date() })
    .where(and(eq(ideas.id, parsed.data.ideaId), eq(ideas.projectId, project.id)))
    .returning();
  if (!idea) return;
  await eventInsert({
    workspaceId: project.workspaceId,
    projectId: project.id,
    actorId: viewer.userId,
    verb: "idea.responded",
    subjectType: "idea",
    subjectId: idea.id,
    payload: { title: idea.title, response: parsed.data.response },
  });
  if (parsed.data.response === "interested") {
    notifyLater(() => staffRecipients(project.workspaceId), {
      subject: `${client.name} is interested: ${idea.title}`,
      preheader: "A warm lead for your next project.",
      heading: `${client.name} wants to hear more`,
      paragraphs: [`${viewer.email} said they're interested in "${idea.title}". Reach out while it's warm.`],
      cta: { label: "Open the project", href: portalLink(`/projects/${project.id}/results#ideas`) },
    });
  }
  revalidatePath(`/projects/${project.id}/results`);
}

export async function setIdeaStatus(formData: FormData) {
  const ctx = await projectForAction(formData.get("projectId"));
  if (!ctx.ok || !ctx.access.isStaff) return;
  const parsed = z
    .object({ ideaId: z.uuid(), status: z.enum(["proposed", "interested", "not_now", "planned"]) })
    .safeParse({ ideaId: formData.get("ideaId"), status: formData.get("status") });
  if (!parsed.success) return;
  await getDb()
    .update(ideas)
    .set({ status: parsed.data.status })
    .where(and(eq(ideas.id, parsed.data.ideaId), eq(ideas.projectId, ctx.project.id)));
  revalidatePath(`/projects/${ctx.project.id}/results`);
}

export async function addResource(formData: FormData) {
  const ctx = await projectForAction(formData.get("projectId"));
  if (!ctx.ok || !ctx.access.isStaff) return;
  const { project, viewer } = ctx;
  const back = `/projects/${project.id}/results`;
  const parsed = z
    .object({
      kind: z.enum(["video", "guide", "link", "login_note"]),
      title: z.string().trim().min(1).max(140),
      url: z.union([z.literal(""), z.url({ protocol: /^https?$/ })]),
      note: z.string().trim().max(1000),
    })
    .safeParse({ kind: formData.get("kind"), title: formData.get("title"), url: formData.get("url") ?? "", note: formData.get("note") ?? "" });
  if (!parsed.success) backWith(back, "error", "Add a title; links must start with https://");
  const id = crypto.randomUUID();
  await getDb().batch([
    getDb().insert(resources).values({
      id,
      workspaceId: project.workspaceId,
      projectId: project.id,
      kind: parsed.data.kind,
      title: parsed.data.title,
      url: parsed.data.url || null,
      note: parsed.data.note || null,
      createdBy: viewer.userId,
    }),
    eventInsert({
      workspaceId: project.workspaceId,
      projectId: project.id,
      actorId: viewer.userId,
      verb: "resource.added",
      subjectType: "resource",
      subjectId: id,
      payload: { title: parsed.data.title },
    }),
  ]);
  revalidatePath(back);
  backWith(`${back}#launch-kit`, "notice", "Added to the launch kit.");
}

export async function removeResource(formData: FormData) {
  const ctx = await projectForAction(formData.get("projectId"));
  if (!ctx.ok || !ctx.access.isStaff) return;
  const id = String(formData.get("resourceId") ?? "");
  if (!z.uuid().safeParse(id).success) return;
  await getDb().delete(resources).where(and(eq(resources.id, id), eq(resources.projectId, ctx.project.id)));
  revalidatePath(`/projects/${ctx.project.id}/results`);
}

/** Staff: mark launched with the live URL. Sends the "you're live" email. */
export async function markLaunched(formData: FormData) {
  const ctx = await projectForAction(formData.get("projectId"));
  if (!ctx.ok || !ctx.access.isStaff) return;
  const { project, client, viewer } = ctx;
  const back = `/admin/projects/${project.id}`;
  const parsed = z
    .object({ liveUrl: z.url({ protocol: /^https?$/ }), launchedOn: z.iso.date() })
    .safeParse({ liveUrl: formData.get("liveUrl"), launchedOn: formData.get("launchedOn") });
  if (!parsed.success) backWith(back, "error", "Add the live URL (https://…) and the launch date.");
  const db = getDb();
  await db.batch([
    db
      .update(projects)
      .set({ status: "launched", liveUrl: parsed.data.liveUrl, launchedOn: parsed.data.launchedOn })
      .where(eq(projects.id, project.id)),
    eventInsert({
      workspaceId: project.workspaceId,
      projectId: project.id,
      actorId: viewer.userId,
      verb: "project.status_changed",
      subjectType: "project",
      subjectId: project.id,
      payload: { from: project.status, to: "launched", liveUrl: parsed.data.liveUrl },
    }),
  ]);
  notifyLater(() => clientRecipients(client.id), {
    subject: `${project.name} is live`,
    preheader: "Your launch kit, how-to videos and support are all in your portal.",
    heading: `${project.name} is live`,
    paragraphs: [
      `Congratulations. ${project.name} is live at ${parsed.data.liveUrl}.`,
      "Your launch resources and walkthroughs are available in the portal. For support or future updates, select “Request a change” to contact our team.",
    ],
    cta: { label: "Open your launch kit", href: portalLink(`/projects/${project.id}/results#launch-kit`) },
  });
  revalidatePath(back);
  revalidatePath(`/projects/${project.id}`);
  backWith(back, "notice", "Marked live. The client got the launch email.");
}

/** Approvers and staff: a read-only status link for people without a login. */
export async function createShareLink(formData: FormData) {
  const ctx = await projectForAction(formData.get("projectId"));
  if (!ctx.ok) return;
  const { project, viewer, access } = ctx;
  const back = `/projects/${project.id}`;
  if (!can.createShareLink(access)) backWith(back, "error", "Only approvers can share a status link.");
  const token = randomBytes(24).toString("base64url");
  const id = crypto.randomUUID();
  await getDb().batch([
    getDb().insert(shareLinks).values({
      id,
      workspaceId: project.workspaceId,
      projectId: project.id,
      tokenHash: createHash("sha256").update(token).digest("hex"),
      createdBy: viewer.email,
      expiresAt: new Date(Date.now() + 30 * 86_400_000),
    }),
    eventInsert({
      workspaceId: project.workspaceId,
      projectId: project.id,
      actorId: viewer.userId,
      verb: "share_link.created",
      subjectType: "share_link",
      subjectId: id,
    }),
  ]);
  backWith(`${back}?share=${token}#share`, "notice", "Status link created. It works for 30 days.");
}

export async function revokeShareLinks(formData: FormData) {
  const ctx = await projectForAction(formData.get("projectId"));
  if (!ctx.ok || !can.createShareLink(ctx.access)) return;
  await getDb()
    .update(shareLinks)
    .set({ revokedAt: new Date() })
    .where(and(eq(shareLinks.projectId, ctx.project.id), isNull(shareLinks.revokedAt)));
  backWith(`/projects/${ctx.project.id}#share`, "notice", "All status links for this project stopped working.");
}

/** Creates (once) the client's personal referral code. */
export async function ensureReferralCode(formData: FormData) {
  const ctx = await projectForAction(formData.get("projectId"));
  if (!ctx.ok || ctx.access.isStaff) return;
  const membership = ctx.viewer.memberships.find((m) => m.clientId === ctx.project.clientId);
  if (!membership) return;
  if (!membership.referralCode) {
    const code = randomBytes(5).toString("base64url").toLowerCase().replace(/[^a-z0-9]/g, "x");
    await getDb()
      .update(memberships)
      .set({ referralCode: code })
      .where(and(eq(memberships.id, membership.id), isNull(memberships.referralCode)));
  }
  revalidatePath(`/projects/${ctx.project.id}/results`);
}
