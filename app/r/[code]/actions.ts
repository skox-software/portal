"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { clients, memberships, referrals } from "@/lib/db/schema";
import { eventInsert } from "@/lib/events";
import { notifyLater, portalLink, staffRecipients } from "@/lib/notify";

/** Public: a referred prospect introduces themselves. Staff get the lead instantly. */
export async function submitReferral(formData: FormData) {
  const code = String(formData.get("code") ?? "");
  if (!/^[a-z0-9]{4,20}$/.test(code)) redirect("/sign-in");
  // Bots fill every field; people never see this one.
  if (String(formData.get("website") ?? "") !== "") redirect(`/r/${code}?sent=1`);

  const parsed = z
    .object({
      name: z.string().trim().min(1).max(120),
      email: z.email().max(200),
      company: z.string().trim().max(120),
      idea: z.string().trim().max(3000),
    })
    .safeParse({
      name: formData.get("name"),
      email: String(formData.get("email") ?? "").trim().toLowerCase(),
      company: formData.get("company") ?? "",
      idea: formData.get("idea") ?? "",
    });
  if (!parsed.success) redirect(`/r/${code}`);

  const db = getDb();
  const [referrer] = await db
    .select({ membership: memberships, clientName: clients.name })
    .from(memberships)
    .innerJoin(clients, eq(clients.id, memberships.clientId))
    .where(eq(memberships.referralCode, code))
    .limit(1);
  if (!referrer) redirect("/sign-in");

  const id = crypto.randomUUID();
  const { membership, clientName } = referrer;
  await db.batch([
    db.insert(referrals).values({
      id,
      workspaceId: membership.workspaceId,
      referrerMembershipId: membership.id,
      referrerEmail: membership.email,
      name: parsed.data.name,
      email: parsed.data.email,
      company: parsed.data.company || null,
      idea: parsed.data.idea || null,
    }),
    eventInsert({
      workspaceId: membership.workspaceId,
      actorId: membership.email,
      verb: "referral.received",
      subjectType: "referral",
      subjectId: id,
      payload: { name: parsed.data.name, referrer: membership.email },
    }),
  ]);

  notifyLater(() => staffRecipients(membership.workspaceId), {
    subject: `New referral from ${clientName}: ${parsed.data.name}`,
    preheader: parsed.data.idea.slice(0, 140) || `${parsed.data.email} wants to talk`,
    heading: `${parsed.data.name} was referred by ${clientName}`,
    paragraphs: [
      `${parsed.data.name} · ${parsed.data.email}${parsed.data.company ? ` · ${parsed.data.company}` : ""}`,
      parsed.data.idea || "No idea described yet.",
      `Referred by ${membership.email}. Reply within a day while it's warm, and thank the referrer.`,
    ],
    cta: { label: "Open mission control", href: portalLink("/admin#referrals") },
  });
  notifyLater(() => [membership.email], {
    subject: `Thank you for referring ${parsed.data.name}`,
    preheader: "We'll look after them.",
    heading: "Thank you for the referral",
    paragraphs: [`${parsed.data.name} just reached out through your link. We'll take great care of them and keep you posted.`],
  });

  redirect(`/r/${code}?sent=1`);
}
