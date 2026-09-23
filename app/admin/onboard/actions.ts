"use server";

import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaff } from "@/lib/access";
import { ensureAuthAccount } from "@/lib/auth/accounts";
import { getDb } from "@/lib/db";
import { clients, deals, documents, invoices, memberships, milestones, onboardings, projects, workspaces } from "@/lib/db/schema";
import { eventInsert } from "@/lib/events";
import { midpoint, PROJECT_KINDS, todayIso } from "@/lib/format";
import { backWith } from "@/lib/http";
import { notifyLater } from "@/lib/notify";
import { companyFromEmail } from "@/lib/onboarding-content";
import { welcomeEmail } from "@/lib/onboarding-server";
import { normalizeEmail } from "@/lib/permissions";

const KINDS = PROJECT_KINDS.map((k) => k.value) as [string, ...string[]];
const addDays = (iso: string, days: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * The one-email start: creates the client, their login, the project, the
 * onboarding record, and sends the welcome. Everything but the email is optional.
 */
export async function startOnboarding(formData: FormData) {
  const { viewer, staff } = await requireStaff();
  const back = "/admin/onboard";
  const parsed = z
    .object({
      email: z.email().max(200),
      contactName: z.string().trim().max(120),
      companyName: z.string().trim().max(120),
      projectName: z.string().trim().max(140),
      kind: z.union([z.literal(""), z.enum(KINDS)]),
      deliveryDate: z.union([z.literal(""), z.iso.date()]),
      callRecap: z.string().trim().max(4000),
      internalNotes: z.string().trim().max(4000),
    })
    .safeParse({
      email: normalizeEmail(String(formData.get("email") ?? "")),
      contactName: formData.get("contactName") ?? "",
      companyName: formData.get("companyName") ?? "",
      projectName: formData.get("projectName") ?? "",
      kind: formData.get("kind") ?? "",
      deliveryDate: formData.get("deliveryDate") ?? "",
      callRecap: formData.get("callRecap") ?? "",
      internalNotes: formData.get("internalNotes") ?? "",
    });
  if (!parsed.success) backWith(back, "error", "Enter the client's email address.");
  const input = parsed.data;
  const db = getDb();
  const dealId = z.uuid().safeParse(formData.get("dealId")).data ?? null;

  const [already] = await db
    .select({ clientId: memberships.clientId })
    .from(memberships)
    .where(and(eq(memberships.workspaceId, staff.workspaceId), eq(memberships.email, input.email), isNotNull(memberships.clientId)))
    .limit(1);
  if (already?.clientId) {
    backWith(`/admin/clients/${already.clientId}`, "error", `${input.email} is already a client. Add a new project for them here.`);
  }

  const today = todayIso();
  if (input.deliveryDate && input.deliveryDate < today) backWith(back, "error", "The target date can't be in the past.");
  const deliveryDate = input.deliveryDate || addDays(today, 42);
  const companyName = input.companyName || companyFromEmail(input.email) || `New client (${input.email})`;
  const projectName = input.projectName || `${companyName} project`;
  const kind = input.kind || "web-app";
  const firstName = input.contactName.split(/\s+/)[0] || null;

  // Their sign-in account, so the first code arrives instantly. Not fatal if it fails:
  // the code sign-in creates the account on first use.
  const account = await ensureAuthAccount(input.email);

  const clientId = crypto.randomUUID();
  const projectId = crypto.randomUUID();
  const onboardingId = crypto.randomUUID();
  const base = { workspaceId: staff.workspaceId, projectId };
  await db.batch([
    db.insert(clients).values({ id: clientId, workspaceId: staff.workspaceId, name: companyName }),
    db.insert(projects).values({
      id: projectId,
      workspaceId: staff.workspaceId,
      clientId,
      name: projectName,
      kind,
      status: "kickoff",
      startedOn: today,
      deliveryDate,
      dateTentative: !input.deliveryDate,
    }),
    db.insert(milestones).values([
      { ...base, kind: "kickoff", title: "Kickoff", dueOn: addDays(today, 7), position: 0 },
      { ...base, kind: "halfway", title: "Halfway review", dueOn: midpoint(today, deliveryDate), position: 1 },
      { ...base, kind: "launch", title: "Launch", dueOn: deliveryDate, position: 2 },
    ]),
    db.insert(memberships).values({
      workspaceId: staff.workspaceId,
      clientId,
      email: input.email,
      role: "client_approver",
      invitedBy: viewer.userId,
    }),
    db.insert(onboardings).values({
      id: onboardingId,
      workspaceId: staff.workspaceId,
      projectId,
      invitedEmail: input.email,
      invitedBy: viewer.userId,
      callRecap: input.callRecap || null,
      internalNotes: input.internalNotes || null,
      contact: input.contactName ? { name: input.contactName } : {},
    }),
    // A Won deal from the pipeline now follows this project.
    ...(dealId
      ? [
          db
            .update(deals)
            .set({ clientId, projectId, stage: "won" })
            .where(and(eq(deals.id, dealId), eq(deals.workspaceId, staff.workspaceId), isNull(deals.projectId))),
        ]
      : []),
    eventInsert({
      workspaceId: staff.workspaceId,
      projectId,
      actorId: viewer.userId,
      verb: "onboarding.started",
      subjectType: "onboarding",
      subjectId: onboardingId,
      payload: { email: input.email, companyName },
    }),
  ]);

  void firstName;
  revalidatePath(back);
  backWith(
    `/admin/onboard/${projectId}`,
    "notice",
    `${companyName} is set up${account.ok ? "" : " (their login is created when they first sign in)"}. Attach the agreement and deposit, then send the welcome.`,
  );
}

/** Staff: the deposit for the onboarding agreement, created quietly (the welcome announces it). */
export async function addDeposit(formData: FormData) {
  const { viewer, staff } = await requireStaff();
  const projectId = String(formData.get("projectId") ?? "");
  const back = `/admin/onboard/${projectId}`;
  const parsed = z
    .object({
      projectId: z.uuid(),
      amount: z.coerce.number().positive().max(10_000_000),
      dueOn: z.iso.date(),
      title: z.string().trim().min(1).max(160),
      payUrl: z.union([z.literal(""), z.url({ protocol: /^https$/ })]),
      documentId: z.union([z.literal(""), z.uuid()]),
    })
    .safeParse({
      projectId,
      amount: formData.get("amount"),
      dueOn: formData.get("dueOn"),
      title: formData.get("title") || "Deposit",
      payUrl: formData.get("payUrl") ?? "",
      documentId: formData.get("documentId") ?? "",
    });
  if (!parsed.success) backWith(back, "error", "Add the deposit amount and due date. Pay links must start with https://");
  const input = parsed.data;
  const db = getDb();
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, input.projectId), eq(projects.workspaceId, staff.workspaceId)))
    .limit(1);
  if (!project) backWith("/admin/onboard", "error", "That project doesn't exist.");
  const count = await db.select({ id: invoices.id }).from(invoices).where(eq(invoices.workspaceId, staff.workspaceId));
  const id = crypto.randomUUID();
  await db.batch([
    db.insert(invoices).values({
      id,
      workspaceId: staff.workspaceId,
      projectId: project.id,
      number: `SKX-${new Date().getFullYear()}-${String(count.length + 1).padStart(3, "0")}`,
      title: input.title,
      amountCents: Math.round(input.amount * 100),
      dueOn: input.dueOn,
      payUrl: input.payUrl || null,
      documentId: input.documentId || null,
      createdBy: viewer.userId,
    }),
    eventInsert({
      workspaceId: staff.workspaceId,
      projectId: project.id,
      actorId: viewer.userId,
      verb: "invoice.created",
      subjectType: "invoice",
      subjectId: id,
      payload: { title: input.title, amountCents: Math.round(input.amount * 100), via: "onboarding" },
    }),
  ]);
  revalidatePath(back);
  backWith(back, "notice", "Deposit added. It unlocks for payment once the agreement is signed.");
}

/** Staff: the moment the client hears from us. One email, one clear first step. */
export async function sendWelcome(formData: FormData) {
  const { viewer, staff } = await requireStaff();
  const id = String(formData.get("onboardingId") ?? "");
  if (!z.uuid().safeParse(id).success) return;
  const db = getDb();
  const [row] = await db
    .select({ onboarding: onboardings, project: projects, client: clients, workspace: workspaces })
    .from(onboardings)
    .innerJoin(projects, eq(projects.id, onboardings.projectId))
    .innerJoin(clients, eq(clients.id, projects.clientId))
    .innerJoin(workspaces, eq(workspaces.id, onboardings.workspaceId))
    .where(and(eq(onboardings.id, id), eq(onboardings.workspaceId, staff.workspaceId)))
    .limit(1);
  if (!row) return;
  const [doc] = await db.select({ id: documents.id }).from(documents).where(eq(documents.projectId, row.project.id)).limit(1);
  const firstSend = !row.onboarding.welcomeSentAt;
  await db.batch([
    db.update(onboardings).set({ welcomeSentAt: new Date() }).where(eq(onboardings.id, id)),
    eventInsert({
      workspaceId: staff.workspaceId,
      projectId: row.project.id,
      actorId: viewer.userId,
      verb: firstSend ? "onboarding.welcome_sent" : "onboarding.welcome_resent",
      subjectType: "onboarding",
      subjectId: id,
    }),
  ]);
  notifyLater(() => [row.onboarding.invitedEmail], welcomeEmail({
    email: row.onboarding.invitedEmail,
    firstName: row.onboarding.contact.name?.split(/\s+/)[0],
    companyName: row.client.name,
    projectName: row.project.name,
    teamIntro: row.workspace.teamIntro,
    hasAgreement: Boolean(doc),
  }));
  revalidatePath("/admin/onboard");
  backWith("/admin/onboard", "notice", `Welcome ${firstSend ? "sent" : "re-sent"} to ${row.onboarding.invitedEmail}.`);
}

