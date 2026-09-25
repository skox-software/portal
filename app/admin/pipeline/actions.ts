"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaff } from "@/lib/access";
import { getDb } from "@/lib/db";
import { clients, deals, memberships, projects, referrals } from "@/lib/db/schema";
import { eventInsert } from "@/lib/events";
import { todayIso } from "@/lib/format";
import { backWith } from "@/lib/http";
import { normalizeEmail } from "@/lib/permissions";
import { dedupeLeads, parseLeadSources } from "@/lib/pipeline-import";
import {
  columnLabel,
  DEAL_KINDS,
  dealStageForColumn,
  projectStatusForColumn,
  type ColumnKey,
} from "@/lib/pipeline";

/*
 * Pipeline moves write to whichever record the card is: a deal changes stage,
 * a project changes status (the same change as its status menu), and a
 * referral becomes a deal the first time it's worked. Every change records an
 * event in the same batch.
 */

const BACK = "/admin/pipeline";
const KINDS = DEAL_KINDS.map((k) => k.value) as [string, ...string[]];
const columnKey = z.enum(["lead", "proposal_sent", "negotiation", "won", "in_build", "shipped", "lost"]);

type MoveResult = { ok: true } | { ok: false; error: string };

async function staffEmails(workspaceId: string) {
  const rows = await getDb()
    .select({ email: memberships.email })
    .from(memberships)
    .where(and(eq(memberships.workspaceId, workspaceId), isNull(memberships.clientId)));
  return new Set(rows.map((r) => r.email));
}

function refresh() {
  revalidatePath(BACK);
  revalidatePath("/admin");
}

export async function moveCard(type: string, id: string, to: string): Promise<MoveResult> {
  const { viewer, staff } = await requireStaff();
  const parsed = z
    .object({ type: z.enum(["deal", "project", "referral"]), id: z.uuid(), to: columnKey })
    .safeParse({ type, id, to });
  if (!parsed.success) return { ok: false, error: "That move isn't possible." };
  const { workspaceId } = staff;
  const db = getDb();
  const column = parsed.data.to as ColumnKey | "lost";

  if (parsed.data.type === "project") {
    const status = column === "lost" ? null : projectStatusForColumn(column);
    if (!status) return { ok: false, error: "A project is already won. Move it between Won, In build and Shipped." };
    const [project] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, parsed.data.id), eq(projects.workspaceId, workspaceId)))
      .limit(1);
    if (!project) return { ok: false, error: "That project doesn't exist." };
    if (project.status === status || (status === "building" && ["review", "paused"].includes(project.status))) {
      return { ok: true };
    }
    await db.batch([
      db
        .update(projects)
        .set({ status, ...(status === "launched" && !project.launchedOn ? { launchedOn: todayIso() } : {}) })
        .where(eq(projects.id, project.id)),
      db.update(deals).set({ stageChangedAt: new Date() }).where(eq(deals.projectId, project.id)),
      eventInsert({
        workspaceId,
        projectId: project.id,
        actorId: viewer.userId,
        verb: "project.status_changed",
        subjectType: "project",
        subjectId: project.id,
        payload: { from: project.status, to: status, via: "pipeline" },
      }),
    ]);
    refresh();
    revalidatePath(`/admin/projects/${project.id}`);
    return { ok: true };
  }

  const stage = dealStageForColumn(column);
  if (!stage) return { ok: false, error: "Start onboarding from the Won column to turn a deal into a build." };

  if (parsed.data.type === "referral") {
    const [referral] = await db
      .select()
      .from(referrals)
      .where(and(eq(referrals.id, parsed.data.id), eq(referrals.workspaceId, workspaceId)))
      .limit(1);
    if (!referral) return { ok: false, error: "That referral doesn't exist." };
    const dealId = crypto.randomUUID();
    const referralStatus = stage === "won" ? "won" : stage === "lost" ? "lost" : "contacted";
    await db.batch([
      db
        .insert(deals)
        .values({
          id: dealId,
          workspaceId,
          company: referral.company || referral.name,
          contactName: referral.name,
          contactEmail: referral.email,
          stage,
          source: "referral",
          referralId: referral.id,
          notes: referral.idea,
          ownerEmail: viewer.email,
          createdBy: viewer.userId,
        })
        .onConflictDoNothing(),
      db.update(referrals).set({ status: referralStatus }).where(eq(referrals.id, referral.id)),
      eventInsert({
        workspaceId,
        actorId: viewer.userId,
        verb: "deal.created",
        subjectType: "deal",
        subjectId: dealId,
        payload: { from: "referral", referralId: referral.id, stage },
      }),
    ]);
    refresh();
    return { ok: true };
  }

  const [deal] = await db
    .select()
    .from(deals)
    .where(and(eq(deals.id, parsed.data.id), eq(deals.workspaceId, workspaceId)))
    .limit(1);
  if (!deal) return { ok: false, error: "That deal doesn't exist." };
  if (deal.stage === stage) return { ok: true };
  await db.batch([
    db.update(deals).set({ stage, stageChangedAt: new Date() }).where(eq(deals.id, deal.id)),
    ...(deal.referralId && (stage === "won" || stage === "lost")
      ? [db.update(referrals).set({ status: stage }).where(eq(referrals.id, deal.referralId))]
      : []),
    eventInsert({
      workspaceId,
      actorId: viewer.userId,
      verb: "deal.stage_changed",
      subjectType: "deal",
      subjectId: deal.id,
      payload: { company: deal.company, from: deal.stage, to: stage },
    }),
  ]);
  refresh();
  return { ok: true };
}

const dealFields = z.object({
  company: z.string().trim().min(1).max(120),
  contactName: z.string().trim().max(120),
  contactEmail: z.union([z.literal(""), z.email().max(200)]),
  phone: z.string().trim().max(40),
  website: z.union([z.literal(""), z.url({ protocol: /^https?$/ }).max(300)]),
  kind: z.enum(KINDS),
  value: z.union([z.literal(""), z.coerce.number().min(0).max(10_000_000)]),
  stage: z.enum(["lead", "proposal_sent", "negotiation", "won", "lost"]),
  ownerEmail: z.string().trim().max(200),
  notes: z.string().trim().max(4000),
  industry: z.string().trim().max(80),
  location: z.string().trim().max(80),
  leadSource: z.string().trim().max(80),
});

function readDeal(formData: FormData) {
  const get = (k: string) => String(formData.get(k) ?? "");
  return dealFields.safeParse({
    company: get("company"),
    contactName: get("contactName"),
    contactEmail: normalizeEmail(get("contactEmail")),
    phone: get("phone"),
    website: get("website").trim(),
    kind: get("kind") || "web-app",
    value: get("value").replace(/[$,\s]/g, ""),
    stage: get("stage") || "lead",
    ownerEmail: normalizeEmail(get("ownerEmail")),
    notes: get("notes"),
    industry: get("industry"),
    location: get("location"),
    leadSource: get("leadSource"),
  });
}

function dealValues(input: z.infer<typeof dealFields>) {
  return {
    company: input.company,
    contactName: input.contactName || null,
    contactEmail: input.contactEmail || null,
    phone: input.phone || null,
    website: input.website || null,
    kind: input.kind,
    valueCents: input.value === "" ? null : Math.round(input.value * 100),
    notes: input.notes || null,
    industry: input.industry || null,
    location: input.location || null,
    leadSource: input.leadSource || null,
  };
}

export async function createDeal(formData: FormData) {
  const { viewer, staff } = await requireStaff();
  const parsed = readDeal(formData);
  if (!parsed.success) backWith(`${BACK}?new=1`, "error", "Give the deal a company name. Emails and websites must be valid.");
  const input = parsed.data;
  const owners = await staffEmails(staff.workspaceId);
  if (input.ownerEmail && !owners.has(input.ownerEmail)) backWith(`${BACK}?new=1`, "error", "The owner must be on the SKOX team.");

  const id = crypto.randomUUID();
  const db = getDb();
  await db.batch([
    db.insert(deals).values({
      id,
      workspaceId: staff.workspaceId,
      ...dealValues(input),
      stage: input.stage,
      ownerEmail: input.ownerEmail || viewer.email,
      createdBy: viewer.userId,
    }),
    eventInsert({
      workspaceId: staff.workspaceId,
      actorId: viewer.userId,
      verb: "deal.created",
      subjectType: "deal",
      subjectId: id,
      payload: { company: input.company, stage: input.stage },
    }),
  ]);
  refresh();
  backWith(BACK, "notice", `${input.company} added to ${input.stage === "lost" ? "lost deals" : columnLabel(input.stage)}.`);
}

export async function saveDeal(formData: FormData) {
  const { viewer, staff } = await requireStaff();
  const dealId = String(formData.get("dealId") ?? "");
  if (!z.uuid().safeParse(dealId).success) backWith(BACK, "error", "Unknown deal.");
  const back = `${BACK}?deal=${dealId}`;
  const db = getDb();
  const [deal] = await db
    .select()
    .from(deals)
    .where(and(eq(deals.id, dealId), eq(deals.workspaceId, staff.workspaceId)))
    .limit(1);
  if (!deal) backWith(BACK, "error", "That deal doesn't exist.");

  if (formData.get("intent") === "delete") {
    await db.batch([
      db.delete(deals).where(eq(deals.id, deal.id)),
      eventInsert({
        workspaceId: staff.workspaceId,
        projectId: deal.projectId,
        actorId: viewer.userId,
        verb: "deal.deleted",
        subjectType: "deal",
        subjectId: deal.id,
        payload: { company: deal.company },
      }),
    ]);
    refresh();
    backWith(BACK, "notice", `Removed ${deal.company} from the pipeline.`);
  }

  const parsed = readDeal(formData);
  if (!parsed.success) backWith(back, "error", "Give the deal a company name. Emails and websites must be valid.");
  const input = parsed.data;
  const owners = await staffEmails(staff.workspaceId);
  if (input.ownerEmail && !owners.has(input.ownerEmail)) backWith(back, "error", "The owner must be on the SKOX team.");
  // Once onboarded, the project owns the stage; the form's stage is ignored.
  const stage = deal.projectId ? deal.stage : input.stage;

  await db.batch([
    db
      .update(deals)
      .set({
        ...dealValues(input),
        ownerEmail: input.ownerEmail || null,
        stage,
        lostReason: stage === "lost" ? String(formData.get("lostReason") ?? "").trim().slice(0, 300) || null : null,
        ...(stage !== deal.stage ? { stageChangedAt: new Date() } : {}),
      })
      .where(eq(deals.id, deal.id)),
    eventInsert({
      workspaceId: staff.workspaceId,
      projectId: deal.projectId,
      actorId: viewer.userId,
      verb: "deal.updated",
      subjectType: "deal",
      subjectId: deal.id,
      payload: { company: input.company, ...(stage !== deal.stage ? { from: deal.stage, to: stage } : {}) },
    }),
  ]);
  refresh();
  backWith(BACK, "notice", `${input.company} saved.`);
}

/** Gives an existing project an owner and agreed value by creating its deal. */
export async function claimProject(formData: FormData) {
  const { viewer, staff } = await requireStaff();
  const projectId = String(formData.get("projectId") ?? "");
  if (!z.uuid().safeParse(projectId).success) backWith(BACK, "error", "Unknown project.");
  const db = getDb();
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.workspaceId, staff.workspaceId)))
    .limit(1);
  if (!project) backWith(BACK, "error", "That project doesn't exist.");
  const [existing] = await db.select({ id: deals.id }).from(deals).where(eq(deals.projectId, project.id)).limit(1);
  if (existing) backWith(`${BACK}?deal=${existing.id}`, "notice", "Edit the deal behind this project.");

  const id = crypto.randomUUID();
  const [client] = await db.select({ name: clients.name }).from(clients).where(eq(clients.id, project.clientId)).limit(1);
  await db.batch([
    db.insert(deals).values({
      id,
      workspaceId: staff.workspaceId,
      company: client?.name ?? project.name,
      kind: KINDS.includes(project.kind) ? project.kind : "other",
      stage: "won",
      ownerEmail: viewer.email,
      clientId: project.clientId,
      projectId: project.id,
      stageChangedAt: project.createdAt,
      createdBy: viewer.userId,
    }),
    eventInsert({
      workspaceId: staff.workspaceId,
      projectId: project.id,
      actorId: viewer.userId,
      verb: "deal.created",
      subjectType: "deal",
      subjectId: id,
      payload: { from: "project" },
    }),
  ]);
  refresh();
  backWith(`${BACK}?deal=${id}`, "notice", "Set the owner, contact and agreed value for this project.");
}

/**
 * Adds many leads at once from pasted rows or an uploaded CSV. Rows that are
 * already in the pipeline (same company or email), or are existing clients,
 * are skipped rather than duplicated.
 */
export async function bulkAddDeals(formData: FormData) {
  const { viewer, staff } = await requireStaff();
  const back = `${BACK}?import=1`;
  const file = formData.get("file");
  const pasted = String(formData.get("rows") ?? "");
  let fileText = "";
  if (file instanceof File && file.size > 0) {
    if (file.size > 900_000) backWith(back, "error", "That file is over 900 KB. Split it into smaller files.");
    fileText = await file.text();
  }
  const stage = z.enum(["lead", "proposal_sent", "negotiation"]).catch("lead").parse(formData.get("stage"));
  const ownerEmail = normalizeEmail(String(formData.get("ownerEmail") ?? ""));
  if (ownerEmail && !(await staffEmails(staff.workspaceId)).has(ownerEmail)) {
    backWith(back, "error", "The owner must be on the SKOX team.");
  }

  const { drafts, skipped, truncated } = parseLeadSources(fileText, pasted);
  if (!drafts.length) {
    backWith(back, "error", skipped.length ? "None of those rows had a company name." : "Paste some leads or choose a CSV file first.");
  }

  const db = getDb();
  const [existingDeals, existingClients] = await Promise.all([
    db.select({ company: deals.company, email: deals.contactEmail }).from(deals).where(eq(deals.workspaceId, staff.workspaceId)),
    db.select({ company: clients.name }).from(clients).where(eq(clients.workspaceId, staff.workspaceId)),
  ]);
  const { fresh, duplicates } = dedupeLeads(drafts, [
    ...existingDeals,
    ...existingClients.map((c) => ({ company: c.company, email: null })),
  ]);

  if (fresh.length) {
    const now = new Date();
    const rows = fresh.map((d) => ({
      workspaceId: staff.workspaceId,
      ...d,
      stage,
      source: "import",
      ownerEmail: ownerEmail || null,
      stageChangedAt: now,
      createdBy: viewer.userId,
    }));
    await db.batch([
      db.insert(deals).values(rows),
      eventInsert({
        workspaceId: staff.workspaceId,
        actorId: viewer.userId,
        verb: "deal.imported",
        subjectType: "deal",
        payload: { added: fresh.length, duplicates: duplicates.length, skipped: skipped.length, stage },
      }),
    ]);
    refresh();
  }

  const parts = [`Added ${fresh.length} ${fresh.length === 1 ? "lead" : "leads"} to ${columnLabel(stage)}.`];
  if (duplicates.length) {
    const names = duplicates.slice(0, 3).join(", ") + (duplicates.length > 3 ? ` and ${duplicates.length - 3} more` : "");
    parts.push(`Skipped ${duplicates.length} already in the pipeline (${names}).`);
  }
  if (skipped.length) parts.push(`Skipped ${skipped.length} ${skipped.length === 1 ? "row" : "rows"} with no company name.`);
  if (truncated) parts.push("Only the first 500 rows were read.");
  backWith(fresh.length ? BACK : back, fresh.length ? "notice" : "error", parts.join(" "));
}
