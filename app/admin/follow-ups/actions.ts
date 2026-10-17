"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaff } from "@/lib/access";
import { getDb } from "@/lib/db";
import { clients, deals } from "@/lib/db/schema";
import { eventInsert } from "@/lib/events";
import { normalizeEmail } from "@/lib/permissions";

/*
 * Follow-ups: "reach back out on this day, for this". A pipeline lead keeps
 * its follow-up on the deal (the call desk works from the same date); a
 * client keeps one on the client. Setting, clearing and marking one done are
 * the same three moves for both, and each records an event.
 */

export type FollowUpResult = { ok: true } | { ok: false; error: string };

const target = z.object({ kind: z.enum(["deal", "client"]), id: z.uuid() });

function refresh(kind: "deal" | "client", id: string) {
  revalidatePath("/admin/clients");
  revalidatePath("/admin/pipeline");
  revalidatePath("/admin");
  if (kind === "client") revalidatePath(`/admin/clients/${id}`);
}

/** Sets (or moves) the follow-up. `owner` is who gets reminded; for a lead that's the deal's owner. */
export async function setFollowUp(input: { kind: "deal" | "client"; id: string; dueOn: string; note?: string; owner?: string }): Promise<FollowUpResult> {
  const { viewer, staff } = await requireStaff();
  const parsed = target
    .extend({ dueOn: z.iso.date(), note: z.string().trim().max(200).optional(), owner: z.string().trim().max(200).optional() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Pick a date for the follow-up." };
  const { kind, id, dueOn } = parsed.data;
  const note = parsed.data.note || null;
  const db = getDb();
  const ws = staff.workspaceId;

  if (kind === "deal") {
    const [deal] = await db
      .update(deals)
      .set({ nextStepOn: dueOn, ...(parsed.data.note !== undefined ? { nextStep: note } : {}) })
      .where(and(eq(deals.id, id), eq(deals.workspaceId, ws)))
      .returning({ id: deals.id, company: deals.company });
    if (!deal) return { ok: false, error: "That lead doesn't exist." };
    await eventInsert({ workspaceId: ws, actorId: viewer.userId, verb: "follow_up.set", subjectType: "deal", subjectId: deal.id, payload: { company: deal.company, dueOn, ...(note ? { note } : {}) } });
  } else {
    const owner = normalizeEmail(parsed.data.owner || viewer.email);
    const [client] = await db
      .update(clients)
      .set({ nextStepOn: dueOn, nextStepOwner: owner, ...(parsed.data.note !== undefined ? { nextStep: note } : {}) })
      .where(and(eq(clients.id, id), eq(clients.workspaceId, ws)))
      .returning({ id: clients.id, name: clients.name });
    if (!client) return { ok: false, error: "That client doesn't exist." };
    await eventInsert({ workspaceId: ws, actorId: viewer.userId, verb: "follow_up.set", subjectType: "client", subjectId: client.id, payload: { company: client.name, dueOn, owner, ...(note ? { note } : {}) } });
  }
  refresh(kind, id);
  return { ok: true };
}

/**
 * Clears the follow-up. `done` means someone reached out, so it's logged as
 * done (and a lead's last contact moves to now); otherwise it's just removed.
 */
export async function clearFollowUp(input: { kind: "deal" | "client"; id: string; done?: boolean }): Promise<FollowUpResult> {
  const { viewer, staff } = await requireStaff();
  const parsed = target.extend({ done: z.boolean().optional() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Unknown follow-up." };
  const { kind, id, done } = parsed.data;
  const db = getDb();
  const ws = staff.workspaceId;
  const verb = done ? "follow_up.done" : "follow_up.cleared";

  if (kind === "deal") {
    const [deal] = await db
      .update(deals)
      .set({ nextStepOn: null, nextStep: null, ...(done ? { lastContactedAt: new Date() } : {}) })
      .where(and(eq(deals.id, id), eq(deals.workspaceId, ws)))
      .returning({ id: deals.id, company: deals.company });
    if (!deal) return { ok: false, error: "That lead doesn't exist." };
    await eventInsert({ workspaceId: ws, actorId: viewer.userId, verb, subjectType: "deal", subjectId: deal.id, payload: { company: deal.company } });
  } else {
    const [client] = await db
      .update(clients)
      .set({ nextStepOn: null, nextStep: null, nextStepOwner: null })
      .where(and(eq(clients.id, id), eq(clients.workspaceId, ws)))
      .returning({ id: clients.id, name: clients.name });
    if (!client) return { ok: false, error: "That client doesn't exist." };
    await eventInsert({ workspaceId: ws, actorId: viewer.userId, verb, subjectType: "client", subjectId: client.id, payload: { company: client.name } });
  }
  refresh(kind, id);
  return { ok: true };
}
