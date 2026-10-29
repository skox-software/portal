"use server";

import { suppressOutreach } from "@/lib/cold-outreach";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaff } from "@/lib/access";
import { getDb } from "@/lib/db";
import { clients, deals, memberships, projects, referrals, type Deal } from "@/lib/db/schema";
import { eventInsert } from "@/lib/events";
import { todayIso } from "@/lib/format";
import { backWith } from "@/lib/http";
import { normalizeEmail } from "@/lib/permissions";
import { parseBrief, readBrief, type CallBrief } from "@/lib/call-brief";
import { advanceAfterCall, callEffect, followUpAfterCall, nextStepAfterCall, OUTCOMES, outcomeLabel, salesToday, type Outcome } from "@/lib/follow-up";
import { dedupeLeads, parseLeadSources } from "@/lib/pipeline-import";
import {
  canDemote,
  CLOSE_REASONS,
  crossesTracks,
  DEAL_KINDS,
  dealStageForColumn,
  demotedStage,
  FIRST_STAGE,
  NOT_INTERESTED_REASONS,
  OPEN_STAGES,
  PICKABLE_SIGNALS,
  PREVIEW_DECISIONS,
  previewInFlight,
  projectStatusForColumn,
  signalLabel,
  STAGES,
  stageLabel,
  statusAfterDecision,
  trackOf,
  type CloseReason,
  type ColumnKey,
  type DealStage,
  type PromotionSignal,
} from "@/lib/pipeline";
import { promotionWrites } from "@/lib/promotion-server";
import { isPreviewLink } from "@/lib/preview-build-prompt";
import { notifyPreviewRequested } from "@/lib/preview-request";
import { attemptCount } from "@/lib/attempts-server";
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
const BASES = ["/admin/pipeline", "/admin/leads", "/admin/clients"] as const;
const KINDS = DEAL_KINDS.map((k) => k.value) as [string, ...string[]];
const stageKey = z.enum(STAGES);
const columnKey = z.enum([...STAGES, "in_build", "shipped"]);

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
  // Leads open from Outreach, the Pipeline or Clients; go back to whichever it was.
  const base = BASES.find((b) => b === formData.get("base")) ?? BACK;
  const from = new URLSearchParams(String(formData.get("back") ?? "").replace(/^\?/, ""));
  const p = new URLSearchParams();
  for (const k of ["view", "q", "owner", "stage", "callable", "show"]) {
    const v = from.get(k);
    if (v) p.set(k, v.slice(0, 200));
  }
  for (const [k, v] of Object.entries(extra)) p.set(k, v);
  const s = p.toString();
  return s ? `${base}?${s}` : base;
}

function refresh() {
  revalidatePath(BACK);
  revalidatePath("/admin/leads");
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
  if (stage === "outreach_closed") return { ok: false, error: "Open the lead and pick why outreach closed, so the reason is kept." };

  if (parsed.data.type === "referral") {
    if (trackOf(stage) !== "outreach") return { ok: false, error: "Work the referral first. It moves to the Pipeline when they show interest." };
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
  if (crossesTracks(deal.stage, stage)) {
    return { ok: false, error: trackOf(stage) === "active" ? "Use Promote on the lead and say what they did. Calls and emails alone don't make a deal." : "Use Send back to Outreach on the deal and say why." };
  }
  await db.batch([
    db
      .update(deals)
      .set({
        stage,
        stageChangedAt: new Date(),
        ...(stage === "won" && !deal.wonAt ? { wonAt: new Date() } : {}),
        // Reopened: the old reason for closing no longer applies.
        ...(deal.stage === "outreach_closed" ? { closeReason: null, closeDetail: null } : {}),
      })
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
  stage: stageKey,
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
    stage: get("stage") || FIRST_STAGE,
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

/** The contact details a save changed, old and new, so the lead's history shows "Phone changed". */
const CONTACT_FIELDS = [
  ["company", "Name"],
  ["contactName", "Contact"],
  ["contactEmail", "Email"],
  ["phone", "Phone"],
  ["website", "Website"],
] as const;

function contactChanges(before: Record<(typeof CONTACT_FIELDS)[number][0], string | null>, after: ReturnType<typeof dealValues>) {
  return CONTACT_FIELDS.filter(([key]) => (before[key] ?? null) !== (after[key] ?? null)).map(([key, label]) => ({
    field: label,
    from: before[key] ?? null,
    to: after[key] ?? null,
  }));
}

export async function createDeal(formData: FormData) {
  const { viewer, staff } = await requireStaff();
  const parsed = readDeal(formData);
  if (!parsed.success) backWith(`${BACK}?new=1`, "error", "Give the deal a company name. Emails and websites must be valid.");
  const input = parsed.data;
  if (input.stage === "outreach_closed") backWith(`${BACK}?new=1`, "error", "Add the lead to an attempt, then close it with a reason.");
  const owners = await staffEmails(staff.workspaceId);
  if (input.ownerEmail && !owners.has(input.ownerEmail)) backWith(`${BACK}?new=1`, "error", "The owner must be on the UnBusy team.");
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
      // Added straight to the Pipeline: someone already knows it's a real opportunity.
      ...(trackOf(input.stage) === "active" ? { promotedAt: new Date(), promotedSignal: "direct" } : {}),
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
  backWith(backTo(formData), "notice", `${input.company} added to ${input.stage === "lost" ? "lost deals" : stageLabel(input.stage)}.`);
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
  if (input.ownerEmail && !owners.has(input.ownerEmail)) backWith(back, "error", "The owner must be on the UnBusy team.");
  const repField = await readRepField(formData, staff.workspaceId);
  if (!repField.ok) backWith(back, "error", "Pick a sales rep from the list.");
  const repChanged = repField.value !== undefined && repField.value !== deal.repMembershipId;
  // Once onboarded, the project owns the stage; the form's stage is ignored.
  // The lead panel moves stages with its own buttons, so a form without a stage field keeps the current one.
  const stage = deal.projectId || !formData.has("stage") || crossesTracks(deal.stage, input.stage) || input.stage === "outreach_closed" ? deal.stage : input.stage;
  // Fields the lead panel no longer shows (notes, next step, follow-up date) are kept unless the form sent them.
  const values = dealValues(input);
  const sent = (key: string) => formData.has(key);
  const kept = {
    ...(sent("notes") ? {} : { notes: deal.notes }),
    ...(sent("nextStep") ? {} : { nextStep: deal.nextStep }),
    ...(sent("nextStepOn") ? {} : { nextStepOn: deal.nextStepOn }),
  };
  const changed = contactChanges(deal, values);

  await db.batch([
    db
      .update(deals)
      .set({
        ...values,
        ...(sent("notes") || input.preview !== undefined ? mergeBrief(deal.brief, sent("notes") ? input.notes : (deal.notes ?? ""), input.preview, deal.notes) : {}),
        ...kept,
        // A changed number gets a fresh chance.
        ...(deal.badNumber && (input.phone || null) !== deal.phone ? { badNumber: false } : {}),
        ownerEmail: input.ownerEmail || null,
        ...(repChanged ? { repMembershipId: repField.value ?? null, repSource: repField.value ? "assigned" : null } : {}),
        stage,
        lostReason: stage !== "lost" ? null : sent("lostReason") ? String(formData.get("lostReason") ?? "").trim().slice(0, 300) || null : deal.lostReason,
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
      payload: {
        company: input.company,
        ...(stage !== deal.stage ? { from: deal.stage, to: stage } : {}),
        ...(repChanged ? { rep: repField.value ?? null } : {}),
        ...(changed.length ? { changed } : {}),
      },
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
  const stage = z.enum(OPEN_STAGES as [DealStage, ...DealStage[]]).catch(FIRST_STAGE).parse(formData.get("stage"));
  const ownerEmail = normalizeEmail(String(formData.get("ownerEmail") ?? ""));
  if (ownerEmail && !(await staffEmails(staff.workspaceId)).has(ownerEmail)) {
    backWith(back, "error", "The owner must be on the UnBusy team.");
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

  const parts = [`Added ${fresh.length} ${fresh.length === 1 ? "lead" : "leads"} to ${stageLabel(stage)}.`];
  if (duplicates.length) {
    const names = duplicates.slice(0, 3).join(", ") + (duplicates.length > 3 ? ` and ${duplicates.length - 3} more` : "");
    parts.push(`Skipped ${duplicates.length} already in the pipeline (${names}).`);
  }
  if (skipped.length) parts.push(`Skipped ${skipped.length} ${skipped.length === 1 ? "row" : "rows"} with no company name.`);
  if (truncated) parts.push("Only the first 500 rows were read.");
  backWith(fresh.length ? BACK : back, fresh.length ? "notice" : "error", parts.join(" "));
}

/**
 * Logs a contact attempt, a note, or both, and can move the lead on in the
 * same step ("Save & move to Attempt 2"). Every save becomes a line in the
 * lead's history: a call with its outcome and note, or a note on its own.
 *
 * Calls and emails never promote. What they said does (lib/follow-up.ts
 * callEffect): "Interested" and "Preview requested" promote an Outreach lead
 * to the Pipeline, "Preview requested" also queues the preview, and "Not
 * interested" closes outreach with the reason chip picked. A bad number is
 * flagged, and the follow-up is the outcome's default unless one was picked.
 */
export async function logCall(formData: FormData) {
  const { viewer, staff } = await requireStaff();
  const dealId = String(formData.get("dealId") ?? "");
  if (!z.uuid().safeParse(dealId).success) backWith(BACK, "error", "Unknown deal.");
  const back = backTo(formData, { deal: dealId });
  const parsed = z
    .object({
      outcome: z.union([z.literal(""), z.enum(OUTCOMES.map((o) => o.value) as [Outcome, ...Outcome[]])]),
      note: z.string().trim().max(2000),
      followUp: z.union([z.literal(""), z.iso.date()]),
      nextStep: z.string().trim().max(200),
      gatekeeper: z.string().trim().max(80),
      reason: z.union([z.literal(""), z.enum(NOT_INTERESTED_REASONS.map((r) => r.value) as [string, ...string[]])]),
    })
    .safeParse({
      outcome: String(formData.get("outcome") ?? ""),
      note: String(formData.get("note") ?? ""),
      followUp: String(formData.get("followUp") ?? ""),
      nextStep: String(formData.get("nextStep") ?? ""),
      gatekeeper: String(formData.get("gatekeeper") ?? ""),
      reason: String(formData.get("reason") ?? ""),
    });
  if (!parsed.success) backWith(back, "error", "Pick what happened, or write a note.");
  const { note, gatekeeper } = parsed.data;
  const outcome = parsed.data.outcome || null;
  const reason = outcome === "not_interested" ? parsed.data.reason || null : null;
  const advance = formData.get("intent") === "advance";
  if (!outcome && !note && !advance) backWith(back, "error", "Pick what happened, or write a note.");

  const db = getDb();
  const [deal] = await db
    .select()
    .from(deals)
    .where(and(eq(deals.id, dealId), eq(deals.workspaceId, staff.workspaceId)))
    .limit(1);
  if (!deal) backWith(BACK, "error", "That deal doesn't exist.");

  // Once onboarded, the project owns the stage.
  const settled = !!deal.projectId || deal.stage === "won" || deal.stage === "lost";
  const effect = settled || !outcome ? { stage: deal.stage, signal: null, closeReason: null } : callEffect(deal.stage, outcome);
  let stage: DealStage = effect.stage;
  if (advance && !settled && stage === deal.stage) stage = advanceAfterCall(deal.stage, outcome) ?? stage;
  const now = new Date();
  // A promotion writes its own stage, timestamps and event.
  const promotion = effect.signal ? promotionWrites(deal, effect.signal, viewer.userId, now, { via: "call" }) : null;
  const moved = stage !== deal.stage;
  const writes = [] as Parameters<typeof db.batch>[0][number][];
  const requestPreview = outcome === "preview" && !previewInFlight(deal.previewStatus);

  if (outcome) {
    const closed = stage === "outreach_closed";
    const followUp = closed ? null : followUpAfterCall(outcome, parsed.data.followUp, salesToday());
    // A typed next step wins, then the one already on the deal, unless a gatekeeper's name makes a better one.
    const auto = nextStepAfterCall(outcome, gatekeeper);
    // After a real conversation, only what was typed counts; the old "call back" step is done.
    const fresh = outcome === "spoke" || outcome === "interested" || outcome === "preview";
    const nextStep = !followUp ? null : parsed.data.nextStep || (fresh ? (outcome === "spoke" ? null : auto) : outcome === "gatekeeper" && gatekeeper ? auto : deal.nextStep || auto);
    const brief = readBrief(deal.brief) ?? parseBrief(deal.notes).brief;
    writes.push(
      db
        .update(deals)
        .set({
          lastContactedAt: now,
          ...(promotion ? {} : { stage }),
          nextStepOn: followUp,
          nextStep,
          ...(outcome === "bad_number" ? { badNumber: true } : {}),
          ...(outcome === "gatekeeper" && gatekeeper ? { brief: { ...brief, gatekeeper } } : {}),
          ...(moved && !promotion ? { stageChangedAt: now } : {}),
          ...(effect.closeReason ? { closeReason: effect.closeReason, closeDetail: reason } : {}),
          ...(requestPreview ? { previewStatus: "requested" as const, previewRequestedAt: now, previewDecision: null } : {}),
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
          ...(reason ? { reason } : {}),
          ...(followUp ? { followUp } : {}),
          ...(moved ? { from: deal.stage, to: stage } : {}),
        },
      }),
      ...(promotion?.writes ?? []),
      ...(effect.closeReason ? [closeEvent(deal, viewer.userId, effect.closeReason, reason, "call")] : []),
      ...(requestPreview ? [previewEvent(deal, viewer.userId, "requested", { via: "call" })] : []),
    );
  } else {
    if (note) {
      writes.push(
        eventInsert({
          workspaceId: staff.workspaceId,
          projectId: deal.projectId,
          actorId: viewer.userId,
          verb: "deal.note_added",
          subjectType: "deal",
          subjectId: deal.id,
          payload: { company: deal.company, note },
        }),
      );
    }
    if (moved) {
      writes.push(
        db.update(deals).set({ stage, stageChangedAt: now }).where(eq(deals.id, deal.id)),
        eventInsert({
          workspaceId: staff.workspaceId,
          actorId: viewer.userId,
          verb: "deal.stage_changed",
          subjectType: "deal",
          subjectId: deal.id,
          payload: { company: deal.company, from: deal.stage, to: stage },
        }),
      );
    }
  }
  if (!writes.length) backWith(back, "notice", "Nothing to save.");
  await db.batch(writes as [(typeof writes)[number], ...(typeof writes)[number][]]);
  if (requestPreview) notifyPreviewRequested(deal, viewer.email, note || null);
  refresh();
  const what = outcome ? `${outcomeLabel(outcome)} logged` : note ? "Note saved" : "Saved";
  const where = promotion ? ` · promoted to the Pipeline (${stageLabel(stage)})` : moved ? ` · moved to ${stageLabel(stage)}` : "";
  const message = `${what} for ${deal.company}${where}${outcome === "preview" ? " · preview queued" : ""}${outcome === "bad_number" ? " · number flagged" : ""}.`;
  const nextId = String(formData.get("nextId") ?? "");
  if (formData.get("then") === "next" && z.uuid().safeParse(nextId).success) backWith(backTo(formData, { deal: nextId }), "notice", message);
  backWith(back, "notice", message);
}

function closeEvent(deal: Pick<Deal, "id" | "workspaceId" | "company" | "projectId" | "stage">, actorId: string, reason: CloseReason, detail: string | null, via: string) {
  return eventInsert({
    workspaceId: deal.workspaceId,
    projectId: deal.projectId,
    actorId,
    verb: "deal.outreach_closed",
    subjectType: "deal",
    subjectId: deal.id,
    payload: { company: deal.company, from: deal.stage, reason, ...(detail ? { detail } : {}), via },
  });
}

function previewEvent(deal: Pick<Deal, "id" | "workspaceId" | "company" | "projectId" | "previewStatus">, actorId: string, to: string, extra: Record<string, unknown> = {}) {
  return eventInsert({
    workspaceId: deal.workspaceId,
    projectId: deal.projectId,
    actorId,
    verb: "deal.preview_updated",
    subjectType: "deal",
    subjectId: deal.id,
    payload: { company: deal.company, from: deal.previewStatus, to, ...extra },
  });
}

/** Loads a deal in the signed-in team's workspace for one of the panel's actions, or goes back with an error. */
async function panelDeal(formData: FormData) {
  const { viewer, staff } = await requireStaff();
  const dealId = String(formData.get("dealId") ?? "");
  if (!z.uuid().safeParse(dealId).success) backWith(BACK, "error", "Unknown deal.");
  const back = backTo(formData, { deal: dealId });
  const [deal] = await getDb()
    .select()
    .from(deals)
    .where(and(eq(deals.id, dealId), eq(deals.workspaceId, staff.workspaceId)))
    .limit(1);
  if (!deal) backWith(back, "error", "That deal doesn't exist.");
  return { viewer, staff, deal, back };
}

/** The Pipeline panel's quick value field: what the deal is worth, without the full details form. */
export async function saveDealValue(formData: FormData) {
  const { viewer, deal, back } = await panelDeal(formData);
  const raw = String(formData.get("value") ?? "").replace(/[$,\s]/g, "");
  const value = z.union([z.literal(""), z.coerce.number().min(0).max(10_000_000)]).safeParse(raw);
  if (!value.success) backWith(back, "error", "Enter the value in dollars, like 4500.");
  const cents = value.data === "" ? null : Math.round(value.data * 100);
  if (cents === deal.valueCents) backWith(back, "notice", "Value unchanged.");
  const db = getDb();
  await db.batch([
    db.update(deals).set({ valueCents: cents }).where(eq(deals.id, deal.id)),
    eventInsert({
      workspaceId: deal.workspaceId,
      projectId: deal.projectId,
      actorId: viewer.userId,
      verb: "deal.updated",
      subjectType: "deal",
      subjectId: deal.id,
      payload: { company: deal.company, changed: [{ field: "Value", from: deal.valueCents != null ? String(deal.valueCents / 100) : null, to: cents != null ? String(cents / 100) : null }] },
    }),
  ]);
  refresh();
  backWith(back, "notice", cents == null ? "Value cleared." : `Value set to $${(cents / 100).toLocaleString("en-US")}.`);
}

/** The panel's Promote: moves an Outreach lead to the Pipeline, saying what they did. */
export async function promoteDeal(formData: FormData) {
  const { viewer, deal, back } = await panelDeal(formData);
  const signal = z.enum(PICKABLE_SIGNALS as [PromotionSignal, ...PromotionSignal[]]).safeParse(formData.get("signal"));
  if (!signal.success) backWith(back, "error", "Pick what they did: replied, interested, asked for a preview or booked a call.");
  if (trackOf(deal.stage) !== "outreach") backWith(back, "notice", "Already in the Pipeline.");
  const note = String(formData.get("note") ?? "").trim().slice(0, 1000);
  const now = new Date();
  const promotion = promotionWrites(deal, signal.data, viewer.userId, now, { via: "manual", ...(note ? { note } : {}) });
  if (!promotion.writes.length) backWith(back, "error", "This lead can't be promoted from here.");
  const requestPreview = signal.data === "preview" && !previewInFlight(deal.previewStatus);
  const db = getDb();
  await db.batch([
    promotion.writes[0],
    ...promotion.writes.slice(1),
    ...(requestPreview
      ? [
          db.update(deals).set({ previewStatus: "requested", previewRequestedAt: now, previewDecision: null }).where(eq(deals.id, deal.id)),
          previewEvent(deal, viewer.userId, "requested", { via: "promote" }),
        ]
      : []),
  ]);
  if (requestPreview) notifyPreviewRequested(deal, viewer.email, note || null);
  refresh();
  backWith(back, "notice", `${deal.company} promoted to the Pipeline · ${stageLabel(promotion.stage)} (${signalLabel(signal.data)}).`);
}

/** Sends a Pipeline deal that went cold back to Outreach, with why. */
export async function demoteDeal(formData: FormData) {
  const { viewer, deal, back } = await panelDeal(formData);
  if (deal.projectId || !canDemote(deal.stage)) backWith(back, "error", "Only open Pipeline deals can go back to Outreach.");
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 300);
  if (!reason) backWith(back, "error", "Say why it's going back to Outreach.");
  const to = demotedStage(await attemptCount(deal.workspaceId, deal.id));
  const now = new Date();
  const db = getDb();
  await db.batch([
    db.update(deals).set({ stage: to, stageChangedAt: now, promotedAt: null, promotedSignal: null }).where(eq(deals.id, deal.id)),
    eventInsert({
      workspaceId: deal.workspaceId,
      projectId: deal.projectId,
      actorId: viewer.userId,
      verb: "deal.demoted",
      subjectType: "deal",
      subjectId: deal.id,
      payload: { company: deal.company, from: deal.stage, to, reason, ...(deal.promotedSignal ? { signal: deal.promotedSignal } : {}) },
    }),
  ]);
  refresh();
  backWith(back, "notice", `${deal.company} is back in Outreach · ${stageLabel(to)}.`);
}

/** Close Outreach, with the reason it stopped (and why they weren't interested), for the lead brain. */
export async function closeOutreach(formData: FormData) {
  const { viewer, deal, back } = await panelDeal(formData);
  if (deal.stage === "outreach_closed") backWith(back, "notice", "Outreach is already closed.");
  if (trackOf(deal.stage) !== "outreach") backWith(back, "error", "Pipeline deals close as Won or Lost, or go back to Outreach.");
  const parsed = z
    .object({
      reason: z.enum(CLOSE_REASONS.map((r) => r.value) as [CloseReason, ...CloseReason[]]),
      detail: z.union([z.literal(""), z.enum(NOT_INTERESTED_REASONS.map((r) => r.value) as [string, ...string[]])]),
      note: z.string().trim().max(1000),
    })
    .safeParse({ reason: formData.get("reason"), detail: String(formData.get("detail") ?? ""), note: String(formData.get("note") ?? "") });
  if (!parsed.success) backWith(back, "error", "Pick why outreach is closing.");
  const { reason, note } = parsed.data;
  const detail = reason === "not_interested" ? parsed.data.detail || null : null;
  const now = new Date();
  const db = getDb();
  await db.batch([
    db
      .update(deals)
      .set({
        stage: "outreach_closed",
        stageChangedAt: now,
        closeReason: reason,
        closeDetail: detail,
        // Done pursuing: no reminder should keep bringing it back.
        nextStepOn: null,
        nextStep: null,
        ...(reason === "bad_number" ? { badNumber: true } : {}),
      })
      .where(eq(deals.id, deal.id)),
    closeEvent(deal, viewer.userId, reason, detail, "panel"),
    ...(note
      ? [eventInsert({ workspaceId: deal.workspaceId, projectId: deal.projectId, actorId: viewer.userId, verb: "deal.note_added", subjectType: "deal", subjectId: deal.id, payload: { company: deal.company, note } })]
      : []),
  ]);
  refresh();
  backWith(back, "notice", `Outreach closed for ${deal.company}.`);
}

/** "Preview requested" without logging a call: queues the preview, and promotes a lead still in Outreach. */
export async function requestPreview(formData: FormData) {
  const { viewer, deal, back } = await panelDeal(formData);
  if (previewInFlight(deal.previewStatus)) backWith(back, "notice", "A preview is already in progress.");
  const now = new Date();
  const promotion = promotionWrites(deal, "preview", viewer.userId, now, { via: "preview" });
  const db = getDb();
  await db.batch([
    db.update(deals).set({ previewStatus: "requested", previewRequestedAt: now, previewDecision: null, previewBrief: null }).where(eq(deals.id, deal.id)),
    previewEvent(deal, viewer.userId, "requested", { via: "panel" }),
    ...promotion.writes,
  ]);
  notifyPreviewRequested(deal, viewer.email);
  refresh();
  backWith(back, "notice", `Preview requested for ${deal.company}.${promotion.writes.length ? " Promoted to the Pipeline." : ""}`);
}

/**
 * Reiss built the preview with his own AI and published it on the previews
 * site: the link goes on the lead and it's ready to send. Saving a new link
 * on a preview that's already out just replaces the link.
 */
export async function savePreviewLink(formData: FormData) {
  const { viewer, deal, back } = await panelDeal(formData);
  if (!previewInFlight(deal.previewStatus)) backWith(back, "error", "Request a preview first.");
  const url = String(formData.get("previewUrl") ?? "").trim().replace(/\/$/, "");
  if (!isPreviewLink(url)) backWith(back, "error", "Paste the link from previews.skoxsoftware.com, like https://previews.skoxsoftware.com/their-name-1a2b.");
  const out = deal.previewStatus === "sent" || deal.previewStatus === "opened";
  if (url === deal.previewUrl && (out || deal.previewStatus === "ready")) backWith(back, "notice", "That link is already saved.");
  const rows = await getDb()
    .update(deals)
    .set({ previewUrl: url, ...(out ? {} : { previewStatus: "ready" as const }) })
    .where(and(eq(deals.id, deal.id), eq(deals.previewStatus, deal.previewStatus)))
    .returning({ id: deals.id });
  if (!rows.length) backWith(back, "error", "The preview changed in the meantime. Reload the lead.");
  await previewEvent(deal, viewer.userId, out ? deal.previewStatus : "ready", { url, via: "link" });
  refresh();
  backWith(back, "notice", out ? "Link updated." : "Saved. The preview is ready to send.");
}

/** Gate A: the go, go-with-changes or no-go on the builder's research brief. */
/** The preview link went out some other way (Gmail, a text): from now on its views count. */
export async function markPreviewSent(formData: FormData) {
  const { viewer, deal, back } = await panelDeal(formData);
  if (deal.previewStatus !== "ready" && deal.previewStatus !== "building") backWith(back, "error", "Only a ready preview can be marked sent.");
  const rows = await getDb()
    .update(deals)
    .set({ previewStatus: "sent", previewSentAt: new Date() })
    .where(and(eq(deals.id, deal.id), eq(deals.previewStatus, deal.previewStatus)))
    .returning({ id: deals.id });
  if (!rows.length) backWith(back, "error", "The preview changed in the meantime. Reload the lead.");
  await previewEvent(deal, viewer.userId, "sent", { via: "panel" });
  refresh();
  backWith(back, "notice", "Marked sent. You'll get an email the moment they open it.");
}

export async function decidePreview(formData: FormData) {
  const { viewer, deal, back } = await panelDeal(formData);
  if (deal.previewStatus !== "awaiting_approval") backWith(back, "error", "This preview isn't waiting for a decision.");
  const parsed = z
    .object({ decision: z.enum(PREVIEW_DECISIONS.map((d) => d.value) as ["go", "go_with_changes", "no_go"]), changes: z.string().trim().max(2000) })
    .safeParse({ decision: formData.get("decision"), changes: String(formData.get("changes") ?? "") });
  if (!parsed.success) backWith(back, "error", "Pick Go, Go with changes or No-go.");
  const { decision, changes } = parsed.data;
  if (decision === "go_with_changes" && !changes) backWith(back, "error", "Write the changes the build should make.");
  const to = statusAfterDecision(decision);
  const value = { decision, ...(decision === "go_with_changes" ? { changes } : {}), by: viewer.email, at: new Date().toISOString() };
  const db = getDb();
  // Only from awaiting_approval, so two taps or a builder update in between can't both win.
  const rows = await db
    .update(deals)
    .set({ previewStatus: to, previewDecision: value })
    .where(and(eq(deals.id, deal.id), eq(deals.previewStatus, "awaiting_approval")))
    .returning({ id: deals.id });
  if (!rows.length) backWith(back, "error", "The preview changed in the meantime. Reload the lead.");
  await previewEvent(deal, viewer.userId, to, { decision, ...(decision === "go_with_changes" ? { changes } : {}) });
  refresh();
  backWith(back, "notice", decision === "no_go" ? "No-go recorded. The preview is archived." : "Approved. The builder picks it up next.");
}

type BulkResult = { ok: true; count: number } | { ok: false; error: string };

/** Changes the stage, owner or follow-up of several deals at once. Onboarded deals keep their project's stage. */
export async function bulkUpdateDeals(input: { ids: string[]; stage?: string; closeReason?: string; ownerEmail?: string; nextStepOn?: string; repMembershipId?: string }): Promise<BulkResult> {
  const { viewer, staff } = await requireStaff();
  const parsed = z
    .object({
      ids: z.array(z.uuid()).min(1).max(500),
      stage: stageKey.optional(),
      ownerEmail: z.string().trim().max(200).optional(),
      nextStepOn: z.union([z.literal(""), z.iso.date()]).optional(),
      repMembershipId: z.union([z.literal(""), z.uuid()]).optional(),
      closeReason: z.enum(CLOSE_REASONS.map((r) => r.value) as [CloseReason, ...CloseReason[]]).optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Pick some deals and a change to make." };
  const { ids, stage, nextStepOn, closeReason } = parsed.data;
  if (stage === "outreach_closed" && !closeReason) return { ok: false, error: "Pick why outreach is closing." };
  const ownerEmail = parsed.data.ownerEmail === undefined ? undefined : normalizeEmail(parsed.data.ownerEmail);
  if (ownerEmail && !(await staffEmails(staff.workspaceId)).has(ownerEmail)) return { ok: false, error: "The owner must be on the UnBusy team." };
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
  if (stage && ownerEmail === undefined && nextStepOn === undefined && repId === undefined && rows.every((d) => crossesTracks(d.stage, stage))) {
    return { ok: false, error: trackOf(stage) === "active" ? "Leads move to the Pipeline one at a time, with Promote." : "Pipeline deals go back to Outreach one at a time, with a reason." };
  }
  const now = new Date();
  const writes = rows.map((d) => {
    // Bulk moves stay inside a track: crossing over needs a signal or a reason, one deal at a time.
    const nextStage = stage && !d.projectId && stage !== d.stage && !crossesTracks(d.stage, stage) ? stage : undefined;
    return db
      .update(deals)
      .set({
        ...(nextStage ? { stage: nextStage, stageChangedAt: now, ...(nextStage === "won" && !d.wonAt ? { wonAt: now } : {}) } : {}),
        ...(nextStage === "outreach_closed" ? { closeReason, closeDetail: null, nextStepOn: null, nextStep: null } : d.stage === "outreach_closed" && nextStage ? { closeReason: null, closeDetail: null } : {}),
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
      payload: { count: rows.length, ...(stage ? { stage } : {}), ...(closeReason ? { closeReason } : {}), ...(ownerEmail !== undefined ? { ownerEmail } : {}), ...(nextStepOn !== undefined ? { nextStepOn } : {}), ...(repId !== undefined ? { rep: repId || null } : {}) },
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
  const [deal] = await db.select({ id: deals.id, projectId: deals.projectId, contactEmail: deals.contactEmail }).from(deals).where(where).limit(1);
  if (!deal) backWith(back, "notice", "Already marked do not email.");
  if (deal.contactEmail) await suppressOutreach(deal.contactEmail);
  await db.batch([
    db.update(deals).set({ doNotEmail: true }).where(where),
    eventInsert({ workspaceId: staff.workspaceId, projectId: deal.projectId, actorId: viewer.userId, verb: "deal.unsubscribed", subjectType: "deal", subjectId: deal.id, payload: { via: "staff" } }),
  ]);
  revalidatePath(BACK);
  backWith(back, "notice", "Marked do not email. No email can be sent to this contact.");
}

/** The lead panel's stage buttons: the same move as dragging the card, then back to the lead. */
export async function moveDealStage(formData: FormData) {
  const dealId = String(formData.get("dealId") ?? "");
  if (!z.uuid().safeParse(dealId).success) backWith(BACK, "error", "Unknown deal.");
  const to = stageKey.safeParse(formData.get("to"));
  const back = backTo(formData, { deal: dealId });
  if (!to.success) backWith(back, "error", "Pick a stage.");
  const result = await moveCard("deal", dealId, to.data);
  if (!result.ok) backWith(back, "error", result.error);
  backWith(back, "notice", `Moved to ${stageLabel(to.data)}.`);
}
