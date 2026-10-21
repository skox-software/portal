"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRep } from "@/lib/access";
import { getDb } from "@/lib/db";
import { clients, deals, memberships, referrals, repProfiles } from "@/lib/db/schema";
import { eventInsert } from "@/lib/events";
import { followUpAfterCall, nextStepAfterCall, OUTCOMES, outcomeLabel, salesToday, stageAfterCall, type Outcome } from "@/lib/follow-up";
import { FIRST_STAGE, trackOf } from "@/lib/pipeline";
import { formatDate } from "@/lib/format";
import { backWith } from "@/lib/http";
import { notifyLater, portalLink, staffRecipients } from "@/lib/notify";
import { allow } from "@/lib/rate-limit";
import { myLead } from "@/lib/rep-data";
import { leadKeys, sameLead } from "@/lib/rep-leads";
import { repCanWork, repStatusLabel } from "@/lib/rep-status";

/**
 * Everything a sales rep can change. Each action re-checks that the rep owns
 * the lead and only touches rep-facing columns.
 */

const optional = (max: number) => z.string().trim().max(max).transform((v) => v || null);

function refreshRep(dealId?: string) {
  revalidatePath("/rep");
  revalidatePath("/rep/leads");
  if (dealId) revalidatePath(`/rep/leads/${dealId}`);
  revalidatePath("/admin/clients");
  revalidatePath("/admin/pipeline");
}

/** A rep's paused account can still sign in and see history, but not add or work leads. */
async function activeRep() {
  const { viewer, rep } = await requireRep();
  const [profile] = await getDb().select({ status: repProfiles.status, name: repProfiles.displayName }).from(repProfiles).where(eq(repProfiles.membershipId, rep.id)).limit(1);
  return { viewer, rep, profile, active: profile?.status === "active" };
}

export async function createRepLead(formData: FormData) {
  const { viewer, rep, profile, active } = await activeRep();
  const back = "/rep/leads/new";
  if (!active) backWith(back, "error", "Your account is paused. Talk to SKOX to start submitting leads again.");
  const parsed = z
    .object({
      company: z.string().trim().min(2, "Add the business name.").max(160),
      contactName: optional(120),
      contactEmail: z.union([z.literal(""), z.email("Check the email address.")]).transform((v) => v.toLowerCase() || null),
      phone: optional(40),
      website: optional(300),
      industry: optional(80),
      location: optional(120),
      repNotes: optional(2000),
    })
    .safeParse(Object.fromEntries(["company", "contactName", "contactEmail", "phone", "website", "industry", "location", "repNotes"].map((k) => [k, String(formData.get(k) ?? "")])));
  if (!parsed.success) backWith(back, "error", parsed.error.issues[0]?.message ?? "Check the form.");
  const lead = parsed.data;
  if (!lead.contactEmail && !lead.phone) backWith(back, "error", "Add a phone number or an email so SKOX can reach them.");
  if (!(await allow(`replead:${rep.id}`, 40, 86_400_000))) backWith(back, "error", "That's a lot of leads for one day. Try again tomorrow.");

  // First to submit wins. Check every lead, client and referral in the workspace.
  const db = getDb();
  const [dealRows, clientRows, referralRows] = await Promise.all([
    db.select({ company: deals.company, email: deals.contactEmail, phone: deals.phone, website: deals.website }).from(deals).where(eq(deals.workspaceId, rep.workspaceId)),
    db.select({ company: clients.name }).from(clients).where(eq(clients.workspaceId, rep.workspaceId)),
    db.select({ company: referrals.company, email: referrals.email }).from(referrals).where(eq(referrals.workspaceId, rep.workspaceId)),
  ]);
  const keys = leadKeys({ company: lead.company, email: lead.contactEmail, phone: lead.phone, website: lead.website });
  const taken = [...dealRows, ...clientRows, ...referralRows].some((row) => sameLead(keys, leadKeys(row)));
  if (taken) {
    // Never say who has it: just that it's taken.
    backWith(back, "error", `${lead.company} is already in the SKOX pipeline, so it can't be added. Leads go to whoever submits them first.`);
  }

  const [deal] = await db
    .insert(deals)
    .values({
      workspaceId: rep.workspaceId,
      company: lead.company,
      contactName: lead.contactName,
      contactEmail: lead.contactEmail,
      phone: lead.phone,
      website: lead.website,
      industry: lead.industry,
      location: lead.location,
      repNotes: lead.repNotes,
      kind: "website",
      stage: FIRST_STAGE,
      source: "rep",
      leadSource: `Rep · ${profile?.name ?? viewer.email}`,
      repMembershipId: rep.id,
      repSource: "self",
      createdBy: viewer.userId,
    })
    .returning({ id: deals.id });
  await eventInsert({ workspaceId: rep.workspaceId, actorId: viewer.userId, verb: "deal.created", subjectType: "deal", subjectId: deal.id, payload: { company: lead.company, source: "rep" } });
  notifyLater(() => staffRecipients(rep.workspaceId), {
    subject: `New rep lead: ${lead.company}`,
    preheader: `${profile?.name ?? viewer.email} added a lead.`,
    heading: `${profile?.name ?? "A rep"} added ${lead.company}`,
    paragraphs: ["It's in the pipeline with the rep credited. Assign a SKOX owner when it's ready for a scope call."],
    details: [
      ...(lead.contactName ? [{ label: "Contact", value: lead.contactName }] : []),
      ...(lead.phone ? [{ label: "Phone", value: lead.phone }] : []),
      ...(lead.contactEmail ? [{ label: "Email", value: lead.contactEmail }] : []),
      ...(lead.website ? [{ label: "Website", value: lead.website }] : []),
    ],
    cta: { label: "Open lead", href: portalLink(`/admin/clients?deal=${deal.id}`) },
  });
  refreshRep();
  backWith(`/rep/leads/${deal.id}`, "notice", `${lead.company} is yours. Log your first call when you reach them.`);
}

/** Loads the rep's own lead and checks it's still theirs to work. */
async function workable(formData: FormData) {
  const { viewer, rep, profile, active } = await activeRep();
  const dealId = String(formData.get("dealId") ?? "");
  if (!z.uuid().safeParse(dealId).success) backWith("/rep/leads", "error", "Unknown lead.");
  const lead = await myLead(rep, dealId);
  if (!lead) backWith("/rep/leads", "error", "That lead isn't assigned to you.");
  const back = `/rep/leads/${dealId}`;
  if (!active) backWith(back, "error", "Your account is paused.");
  if (!repCanWork(lead.status)) backWith(back, "error", `This lead is ${repStatusLabel(lead.status).toLowerCase()}, so there's nothing left to log.`);
  return { viewer, rep, profile, lead, back };
}

export async function logRepCall(formData: FormData) {
  const { viewer, rep, lead, back } = await workable(formData);
  const parsed = z
    .object({
      outcome: z.enum(OUTCOMES.map((o) => o.value) as [Outcome, ...Outcome[]]),
      note: z.string().trim().max(1000),
      followUp: z.union([z.literal(""), z.iso.date()]),
      nextStep: z.string().trim().max(200),
    })
    .safeParse({
      outcome: formData.get("outcome"),
      note: String(formData.get("note") ?? ""),
      followUp: String(formData.get("followUp") ?? ""),
      nextStep: String(formData.get("nextStep") ?? ""),
    });
  if (!parsed.success) backWith(back, "error", "Pick what happened on the call.");
  const { outcome, note } = parsed.data;
  const gatekeeper = String(formData.get("gatekeeper") ?? "").trim().slice(0, 80);
  const db = getDb();
  const [deal] = await db.select({ stage: deals.stage, projectId: deals.projectId }).from(deals).where(eq(deals.id, lead.id)).limit(1);
  // Reps have no stage buttons, so "Not interested" closes their outreach for them.
  const stage = deal.projectId ? deal.stage : outcome === "not_interested" && trackOf(deal.stage) === "outreach" ? "outreach_closed" : stageAfterCall(deal.stage, outcome);
  const closed = stage === "outreach_closed";
  const followUp = closed ? null : followUpAfterCall(outcome, parsed.data.followUp, salesToday());
  const nextStep = followUp ? parsed.data.nextStep || nextStepAfterCall(outcome, gatekeeper) : null;
  await db.batch([
    db
      .update(deals)
      .set({
        lastContactedAt: new Date(),
        stage,
        nextStepOn: followUp,
        nextStep,
        ...(outcome === "bad_number" ? { badNumber: true } : {}),
        ...(stage !== deal.stage ? { stageChangedAt: new Date() } : {}),
      })
      .where(and(eq(deals.id, lead.id), eq(deals.repMembershipId, rep.id))),
    eventInsert({
      workspaceId: rep.workspaceId,
      actorId: viewer.userId,
      verb: "deal.call_logged",
      subjectType: "deal",
      subjectId: lead.id,
      payload: { company: lead.company, outcome, by: "rep", ...(note ? { note } : {}), ...(gatekeeper ? { gatekeeper } : {}), ...(followUp ? { followUp } : {}), ...(stage !== deal.stage ? { from: deal.stage, to: stage } : {}) },
    }),
  ]);
  refreshRep(lead.id);
  const nextId = String(formData.get("nextId") ?? "");
  const message = `${outcomeLabel(outcome)} logged for ${lead.company}.`;
  if (formData.get("intent") === "next" && z.uuid().safeParse(nextId).success) backWith(`/rep/leads/${nextId}`, "notice", message);
  backWith(back, "notice", message);
}

/** The rep's goal: a scope call on SKOX's calendar. SKOX takes it from there. */
export async function markMeetingBooked(formData: FormData) {
  const { viewer, rep, profile, lead, back } = await workable(formData);
  const parsed = z
    .object({ day: z.iso.date("Pick the day of the call."), time: z.string().trim().max(40), note: z.string().trim().max(1000) })
    .safeParse({ day: String(formData.get("day") ?? ""), time: String(formData.get("time") ?? ""), note: String(formData.get("note") ?? "") });
  if (!parsed.success) backWith(back, "error", parsed.error.issues[0]?.message ?? "Pick the day of the call.");
  const { day, time, note } = parsed.data;
  if (day < salesToday()) backWith(back, "error", "The call can't be in the past.");
  const when = `${formatDate(day)}${time ? ` at ${time}` : ""}`;
  const db = getDb();
  const [full] = await db.select({ ownerEmail: deals.ownerEmail }).from(deals).where(eq(deals.id, lead.id)).limit(1);
  await db.batch([
    db
      .update(deals)
      .set({ meetingAt: new Date(), nextStepOn: day, nextStep: `Scope call ${time || ""}`.trim() + " (booked by rep)", lastContactedAt: new Date() })
      .where(and(eq(deals.id, lead.id), eq(deals.repMembershipId, rep.id))),
    eventInsert({ workspaceId: rep.workspaceId, actorId: viewer.userId, verb: "deal.meeting_booked", subjectType: "deal", subjectId: lead.id, payload: { company: lead.company, when, ...(note ? { note } : {}) } }),
  ]);
  notifyLater(async () => (full?.ownerEmail ? [full.ownerEmail] : staffRecipients(rep.workspaceId)), {
    subject: `Scope call booked: ${lead.company}`,
    preheader: `${profile?.name ?? viewer.email} booked a call for ${when}.`,
    heading: `${lead.company}: call booked`,
    paragraphs: [`${profile?.name ?? "A rep"} booked a scope call with ${lead.contactName ?? lead.company}. It's on the follow-up list for ${day}.`, ...(note ? [`Rep's note: ${note}`] : [])],
    details: [
      { label: "When", value: when },
      ...(lead.phone ? [{ label: "Phone", value: lead.phone }] : []),
      ...(lead.contactEmail ? [{ label: "Email", value: lead.contactEmail }] : []),
    ],
    cta: { label: "Open lead", href: portalLink(`/admin/clients?deal=${lead.id}`) },
  });
  refreshRep(lead.id);
  backWith(back, "notice", `Call booked for ${when}. SKOX takes it from here, and you'll see the status change.`);
}

export async function saveRepNotes(formData: FormData) {
  const { rep } = await requireRep();
  const dealId = String(formData.get("dealId") ?? "");
  if (!z.uuid().safeParse(dealId).success) backWith("/rep/leads", "error", "Unknown lead.");
  const lead = await myLead(rep, dealId);
  if (!lead) backWith("/rep/leads", "error", "That lead isn't assigned to you.");
  const notes = String(formData.get("repNotes") ?? "").trim().slice(0, 4000);
  await getDb().update(deals).set({ repNotes: notes || null }).where(and(eq(deals.id, dealId), eq(deals.repMembershipId, rep.id)));
  refreshRep(dealId);
  backWith(`/rep/leads/${dealId}`, "notice", "Notes saved.");
}

export async function saveRepSettings(formData: FormData) {
  const { rep } = await requireRep();
  const parsed = z
    .object({ displayName: z.string().trim().min(2, "Add your name.").max(80), phone: optional(40) })
    .safeParse({ displayName: String(formData.get("displayName") ?? ""), phone: String(formData.get("phone") ?? "") });
  if (!parsed.success) backWith("/rep/settings", "error", parsed.error.issues[0]?.message ?? "Check the form.");
  const db = getDb();
  await db.batch([
    db.update(repProfiles).set(parsed.data).where(eq(repProfiles.membershipId, rep.id)),
    db.update(memberships).set({ emailUpdates: formData.get("emailUpdates") === "on" }).where(eq(memberships.id, rep.id)),
  ]);
  revalidatePath("/rep/settings");
  backWith("/rep/settings", "notice", "Saved.");
}
