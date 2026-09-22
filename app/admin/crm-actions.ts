"use server";

import { and, desc, eq, isNull, ne } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireStaff } from "@/lib/access";
import { ALL_STAGES, isDealStage, normalizeAddress, parseDollars, stageStamps, STAGE_LABEL, type DealStage } from "@/lib/crm";
import { sendThreadEmail } from "@/lib/crm-email";
import { getDb } from "@/lib/db";
import { clients, contacts, crmActivities, deals, emailThreads, memberships, projects } from "@/lib/db/schema";
import { eventInsert } from "@/lib/events";
import { backWith } from "@/lib/http";

/*
 * CRM actions. Same rules as app/admin/actions.ts: every action re-checks that
 * the caller is SKOX staff and that what it touches is in their workspace, and
 * records an event in the same batch as the change.
 */

const text = (max: number) => z.string().trim().max(max);
const optionalEmail = z.union([z.literal(""), z.email().max(254)]);
const optionalUrl = z.union([z.literal(""), z.url({ protocol: /^https?$/ }).max(2048)]);
const uuid = z.uuid();

function field(formData: FormData, name: string) {
  const v = formData.get(name);
  return typeof v === "string" ? v : "";
}

function clientPath(clientId: string, dealId?: string | null) {
  return dealId ? `/admin/clients/${clientId}?deal=${dealId}` : `/admin/clients/${clientId}`;
}

type Batch = [BatchItem<"pg">, ...BatchItem<"pg">[]];

function revalidateCrm(clientId?: string | null) {
  revalidatePath("/admin/pipeline");
  revalidatePath("/admin/clients");
  revalidatePath("/admin/inbox", "layout");
  if (clientId) revalidatePath(`/admin/clients/${clientId}`);
}

async function ownDeal(dealId: string, workspaceId: string) {
  if (!uuid.safeParse(dealId).success) return null;
  const [deal] = await getDb()
    .select()
    .from(deals)
    .where(and(eq(deals.id, dealId), eq(deals.workspaceId, workspaceId)))
    .limit(1);
  return deal ?? null;
}

async function ownClient(clientId: string, workspaceId: string) {
  if (!uuid.safeParse(clientId).success) return null;
  const [client] = await getDb()
    .select()
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.workspaceId, workspaceId)))
    .limit(1);
  return client ?? null;
}

/* ---- Deals ---- */

/**
 * Moves a deal. Called from the board (drag or menu) with plain arguments, so
 * it returns a result instead of redirecting; the board rolls back on error.
 */
export async function moveDealStage(dealId: string, stage: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { viewer, staff } = await requireStaff();
  if (!isDealStage(stage)) return { ok: false, error: "Unknown stage." };
  const deal = await ownDeal(dealId, staff.workspaceId);
  if (!deal) return { ok: false, error: "That deal no longer exists." };
  if (deal.stage === stage) return { ok: true };

  const db = getDb();
  const now = new Date();
  await db.batch([
    db
      .update(deals)
      .set({ stage, stageEnteredAt: now, ...stageStamps(stage, deal, now) })
      .where(eq(deals.id, deal.id)),
    db.insert(crmActivities).values({
      workspaceId: staff.workspaceId,
      clientId: deal.clientId,
      dealId: deal.id,
      type: "stage_change",
      body: `${STAGE_LABEL[deal.stage]} → ${STAGE_LABEL[stage]}`,
      meta: { from: deal.stage, to: stage },
      actorId: viewer.userId,
      actorEmail: viewer.email,
    }),
    eventInsert({
      workspaceId: staff.workspaceId,
      projectId: deal.projectId,
      actorId: viewer.userId,
      verb: "deal.stage_changed",
      subjectType: "deal",
      subjectId: deal.id,
      payload: { from: deal.stage, to: stage },
    }),
  ]);
  revalidateCrm(deal.clientId);
  return { ok: true };
}

/** Form version for the client page's stage menu. */
export async function moveDealStageForm(formData: FormData) {
  const dealId = field(formData, "dealId");
  const result = await moveDealStage(dealId, field(formData, "stage"));
  const { staff } = await requireStaff();
  const deal = await ownDeal(dealId, staff.workspaceId);
  if (!deal) backWith("/admin/pipeline", "error", "That deal no longer exists.");
  if (!result.ok) backWith(clientPath(deal.clientId, deal.id), "error", result.error);
  backWith(clientPath(deal.clientId, deal.id), "notice", `Moved to ${STAGE_LABEL[deal.stage as DealStage]}.`);
}

/**
 * New deal, for an existing client or a brand-new one (company name plus an
 * optional first contact). Lands on the client page.
 */
export async function createDeal(formData: FormData) {
  const { viewer, staff } = await requireStaff();
  const parsed = z
    .object({
      clientId: z.union([z.literal(""), uuid]),
      companyName: text(120),
      contactName: text(120),
      contactEmail: optionalEmail,
      title: text(140).min(1, "Give the deal a name."),
      kind: text(60),
      value: text(20),
      stage: z.enum(ALL_STAGES),
      source: text(120),
    })
    .safeParse({
      clientId: field(formData, "clientId"),
      companyName: field(formData, "companyName"),
      contactName: field(formData, "contactName"),
      contactEmail: field(formData, "contactEmail"),
      title: field(formData, "title"),
      kind: field(formData, "kind"),
      value: field(formData, "value"),
      stage: field(formData, "stage") || "lead",
      source: field(formData, "source"),
    });
  const back = field(formData, "back") || "/admin/pipeline";
  if (!parsed.success) backWith(back, "error", parsed.error.issues[0]?.message ?? "Check the deal details.");
  const d = parsed.data;
  const valueCents = parseDollars(d.value);
  if (valueCents === null) backWith(back, "error", "Value should be a number, like 12,500.");

  const db = getDb();
  let clientId = d.clientId;
  const ops: BatchItem<"pg">[] = [];
  if (clientId) {
    if (!(await ownClient(clientId, staff.workspaceId))) backWith(back, "error", "That client no longer exists.");
  } else {
    if (!d.companyName) backWith(back, "error", "Pick a client or enter a company name.");
    clientId = crypto.randomUUID();
    ops.push(
      db.insert(clients).values({ id: clientId, workspaceId: staff.workspaceId, name: d.companyName, source: d.source || null }),
      eventInsert({
        workspaceId: staff.workspaceId,
        actorId: viewer.userId,
        verb: "client.created",
        subjectType: "client",
        subjectId: clientId,
        payload: { name: d.companyName, via: "crm" },
      }),
    );
    if (d.contactName) {
      ops.push(
        db.insert(contacts).values({
          workspaceId: staff.workspaceId,
          clientId,
          name: d.contactName,
          email: d.contactEmail ? normalizeAddress(d.contactEmail) : null,
          isPrimary: true,
        }),
      );
    }
  }

  const dealId = crypto.randomUUID();
  const now = new Date();
  ops.push(
    db.insert(deals).values({
      id: dealId,
      workspaceId: staff.workspaceId,
      clientId,
      title: d.title,
      kind: d.kind || null,
      valueCents,
      stage: d.stage,
      stageEnteredAt: now,
      ownerId: viewer.userId,
      ownerEmail: viewer.email,
      ...stageStamps(d.stage, { wonAt: null, shippedAt: null, lostAt: null }, now),
    }),
    eventInsert({
      workspaceId: staff.workspaceId,
      actorId: viewer.userId,
      verb: "deal.created",
      subjectType: "deal",
      subjectId: dealId,
      payload: { title: d.title, stage: d.stage, valueCents },
    }),
  );
  await db.batch(ops as Batch);
  revalidateCrm(clientId);
  redirect(clientPath(clientId, dealId));
}

export async function updateDeal(formData: FormData) {
  const { viewer, staff } = await requireStaff();
  const deal = await ownDeal(field(formData, "dealId"), staff.workspaceId);
  if (!deal) backWith("/admin/pipeline", "error", "That deal no longer exists.");
  const back = clientPath(deal.clientId, deal.id);

  const parsed = z
    .object({
      title: text(140).min(1, "Give the deal a name."),
      kind: text(60),
      value: text(20),
      pricing: z.enum(["fixed", "retainer", "hourly"]),
      scope: text(2000),
      ownerId: text(200),
      nextAction: text(300),
      nextActionOn: z.union([z.literal(""), z.iso.date()]),
      lostReason: text(300),
      projectId: z.union([z.literal(""), uuid]),
    })
    .safeParse({
      title: field(formData, "title"),
      kind: field(formData, "kind"),
      value: field(formData, "value"),
      pricing: field(formData, "pricing") || "fixed",
      scope: field(formData, "scope"),
      ownerId: field(formData, "ownerId"),
      nextAction: field(formData, "nextAction"),
      nextActionOn: field(formData, "nextActionOn"),
      lostReason: field(formData, "lostReason"),
      projectId: field(formData, "projectId"),
    });
  if (!parsed.success) backWith(back, "error", parsed.error.issues[0]?.message ?? "Check the deal details.");
  const d = parsed.data;
  const valueCents = parseDollars(d.value);
  if (valueCents === null) backWith(back, "error", "Value should be a number, like 12,500.");

  const db = getDb();
  // Owner must be SKOX staff in this workspace; the project must belong to this client.
  let owner = { ownerId: deal.ownerId, ownerEmail: deal.ownerEmail };
  if (d.ownerId && d.ownerId !== deal.ownerId) {
    const [m] = await db
      .select({ userId: memberships.userId, email: memberships.email })
      .from(memberships)
      .where(and(eq(memberships.workspaceId, staff.workspaceId), isNull(memberships.clientId), eq(memberships.userId, d.ownerId)))
      .limit(1);
    if (!m) backWith(back, "error", "Owner must be on the SKOX team.");
    owner = { ownerId: m.userId, ownerEmail: m.email };
  }
  if (d.projectId) {
    const [p] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, d.projectId), eq(projects.clientId, deal.clientId)))
      .limit(1);
    if (!p) backWith(back, "error", "That project belongs to a different client.");
  }

  await db.batch([
    db
      .update(deals)
      .set({
        title: d.title,
        kind: d.kind || null,
        valueCents,
        pricing: d.pricing,
        scope: d.scope || null,
        ...owner,
        nextAction: d.nextAction || null,
        nextActionOn: d.nextActionOn || null,
        lostReason: d.lostReason || null,
        projectId: d.projectId || null,
      })
      .where(eq(deals.id, deal.id)),
    eventInsert({
      workspaceId: staff.workspaceId,
      projectId: d.projectId || null,
      actorId: viewer.userId,
      verb: "deal.updated",
      subjectType: "deal",
      subjectId: deal.id,
      payload: { title: d.title, valueCents },
    }),
  ]);
  revalidateCrm(deal.clientId);
  backWith(back, "notice", "Deal saved.");
}

/** Clears the next action once it's done, leaving a note of it on the timeline. */
export async function completeNextAction(formData: FormData) {
  const { viewer, staff } = await requireStaff();
  const deal = await ownDeal(field(formData, "dealId"), staff.workspaceId);
  if (!deal) backWith("/admin/pipeline", "error", "That deal no longer exists.");
  const db = getDb();
  await db.batch([
    db.update(deals).set({ nextAction: null, nextActionOn: null }).where(eq(deals.id, deal.id)),
    db.insert(crmActivities).values({
      workspaceId: staff.workspaceId,
      clientId: deal.clientId,
      dealId: deal.id,
      type: "note",
      body: `Done: ${deal.nextAction ?? "next action"}`,
      actorId: viewer.userId,
      actorEmail: viewer.email,
    }),
  ]);
  revalidateCrm(deal.clientId);
  backWith(clientPath(deal.clientId, deal.id), "notice", "Marked done. Set the next one when you know it.");
}

/* ---- Clients, contacts, notes ---- */

export async function saveClientProfile(formData: FormData) {
  const { viewer, staff } = await requireStaff();
  const client = await ownClient(field(formData, "clientId"), staff.workspaceId);
  if (!client) backWith("/admin/clients", "error", "That client no longer exists.");
  const back = clientPath(client.id, field(formData, "dealId") || null);
  const parsed = z
    .object({ industry: text(120), location: text(120), website: optionalUrl, source: text(120) })
    .safeParse({
      industry: field(formData, "industry"),
      location: field(formData, "location"),
      website: field(formData, "website"),
      source: field(formData, "source"),
    });
  if (!parsed.success) backWith(back, "error", parsed.error.issues[0]?.message ?? "Check the client details.");
  const d = parsed.data;
  const db = getDb();
  await db.batch([
    db
      .update(clients)
      .set({ industry: d.industry || null, location: d.location || null, website: d.website || null, source: d.source || null })
      .where(eq(clients.id, client.id)),
    eventInsert({
      workspaceId: staff.workspaceId,
      actorId: viewer.userId,
      verb: "client.updated",
      subjectType: "client",
      subjectId: client.id,
      payload: d,
    }),
  ]);
  revalidateCrm(client.id);
  backWith(back, "notice", "Client saved.");
}

export async function addContact(formData: FormData) {
  const { viewer, staff } = await requireStaff();
  const client = await ownClient(field(formData, "clientId"), staff.workspaceId);
  if (!client) backWith("/admin/clients", "error", "That client no longer exists.");
  const back = clientPath(client.id, field(formData, "dealId") || null);
  const parsed = z
    .object({ name: text(120).min(1, "Add the contact's name."), role: text(120), email: optionalEmail, phone: text(40) })
    .safeParse({
      name: field(formData, "name"),
      role: field(formData, "role"),
      email: field(formData, "email"),
      phone: field(formData, "phone"),
    });
  if (!parsed.success) backWith(back, "error", parsed.error.issues[0]?.message ?? "Check the contact details.");
  const d = parsed.data;
  const db = getDb();
  const existing = await db.select({ id: contacts.id }).from(contacts).where(eq(contacts.clientId, client.id)).limit(1);
  const email = d.email ? normalizeAddress(d.email) : null;
  const id = crypto.randomUUID();
  await db.batch([
    db.insert(contacts).values({
      id,
      workspaceId: staff.workspaceId,
      clientId: client.id,
      name: d.name,
      role: d.role || null,
      email,
      phone: d.phone || null,
      isPrimary: existing.length === 0,
    }),
    eventInsert({
      workspaceId: staff.workspaceId,
      actorId: viewer.userId,
      verb: "contact.created",
      subjectType: "contact",
      subjectId: id,
      payload: { clientId: client.id, name: d.name },
    }),
  ]);
  // Mail already waiting from this address joins the client now.
  if (email) {
    await db
      .update(emailThreads)
      .set({ clientId: client.id })
      .where(and(eq(emailThreads.workspaceId, staff.workspaceId), isNull(emailThreads.clientId), eq(emailThreads.counterpartEmail, email)));
  }
  revalidateCrm(client.id);
  backWith(back, "notice", `${d.name} added.`);
}

export async function makePrimaryContact(formData: FormData) {
  const { staff } = await requireStaff();
  const contactId = field(formData, "contactId");
  if (!uuid.safeParse(contactId).success) backWith("/admin/clients", "error", "Contact not found.");
  const db = getDb();
  const [contact] = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.id, contactId), eq(contacts.workspaceId, staff.workspaceId)))
    .limit(1);
  if (!contact) backWith("/admin/clients", "error", "Contact not found.");
  await db.batch([
    db.update(contacts).set({ isPrimary: false }).where(eq(contacts.clientId, contact.clientId)),
    db.update(contacts).set({ isPrimary: true }).where(eq(contacts.id, contact.id)),
  ]);
  revalidateCrm(contact.clientId);
  backWith(clientPath(contact.clientId, field(formData, "dealId") || null), "notice", `${contact.name} is now the main contact.`);
}

export async function addNote(formData: FormData) {
  const { viewer, staff } = await requireStaff();
  const client = await ownClient(field(formData, "clientId"), staff.workspaceId);
  if (!client) backWith("/admin/clients", "error", "That client no longer exists.");
  const dealId = field(formData, "dealId");
  const deal = dealId ? await ownDeal(dealId, staff.workspaceId) : null;
  const back = clientPath(client.id, deal?.id);
  const parsed = z
    .object({ body: text(5000).min(1, "Write something first."), type: z.enum(["note", "call", "meeting"]) })
    .safeParse({ body: field(formData, "body"), type: field(formData, "type") || "note" });
  if (!parsed.success) backWith(back, "error", parsed.error.issues[0]?.message ?? "Write something first.");
  await getDb()
    .insert(crmActivities)
    .values({
      workspaceId: staff.workspaceId,
      clientId: client.id,
      dealId: deal && deal.clientId === client.id ? deal.id : null,
      type: parsed.data.type,
      body: parsed.data.body,
      actorId: viewer.userId,
      actorEmail: viewer.email,
    });
  revalidateCrm(client.id);
  backWith(back, "notice", "Saved to the timeline.");
}

/* ---- Inbox ---- */

/**
 * Files an unassigned thread under a client. The sender becomes a contact, so
 * their next email threads to the client on its own. "new" creates the client
 * and a lead deal from the email.
 */
export async function assignThread(formData: FormData) {
  const { viewer, staff } = await requireStaff();
  const threadId = field(formData, "threadId");
  const target = field(formData, "clientId");
  const back = `/admin/inbox/${threadId}`;
  if (!uuid.safeParse(threadId).success) backWith("/admin/inbox", "error", "Thread not found.");
  const db = getDb();
  const [thread] = await db
    .select()
    .from(emailThreads)
    .where(and(eq(emailThreads.id, threadId), eq(emailThreads.workspaceId, staff.workspaceId)))
    .limit(1);
  if (!thread) backWith("/admin/inbox", "error", "Thread not found.");

  const ops: BatchItem<"pg">[] = [];
  let clientId: string;
  let dealId: string | null = null;
  const email = thread.counterpartEmail;
  const name = thread.counterpartName || email?.split("@")[0] || "New contact";

  if (target === "new") {
    const company = field(formData, "companyName").trim() || email?.split("@")[1] || name;
    clientId = crypto.randomUUID();
    dealId = crypto.randomUUID();
    ops.push(
      db.insert(clients).values({ id: clientId, workspaceId: staff.workspaceId, name: company.slice(0, 120), source: "Inbound email" }),
      db.insert(deals).values({
        id: dealId,
        workspaceId: staff.workspaceId,
        clientId,
        title: (thread.subject || "New enquiry").slice(0, 140),
        stage: "lead",
        ownerId: viewer.userId,
        ownerEmail: viewer.email,
      }),
      eventInsert({
        workspaceId: staff.workspaceId,
        actorId: viewer.userId,
        verb: "client.created",
        subjectType: "client",
        subjectId: clientId,
        payload: { name: company, via: "inbox" },
      }),
    );
  } else {
    const client = await ownClient(target, staff.workspaceId);
    if (!client) backWith(back, "error", "Pick a client.");
    clientId = client.id;
    const [open] = await db
      .select({ id: deals.id })
      .from(deals)
      .where(and(eq(deals.clientId, clientId), ne(deals.stage, "lost")))
      .orderBy(desc(deals.createdAt))
      .limit(1);
    dealId = open?.id ?? null;
  }

  if (email) {
    const [known] = await db
      .select({ id: contacts.id })
      .from(contacts)
      .where(and(eq(contacts.clientId, clientId), eq(contacts.email, email)))
      .limit(1);
    if (!known) {
      const [anyContact] = target === "new" ? [] : await db.select({ id: contacts.id }).from(contacts).where(eq(contacts.clientId, clientId)).limit(1);
      ops.push(
        db.insert(contacts).values({
          workspaceId: staff.workspaceId,
          clientId,
          name: name.slice(0, 120),
          email,
          isPrimary: !anyContact,
        }),
      );
    }
  }

  ops.push(
    db.update(emailThreads).set({ clientId, dealId }).where(eq(emailThreads.id, thread.id)),
    db.insert(crmActivities).values({
      workspaceId: staff.workspaceId,
      clientId,
      dealId,
      type: "email",
      body: thread.subject,
      meta: { direction: "inbound", threadId: thread.id, from: email },
      actorId: viewer.userId,
      actorEmail: viewer.email,
    }),
    eventInsert({
      workspaceId: staff.workspaceId,
      actorId: viewer.userId,
      verb: "email_thread.assigned",
      subjectType: "email_thread",
      subjectId: thread.id,
      payload: { clientId },
    }),
  );
  await db.batch(ops as Batch);
  // Other unassigned mail from the same sender goes with it.
  if (email) {
    await db
      .update(emailThreads)
      .set({ clientId })
      .where(and(eq(emailThreads.workspaceId, staff.workspaceId), isNull(emailThreads.clientId), eq(emailThreads.counterpartEmail, email)));
  }
  revalidateCrm(clientId);
  backWith(back, "notice", "Filed. Future mail from this sender goes straight to the client.");
}

export async function sendReply(formData: FormData) {
  const { viewer, staff } = await requireStaff();
  const threadId = field(formData, "threadId");
  const back = `/admin/inbox/${threadId}`;
  if (!uuid.safeParse(threadId).success) backWith("/admin/inbox", "error", "Thread not found.");
  const parsed = z
    .object({ subject: text(200).min(1, "Add a subject."), body: text(20_000).min(1, "Write a reply first.") })
    .safeParse({ subject: field(formData, "subject"), body: field(formData, "body") });
  if (!parsed.success) backWith(back, "error", parsed.error.issues[0]?.message ?? "Write a reply first.");

  const db = getDb();
  const [thread] = await db
    .select()
    .from(emailThreads)
    .where(and(eq(emailThreads.id, threadId), eq(emailThreads.workspaceId, staff.workspaceId)))
    .limit(1);
  if (!thread?.counterpartEmail) backWith(back, "error", "This thread has no address to reply to.");

  let sent: boolean;
  try {
    ({ sent } = await sendThreadEmail({
      workspaceId: staff.workspaceId,
      threadId: thread.id,
      to: thread.counterpartEmail,
      subject: parsed.data.subject,
      body: parsed.data.body,
      sentBy: viewer.userId,
    }));
  } catch (error) {
    console.error("[crm] reply failed", error);
    backWith(back, "error", "Couldn't send. Nothing went out; try again.");
  }
  if (thread.clientId) {
    await db.insert(crmActivities).values({
      workspaceId: staff.workspaceId,
      clientId: thread.clientId,
      dealId: thread.dealId,
      type: "email",
      body: parsed.data.subject,
      meta: { direction: "outbound", threadId: thread.id },
      actorId: viewer.userId,
      actorEmail: viewer.email,
    });
  }
  revalidateCrm(thread.clientId);
  backWith(back, "notice", sent ? "Sent." : "Saved, not sent: email is off in development.");
}

/** Starts a new conversation with a client's contact from the portal. */
export async function startThread(formData: FormData) {
  const { staff } = await requireStaff();
  const contactId = field(formData, "contactId");
  if (!uuid.safeParse(contactId).success) backWith("/admin/inbox", "error", "Contact not found.");
  const db = getDb();
  const [contact] = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.id, contactId), eq(contacts.workspaceId, staff.workspaceId)))
    .limit(1);
  if (!contact?.email) backWith("/admin/inbox", "error", "That contact has no email address.");
  const dealId = field(formData, "dealId");
  const deal = dealId ? await ownDeal(dealId, staff.workspaceId) : null;
  const id = crypto.randomUUID();
  await db.insert(emailThreads).values({
    id,
    workspaceId: staff.workspaceId,
    clientId: contact.clientId,
    dealId: deal?.clientId === contact.clientId ? deal.id : null,
    subject: field(formData, "subject").trim().slice(0, 200) || "Hello from SKOX",
    counterpartEmail: contact.email,
    counterpartName: contact.name,
    unread: false,
  });
  redirect(`/admin/inbox/${id}`);
}

export async function archiveThread(formData: FormData) {
  const { staff } = await requireStaff();
  const threadId = field(formData, "threadId");
  if (!uuid.safeParse(threadId).success) backWith("/admin/inbox", "error", "Thread not found.");
  await getDb()
    .update(emailThreads)
    .set({ archived: true, unread: false })
    .where(and(eq(emailThreads.id, threadId), eq(emailThreads.workspaceId, staff.workspaceId)));
  revalidateCrm();
  backWith("/admin/inbox", "notice", "Archived. New mail on it brings it back.");
}

