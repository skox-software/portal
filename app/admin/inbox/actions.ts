"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaff } from "@/lib/access";
import { getDb } from "@/lib/db";
import { clients, deals, emailThreads } from "@/lib/db/schema";
import { eventInsert } from "@/lib/events";
import { backWith } from "@/lib/http";
import { sendThreadReply } from "@/lib/inbox-server";

const BACK = "/admin/inbox";

async function ownThread(threadId: string, workspaceId: string) {
  if (!z.uuid().safeParse(threadId).success) return null;
  const [thread] = await getDb()
    .select()
    .from(emailThreads)
    .where(and(eq(emailThreads.id, threadId), eq(emailThreads.workspaceId, workspaceId)))
    .limit(1);
  return thread ?? null;
}

function refresh() {
  revalidatePath(BACK);
  revalidatePath("/admin/clients");
  revalidatePath("/admin", "layout");
}

/** Files a conversation under a client or a deal ("client:<id>" / "deal:<id>"), or back to unassigned. */
export async function assignThread(formData: FormData) {
  const { viewer, staff } = await requireStaff();
  const thread = await ownThread(String(formData.get("threadId") ?? ""), staff.workspaceId);
  if (!thread) backWith(BACK, "error", "That conversation doesn't exist.");
  const back = `${BACK}?thread=${thread.id}`;
  const target = String(formData.get("target") ?? "");
  const [kind, id] = target.split(":");
  const db = getDb();

  let clientId: string | null = null;
  let dealId: string | null = null;
  let label = "unassigned";
  if (kind === "client" && z.uuid().safeParse(id).success) {
    const [client] = await db.select().from(clients).where(and(eq(clients.id, id), eq(clients.workspaceId, staff.workspaceId))).limit(1);
    if (!client) backWith(back, "error", "That client doesn't exist.");
    clientId = client.id;
    label = client.name;
  } else if (kind === "deal" && z.uuid().safeParse(id).success) {
    const [deal] = await db.select().from(deals).where(and(eq(deals.id, id), eq(deals.workspaceId, staff.workspaceId))).limit(1);
    if (!deal) backWith(back, "error", "That deal doesn't exist.");
    dealId = deal.id;
    clientId = deal.clientId;
    label = deal.company;
  } else if (target !== "none") {
    backWith(back, "error", "Choose a client or deal.");
  }

  await db.batch([
    db.update(emailThreads).set({ clientId, dealId }).where(eq(emailThreads.id, thread.id)),
    eventInsert({
      workspaceId: staff.workspaceId,
      actorId: viewer.userId,
      verb: "email.assigned",
      subjectType: "email_thread",
      subjectId: thread.id,
      payload: { with: thread.counterpartEmail, to: label },
    }),
  ]);
  refresh();
  backWith(back, "notice", clientId || dealId ? `Filed under ${label}. New mail from ${thread.counterpartEmail} lands there too.` : "Moved back to Needs a client.");
}

export async function sendReply(formData: FormData) {
  const { viewer, staff } = await requireStaff();
  const thread = await ownThread(String(formData.get("threadId") ?? ""), staff.workspaceId);
  if (!thread) backWith(BACK, "error", "That conversation doesn't exist.");
  const back = `${BACK}?thread=${thread.id}`;
  const parsed = z
    .object({ subject: z.string().trim().max(250), body: z.string().trim().min(1).max(20_000) })
    .safeParse({ subject: formData.get("subject") ?? "", body: formData.get("body") ?? "" });
  if (!parsed.success) backWith(back, "error", "Write a reply first.");

  const result = await sendThreadReply({
    threadId: thread.id,
    workspaceId: staff.workspaceId,
    subject: parsed.data.subject,
    body: parsed.data.body,
    sender: { userId: viewer.userId, email: viewer.email, name: viewer.name },
  });
  if (!result.ok) backWith(back, "error", result.error);
  refresh();
  backWith(back, "notice", result.sent ? `Sent to ${thread.counterpartEmail}.` : "Saved to the thread. (Email only sends in production.)");
}

/** Done: hides the conversation until the next reply arrives. */
export async function archiveThread(formData: FormData) {
  const { staff } = await requireStaff();
  const thread = await ownThread(String(formData.get("threadId") ?? ""), staff.workspaceId);
  if (!thread) backWith(BACK, "error", "That conversation doesn't exist.");
  await getDb().update(emailThreads).set({ archivedAt: new Date(), readAt: new Date() }).where(eq(emailThreads.id, thread.id));
  refresh();
  backWith(BACK, "notice", "Marked done. It comes back if they reply.");
}
