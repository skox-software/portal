"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaff } from "@/lib/access";
import { ensureAuthAccount } from "@/lib/auth/accounts";
import { formatRate, parseRatePercent } from "@/lib/commission-math";
import { getDb } from "@/lib/db";
import { memberships, repProfiles } from "@/lib/db/schema";
import { sendEmail } from "@/lib/email";
import { eventInsert } from "@/lib/events";
import { todayIso } from "@/lib/format";
import { backWith } from "@/lib/http";
import { portalLink } from "@/lib/notify";
import { canApproveCommissions, isValidRepRate, normalizeEmail, REP_RATE_MAX_BPS, REP_RATE_MIN_BPS } from "@/lib/permissions";

const BACK = "/admin/reps";

/** Reps, rates and payouts are the workspace owner's call. */
async function requireOwner() {
  const ctx = await requireStaff();
  if (!canApproveCommissions(ctx.staff.role)) backWith(BACK, "error", "Only the workspace owner can change sales reps.");
  return ctx;
}

function rateFrom(formData: FormData) {
  const bps = parseRatePercent(String(formData.get("rate") ?? ""));
  return bps !== null && isValidRepRate(bps) ? bps : null;
}

export async function inviteRep(formData: FormData) {
  const { viewer, staff } = await requireOwner();
  const parsed = z
    .object({ email: z.email(), displayName: z.string().trim().min(2).max(80), startedOn: z.union([z.literal(""), z.iso.date()]) })
    .safeParse({ email: normalizeEmail(String(formData.get("email") ?? "")), displayName: String(formData.get("displayName") ?? ""), startedOn: String(formData.get("startedOn") ?? "") });
  if (!parsed.success) backWith(BACK, "error", "Enter the rep's name and a valid email.");
  const rateBps = rateFrom(formData);
  if (rateBps === null) backWith(BACK, "error", `The rate must be between ${formatRate(REP_RATE_MIN_BPS)} and ${formatRate(REP_RATE_MAX_BPS)}.`);
  const { email, displayName } = parsed.data;

  const db = getDb();
  // One account, one role: a rep can't also be staff or a client contact.
  const [existing] = await db.select({ role: memberships.role }).from(memberships).where(and(eq(memberships.workspaceId, staff.workspaceId), eq(memberships.email, email))).limit(1);
  if (existing) backWith(BACK, "error", `${email} already has portal access. Use a different email for the rep account.`);

  const account = await ensureAuthAccount(email);
  if (!account.ok) backWith(BACK, "error", `Couldn't set up a sign-in account for ${email}. Try again in a minute.`);

  const membershipId = crypto.randomUUID();
  await db.batch([
    db.insert(memberships).values({ id: membershipId, workspaceId: staff.workspaceId, clientId: null, email, role: "rep", invitedBy: viewer.userId }),
    db.insert(repProfiles).values({ workspaceId: staff.workspaceId, membershipId, displayName, rateBps, startedOn: parsed.data.startedOn || todayIso() }),
    eventInsert({ workspaceId: staff.workspaceId, actorId: viewer.userId, verb: "rep.invited", subjectType: "membership", subjectId: membershipId, payload: { email, displayName, rateBps } }),
  ]);
  await sendEmail([email], {
    subject: "Your SKOX partner account is ready",
    preheader: `You earn ${formatRate(rateBps)} of every payment from clients you bring.`,
    heading: `Welcome, ${displayName.split(" ")[0]}`,
    paragraphs: [
      "Your SKOX sales partner account is set up. It's where you'll find the leads we assign you, submit your own, book scope calls, and track every dollar you earn.",
      `You earn ${formatRate(rateBps)} of every payment SKOX collects from clients you bring in, for as long as they stay a client.`,
      "Sign in with this email address. We'll send you a 6-digit code; there's no password.",
    ],
    cta: { label: "Sign in", href: portalLink("/sign-in") },
  });
  revalidatePath(BACK);
  backWith(BACK, "notice", `${displayName} is set up at ${formatRate(rateBps)} and has a welcome email.`);
}

export async function updateRep(formData: FormData) {
  const { viewer, staff } = await requireOwner();
  const membershipId = String(formData.get("membershipId") ?? "");
  if (!z.uuid().safeParse(membershipId).success) backWith(BACK, "error", "Unknown rep.");
  const db = getDb();
  const [profile] = await db.select().from(repProfiles).where(and(eq(repProfiles.membershipId, membershipId), eq(repProfiles.workspaceId, staff.workspaceId))).limit(1);
  if (!profile) backWith(BACK, "error", "Unknown rep.");
  const rateBps = rateFrom(formData);
  if (rateBps === null) backWith(BACK, "error", `The rate must be between ${formatRate(REP_RATE_MIN_BPS)} and ${formatRate(REP_RATE_MAX_BPS)}.`);
  const parsed = z
    .object({
      displayName: z.string().trim().min(2).max(80),
      status: z.enum(["active", "paused"]),
      payoutNotes: z.string().trim().max(300),
      startedOn: z.union([z.literal(""), z.iso.date()]),
    })
    .safeParse({
      displayName: String(formData.get("displayName") ?? ""),
      status: String(formData.get("status") ?? ""),
      payoutNotes: String(formData.get("payoutNotes") ?? ""),
      startedOn: String(formData.get("startedOn") ?? ""),
    });
  if (!parsed.success) backWith(BACK, "error", "Check the rep's details.");
  const w9 = formData.get("w9") === "on";
  const agreement = formData.get("agreement") === "on";
  const now = new Date();
  await db.batch([
    db
      .update(repProfiles)
      .set({
        displayName: parsed.data.displayName,
        status: parsed.data.status,
        payoutNotes: parsed.data.payoutNotes || null,
        startedOn: parsed.data.startedOn || null,
        rateBps,
        w9ReceivedAt: w9 ? (profile.w9ReceivedAt ?? now) : null,
        agreementSignedAt: agreement ? (profile.agreementSignedAt ?? now) : null,
      })
      .where(eq(repProfiles.id, profile.id)),
    eventInsert({
      workspaceId: staff.workspaceId,
      actorId: viewer.userId,
      verb: rateBps !== profile.rateBps ? "rep.rate_changed" : "rep.updated",
      subjectType: "membership",
      subjectId: membershipId,
      payload: { displayName: parsed.data.displayName, status: parsed.data.status, ...(rateBps !== profile.rateBps ? { from: profile.rateBps, to: rateBps } : {}) },
    }),
  ]);
  revalidatePath(BACK);
  backWith(BACK, "notice", `${parsed.data.displayName} saved.${rateBps !== profile.rateBps ? ` New payments earn ${formatRate(rateBps)}; past lines keep their rate.` : ""}`);
}
