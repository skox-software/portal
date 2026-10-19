"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaff } from "@/lib/access";
import { getDb } from "@/lib/db";
import { clients, deals, memberships, projects, referrals } from "@/lib/db/schema";
import { eventInsert } from "@/lib/events";
import { todayIso } from "@/lib/format";
import { backWith } from "@/lib/http";
import { normalizeEmail } from "@/lib/permissions";
import { parseBrief, readBrief, type CallBrief } from "@/lib/call-brief";
import { followUpAfterCall, nextStepAfterCall, OUTCOMES, outcomeLabel, salesToday, stageAfterCall, type Outcome } from "@/lib/follow-up";
import { dedupeLeads, parseLeadSources } from "@/lib/pipeline-import";
import {
  columnLabel,
  DEAL_KINDS,
  dealStageForColumn,
  projectStatusForColumn,
  type ColumnKey,
} from "@/lib/pipeline";
import { staffOf } from "@/lib/staff-filter";
import { after } from "next/server";
import { creditProjectFromDeal, emailAssignedLeads, readRepField } from "@/lib/rep-assign";

/*
 * Pipeline moves write to whichever record the card is: a deal changes stage,
 * a project changes status (the same change as its status menu), and a
 * referral becomes a deal the first time it's worked. Every change records an
 * event in the same batch.
 */

const BACK = "/admin/pipeline";
const KINDS = DEAL_KINDS.map((k) => k.value) as [string, ...string[]];
const columnKey = z.enum(["lead", "initial_outreach", "proposal_sent", "negotiation", "won", "in_build", "shipped", "lost"]);

type MoveResult = { ok: true } | { ok: false; error: string };

async function staffEmails(workspaceId: string) {
  const rows = await getDb()
    .select({ email: memberships.email })
    .from(memberships)
    .where(staffOf(workspaceId));
  return new Set(rows.map((r) => r.email));
}

/** The board's filters, carried through a save so the view comes back as it was. */
function backTo(formData: FormData, extra: Record<string, string> = {}) {
  // Leads open from the Pipeline or from Clients; go back to whichever it was.
  const base = formData.get("base") === "/admin/clients" ? "/admin/clients" : BACK;
  const from = new URLSearchParams(String(formData.get("back") ?? "").replace(/^\?/, ""));
  const p = new URLSearchParams();
  for (const k of ["view", "q", "owner", "stage", "callable"]) {
    const v = from.get(k);
    if (v) p.set(k, v.slice(0, 200));
  }
  for (const [k, v] of Object.entries(extra)) p.set(k, v);
  const s = p.toString();
  return s ? `${base}?${s}` : base;
}

function refresh() {
  revalidatePath(BACK);
  revalidatePath("/admin/clients");
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
    db
      .update(deals)
      .set({ stage, stageChangedAt: new Date(), ...(stage === "won" && !deal.wonAt ? { wonAt: new Date() } : {}) })
      .where(eq(deals.id, deal.id)),
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
  stage: z.enum(["lead", "initial_outreach", "proposal_sent", "negotiation", "won", "lost"]),
  ownerEmail: z.string().trim().max(200),
  notes: z.string().trim().max(4000),
  industry: z.string().trim().max(80),
  location: z.string().trim().max(80),
  leadSource: z.string().trim().max(80),
  nextStep: z.string().trim().max(200),
  nextStepOn: z.union([z.literal(""), z.iso.date()]),
  preview: z.union([z.literal(""), z.url({ protocol: /^https?$/ }).max(300)]).optional(),
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
    nextStep: get("nextStep"),
    nextStepOn: get("nextStepOn"),
    preview: formData.has("preview") ? get("preview").trim() : undefined,
  });
}

/**
 * Brief lines typed or pasted into Notes ("ASK FOR: …") move into the brief,
 * so Notes keeps only the seller's own words. A preview link is kept on the brief too.
 */
function mergeBrief(existing: unknown, notes: string, preview: string | undefined, oldNotes?: string | null) {
  const pasted = parseBrief(notes);
  // A lead whose brief was never moved out of its notes keeps it on the first save.
  const base = readBrief(existing) ?? parseBrief(oldNotes).brief;
  let brief: CallBrief | null = base || pasted.brief ? { ...base, ...pasted.brief } : null;
  if (preview !== undefined && (brief || preview)) {
    brief = { ...brief };
    if (preview) brief.preview = preview;
    else delete brief.preview;
  }
  return { notes: pasted.rest || null, brief };
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
    nextStep: input.nextStep || null,
    nextStepOn: input.nextStepOn || null,
  };
}

export async function createDeal(formData: FormData) {
  const { viewer, staff } = await requireStaff();
  const parsed = readDeal(formData);
  if (!parsed.success) backWith(`${BACK}?new=1`, "error", "Give the deal a company name. Emails and websites must be valid.");
  const input = parsed.data;
  const owners = await staffEmails(staff.workspaceId);
  if (input.ownerEmail && !owners.has(input.ownerEmail)) backWith(`${BACK}?new=1`, "error", "The owner must be on the SKOX team.");
  const repField = await readRepField(formData, staff.workspaceId);
  if (!repField.ok) backWith(`${BACK}?new=1`, "error", "Pick a sales rep from the list.");

  const id = crypto.randomUUID();
  const db = getDb();
  await db.batch([
    db.insert(deals).values({
      id,
      workspaceId: staff.workspaceId,
      ...dealValues(input),
      ...mergeBrief(null, input.notes, input.preview),
      stage: input.stage,
      ownerEmail: input.ownerEmail || viewer.email,
      ...(repField.value ? { repMembershipId: repField.value, repSource: "assigned" } : {}),
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
  if (repField.value) {
    const repId = repField.value;
    after(() => emailAssignedLeads(repId, [id]).catch((error) => console.error("[pipeline] rep email failed", error)));
  }
  refresh();
  backWith(backTo(formData), "notice", `${input.company} added to ${input.stage === "lost" ? "lost deals" : columnLabel(input.stage)}.`);
}

export async function saveDeal(formData: FormData) {
  const { viewer, staff } = await requireStaff();
  const dealId = String(formData.get("dealId") ?? "");
  if (!z.uuid().safeParse(dealId).success) backWith(BACK, "error", "Unknown deal.");
  const back = backTo(formData, { deal: dealId });
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
    backWith(backTo(formData), "notice", `Removed ${deal.company} from the pipeline.`);
  }

  const parsed = readDeal(formData);
  if (!parsed.success) backWith(back, "error", "Give the deal a company name. Emails, websites and preview links must be valid.");
  const input = parsed.data;
  const owners = await staffEmails(staff.workspaceId);
  if (input.ownerEmail && !owners.has(input.ownerEmail)) backWith(back, "error", "The owner must be on the SKOX team.");
  const repField = await readRepField(formData, staff.workspaceId);
  if (!repField.ok) backWith(back, "error", "Pick a sales rep from the list.");
  const repChanged = repField.value !== undefined && repField.value !== deal.repMembershipId;
  // Once onboarded, the project owns the stage; the form's stage is ignored.
  const stage = deal.projectId ? deal.stage : input.stage;

  await db.batch([
    db
      .update(deals)
      .set({
        ...dealValues(input),
        ...mergeBrief(deal.brief, input.notes, input.preview, deal.notes),
        // A changed number gets a fresh chance.
        ...(deal.badNumber && (input.phone || null) !== deal.phone ? { badNumber: false } : {}),
        ownerEmail: input.ownerEmail || null,
        ...(repChanged ? { repMembershipId: repField.value ?? null, repSource: repField.value ? "assigned" : null } : {}),
        stage,
        lostReason: stage === "lost" ? String(formData.get("lostReason") ?? "").trim().slice(0, 300) || null : null,
        ...(stage !== deal.stage ? { stageChangedAt: new Date() } : {}),
        ...(stage === "won" && !deal.wonAt ? { wonAt: new Date() } : {}),
      })
      .where(eq(deals.id, deal.id)),
    eventInsert({
      workspaceId: staff.workspaceId,
      projectId: deal.projectId,
      actorId: viewer.userId,
      verb: "deal.updated",
      subjectType: "deal",
      subjectId: deal.id,
      payload: { company: input.company, ...(stage !== deal.stage ? { from: deal.stage, to: stage } : {}), ...(repChanged ? { rep: repField.value ?? null } : {}) },
    }),
  ]);
  if (repChanged && repField.value) {
    const repId = repField.value;
    await creditProjectFromDeal(deal.projectId, repId);
    after(() => emailAssignedLeads(repId, [deal.id]).catch((error) => console.error("[pipeline] rep email failed", error)));
  }
  refresh();
  const nextId = String(formData.get("nextId") ?? "");
  if (formData.get("intent") === "next" && z.uuid().safeParse(nextId).success) {
    backWith(backTo(formData, { deal: nextId }), "notice", `${input.company} saved.`);
  }
  backWith(backTo(formData), "notice", `${input.company} saved.`);
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
  const stage = z.enum(["lead", "initial_outreach", "proposal_sent", "negotiation"]).catch("lead").parse(formData.get("stage"));
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

/**
 * Logs a call or email in one step: stamps "last contacted", records the
 * outcome on the deal's history, moves a fresh lead to Initial outreach (or
 * closes it as not interested), flags a bad number, remembers the gatekeeper's
 * name and sets the follow-up (the outcome's default unless one was picked).
 */
export async function logCall(formData: FormData) {
  const { viewer, staff } = await requireStaff();
  const dealId = String(formData.get("dealId") ?? "");
  if (!z.uuid().safeParse(dealId).success) backWith(BACK, "error", "Unknown deal.");
  const back = backTo(formData, { deal: dealId });
  const parsed = z
    .object({
      outcome: z.enum(OUTCOMES.map((o) => o.value) as [Outcome, ...Outcome[]]),
      note: z.string().trim().max(1000),
      followUp: z.union([z.literal(""), z.iso.date()]),
      nextStep: z.string().trim().max(200),
      gatekeeper: z.string().trim().max(80),
    })
    .safeParse({
      outcome: formData.get("outcome"),
      note: String(formData.get("note") ?? ""),
      followUp: String(formData.get("followUp") ?? ""),
      nextStep: String(formData.get("nextStep") ?? ""),
      gatekeeper: String(formData.get("gatekeeper") ?? ""),
    });
  if (!parsed.success) backWith(back, "error", "Pick what happened on the call.");
  const { outcome, note, gatekeeper } = parsed.data;

  const db = getDb();
  const [deal] = await db
    .select()
    .from(deals)
    .where(and(eq(deals.id, dealId), eq(deals.workspaceId, staff.workspaceId)))
    .limit(1);
  if (!deal) backWith(BACK, "error", "That deal doesn't exist.");

  // Once onboarded, the project owns the stage.
  const stage = deal.projectId || deal.stage === "won" || deal.stage === "lost" ? deal.stage : stageAfterCall(deal.stage, outcome);
  const closed = stage === "lost";
  const followUp = closed ? null : followUpAfterCall(outcome, parsed.data.followUp, salesToday());
  // A typed next step wins, then the one already on the deal, unless a gatekeeper's name makes a better one.
  const auto = nextStepAfterCall(outcome, gatekeeper);
  // After a real conversation, only what was typed counts; the old "call back" step is done.
  const nextStep = !followUp ? null : parsed.data.nextStep || (outcome === "spoke" ? null : outcome === "gatekeeper" && gatekeeper ? auto : deal.nextStep || auto);
  const brief = readBrief(deal.brief) ?? parseBrief(deal.notes).brief;
  await db.batch([
    db
      .update(deals)
      .set({
        lastContactedAt: new Date(),
        stage,
        nextStepOn: followUp,
        nextStep,
        ...(outcome === "bad_number" ? { badNumber: true } : {}),
        ...(outcome === "gatekeeper" && gatekeeper ? { brief: { ...brief, gatekeeper } } : {}),
        ...(stage !== deal.stage ? { stageChangedAt: new Date() } : {}),
        ...(closed && deal.stage !== "lost" ? { lostReason: note || "Not interested" } : {}),
      })
      .where(eq(deals.id, deal.id)),
    eventInsert({
      workspaceId: staff.workspaceId,
      projectId: deal.projectId,
      actorId: viewer.userId,
      verb: "deal.call_logged",
      subjectType: "deal",
      subjectId: deal.id,
      payload: {
        company: deal.company,
        outcome,
        ...(note ? { note } : {}),
        ...(gatekeeper ? { gatekeeper } : {}),
        ...(followUp ? { followUp } : {}),
        ...(stage !== deal.stage ? { from: deal.stage, to: stage } : {}),
      },
    }),
  ]);
  refresh();
  const message = `${outcomeLabel(outcome)} logged for ${deal.company}${stage !== deal.stage ? ` · moved to ${stage === "lost" ? "Lost" : columnLabel(stage)}` : ""}${outcome === "bad_number" ? " · number flagged" : ""}.`;
  const nextId = String(formData.get("nextId") ?? "");
  if (formData.get("intent") === "next" && z.uuid().safeParse(nextId).success) backWith(backTo(formData, { deal: nextId }), "notice", message);
  backWith(back, "notice", message);
}

type BulkResult = { ok: true; count: number } | { ok: false; error: string };

/** Changes the stage, owner or follow-up of several deals at once. Onboarded deals keep their project's stage. */
export async function bulkUpdateDeals(input: { ids: string[]; stage?: string; ownerEmail?: string; nextStepOn?: string; repMembershipId?: string }): Promise<BulkResult> {
  const { viewer, staff } = await requireStaff();
  const parsed = z
    .object({
      ids: z.array(z.uuid()).min(1).max(500),
      stage: z.enum(["lead", "initial_outreach", "proposal_sent", "negotiation", "won", "lost"]).optional(),
      ownerEmail: z.string().trim().max(200).optional(),
      nextStepOn: z.union([z.literal(""), z.iso.date()]).optional(),
      repMembershipId: z.union([z.literal(""), z.uuid()]).optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Pick some deals and a change to make." };
  const { ids, stage, nextStepOn } = parsed.data;
  const ownerEmail = parsed.data.ownerEmail === undefined ? undefined : normalizeEmail(parsed.data.ownerEmail);
  if (ownerEmail && !(await staffEmails(staff.workspaceId)).has(ownerEmail)) return { ok: false, error: "The owner must be on the SKOX team." };
  const repId = parsed.data.repMembershipId;
  if (repId) {
    const fd = new FormData();
    fd.set("repMembershipId", repId);
    const check = await readRepField(fd, staff.workspaceId);
    if (!check.ok) return { ok: false, error: "Pick a sales rep from the list." };
  }
  if (stage === undefined && ownerEmail === undefined && nextStepOn === undefined && repId === undefined) return { ok: false, error: "Choose what to change." };

  const db = getDb();
  const rows = await db
    .select({ id: deals.id, stage: deals.stage, projectId: deals.projectId, wonAt: deals.wonAt, rep: deals.repMembershipId })
    .from(deals)
    .where(and(eq(deals.workspaceId, staff.workspaceId), inArray(deals.id, ids)));
  if (!rows.length) return { ok: false, error: "Those deals don't exist." };
  const now = new Date();
  const writes = rows.map((d) => {
    const nextStage = stage && !d.projectId && stage !== d.stage ? stage : undefined;
    return db
      .update(deals)
      .set({
        ...(nextStage ? { stage: nextStage, stageChangedAt: now, ...(nextStage === "won" && !d.wonAt ? { wonAt: now } : {}) } : {}),
        ...(ownerEmail !== undefined ? { ownerEmail: ownerEmail || null } : {}),
        ...(nextStepOn !== undefined ? { nextStepOn: nextStepOn || null } : {}),
        ...(repId !== undefined && (repId || null) !== d.rep ? { repMembershipId: repId || null, repSource: repId ? "assigned" : null } : {}),
      })
      .where(eq(deals.id, d.id));
  });
  await db.batch([
    writes[0],
    ...writes.slice(1),
    eventInsert({
      workspaceId: staff.workspaceId,
      actorId: viewer.userId,
      verb: "deal.bulk_updated",
      subjectType: "deal",
      subjectId: null,
      payload: { count: rows.length, ...(stage ? { stage } : {}), ...(ownerEmail !== undefined ? { ownerEmail } : {}), ...(nextStepOn !== undefined ? { nextStepOn } : {}), ...(repId !== undefined ? { rep: repId || null } : {}) },
    }),
  ]);
  if (repId) {
    const fresh = rows.filter((d) => d.rep !== repId);
    for (const d of fresh) await creditProjectFromDeal(d.projectId, repId);
    after(() => emailAssignedLeads(repId, fresh.map((d) => d.id)).catch((error) => console.error("[pipeline] rep email failed", error)));
  }
  refresh();
  return { ok: true, count: rows.length };
}

/** A "no thanks" reply, recorded by hand: the same opt-out the unsubscribe link sets. One-way on purpose. */
export async function markDoNotEmail(formData: FormData) {
  const { viewer, staff } = await requireStaff();
  const dealId = String(formData.get("dealId") ?? "");
  if (!z.uuid().safeParse(dealId).success) backWith(BACK, "error", "Unknown deal.");
  const back = backTo(formData, { deal: dealId });
  const db = getDb();
  const where = and(eq(deals.id, dealId), eq(deals.workspaceId, staff.workspaceId), eq(deals.doNotEmail, false));
  const [deal] = await db.select({ id: deals.id, projectId: deals.projectId }).from(deals).where(where).limit(1);
  if (!deal) backWith(back, "notice", "Already marked do not email.");
  await db.batch([
    db.update(deals).set({ doNotEmail: true }).where(where),
    eventInsert({ workspaceId: staff.workspaceId, projectId: deal.projectId, actorId: viewer.userId, verb: "deal.unsubscribed", subjectType: "deal", subjectId: deal.id, payload: { via: "staff" } }),
  ]);
  revalidatePath(BACK);
  backWith(back, "notice", "Marked do not email. No email can be sent to this contact.");
}
