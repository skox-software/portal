import { and, desc, eq, ne } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  clients,
  documents,
  invoices,
  memberships,
  onboardings,
  projects,
  tasks,
  workspaces,
  type Onboarding,
} from "@/lib/db/schema";
import type { EmailContent } from "@/lib/email";
import { eventInsert } from "@/lib/events";
import { formatDate } from "@/lib/format";
import { notifyLater, portalLink, staffRecipients } from "@/lib/notify";
import { startSteps } from "@/lib/onboarding";
import { stepsFor, type StepKey } from "@/lib/onboarding-flow";

/** Where the welcome email lands: sign-in with the email already filled in. */
export function welcomeLink(email: string) {
  return portalLink(`/sign-in?email=${encodeURIComponent(email)}`);
}

/**
 * The one email a new client gets. It answers "what now?" with a clear first
 * step, so the decision they just made feels organized, not open-ended.
 */
export function welcomeEmail(input: {
  email: string;
  firstName?: string | null;
  companyName: string;
  projectName: string;
  teamIntro?: string | null;
  hasAgreement?: boolean;
}): EmailContent {
  const hello = input.firstName ? `Hi ${input.firstName},` : "Hello,";
  return {
    subject: `Welcome to UnBusy: ${input.projectName} starts here`,
    preheader: input.hasAgreement
      ? "Your agreement is ready. Everything for your project lives in one place."
      : "Everything for your project lives in one place. Here's your first step.",
    heading: "Welcome to UnBusy",
    paragraphs: [
      hello,
      `Thank you for choosing UnBusy. From today, everything for ${input.projectName} lives in your own client portal: ${input.hasAgreement ? "your agreement, " : ""}updates, designs to review, files and invoices, all in one place.`,
      input.hasAgreement
        ? "Please review and sign your agreement in the portal, then pay the deposit. Next, complete the project setup questions about your goals, brand and access requirements. Your progress is saved automatically."
        : "Start by completing your project setup and scheduling your kickoff meeting. Allow approximately 15 minutes to share your goals, brand materials and access requirements. Your progress is saved automatically.",
      `Sign in with this email address (${input.email}). We'll send you a 6-digit code, no password needed.`,
    ],
    cta: { label: input.hasAgreement ? "Review your agreement" : "Complete project setup", href: welcomeLink(input.email) },
    footnote: input.teamIntro ? `${input.teamIntro}, UnBusy · Please reply to this email if you have any questions.` : "Please reply to this email if you have any questions.",
  };
}

/** The agreement + deposit linked to this project, if UnBusy attached them. */
export async function agreementState(projectId: string, projectStatus: Parameters<typeof startSteps>[0]["projectStatus"]) {
  const db = getDb();
  const [deposit] = await db
    .select({ invoice: invoices, doc: documents })
    .from(invoices)
    .leftJoin(documents, eq(documents.id, invoices.documentId))
    .where(and(eq(invoices.projectId, projectId), ne(invoices.status, "void")))
    .orderBy(desc(invoices.createdAt))
    .limit(1);
  const [doc] = deposit?.doc
    ? [deposit.doc]
    : await db
        .select()
        .from(documents)
        .where(and(eq(documents.projectId, projectId), ne(documents.status, "void")))
        .orderBy(desc(documents.createdAt))
        .limit(1);
  const steps = startSteps({
    projectId,
    projectStatus,
    document: doc ? { id: doc.id, title: doc.title, status: doc.status } : null,
    invoice: deposit ? { id: deposit.invoice.id, number: deposit.invoice.number, status: deposit.invoice.status } : null,
  });
  return {
    hasAgreement: Boolean(doc || deposit),
    document: doc ?? null,
    invoice: deposit?.invoice ?? null,
    steps,
    settled: Boolean((!doc || doc.status === "completed") && (!deposit || deposit.invoice.status === "paid")),
  };
}

/** Adds a client-side person (if new) and emails them how to sign in. */
export async function addClientPerson(input: {
  workspaceId: string;
  clientId: string;
  projectId: string;
  projectName: string;
  companyName: string;
  email: string;
  role: "client_approver" | "client_member";
  invitedByUserId: string;
  invitedByLabel: string;
}) {
  const db = getDb();
  const [existing] = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.clientId, input.clientId), eq(memberships.email, input.email)))
    .limit(1);
  if (existing) return false;
  const id = crypto.randomUUID();
  await db.batch([
    db.insert(memberships).values({
      id,
      workspaceId: input.workspaceId,
      clientId: input.clientId,
      email: input.email,
      role: input.role,
      invitedBy: input.invitedByUserId,
    }),
    eventInsert({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      actorId: input.invitedByUserId,
      verb: "membership.invited",
      subjectType: "membership",
      subjectId: id,
      payload: { email: input.email, role: input.role, via: "onboarding" },
    }),
  ]);
  notifyLater(() => [input.email], {
    subject: `${input.invitedByLabel} added you to ${input.projectName}`,
    preheader: `${input.companyName} is working with UnBusy. Follow along in the portal.`,
    heading: `You're on the ${input.projectName} team`,
    paragraphs: [
      `${input.invitedByLabel} added you to ${input.companyName}'s project portal with UnBusy, where designs, updates, files and approvals live.`,
      `Sign in with this email address (${input.email}). We'll send a 6-digit code, no password needed.`,
    ],
    cta: { label: "Open the portal", href: welcomeLink(input.email) },
  });
  return true;
}

const SKIPPED_TODO: Partial<Record<StepKey, { title: string; completesOn?: "file_upload" }>> = {
  brand: { title: "Upload your logo and brand files", completesOn: "file_upload" },
  access: { title: "Share the access on your welcome checklist" },
  kickoff: { title: "Book your kickoff call" },
  team: { title: "Add your teammates and who approves, signs and pays" },
};

/**
 * Onboarding finished: skipped steps become the client's to-dos, UnBusy gets its
 * own to-dos, and both sides get an email. Safe to call twice (it checks status).
 */
export async function completeOnboarding(onboarding: Onboarding, actorUserId: string) {
  const db = getDb();
  const updated = await db
    .update(onboardings)
    .set({ status: "completed", completedAt: new Date(), lastActivityAt: new Date() })
    .where(and(eq(onboardings.id, onboarding.id), ne(onboardings.status, "completed")))
    .returning();
  if (updated.length === 0) return;

  const [row] = await db
    .select({ project: projects, client: clients, workspace: workspaces })
    .from(projects)
    .innerJoin(clients, eq(clients.id, projects.clientId))
    .innerJoin(workspaces, eq(workspaces.id, projects.workspaceId))
    .where(eq(projects.id, onboarding.projectId))
    .limit(1);
  if (!row) return;
  const { project, client, workspace } = row;
  const existing = await db.select({ title: tasks.title }).from(tasks).where(eq(tasks.projectId, project.id));
  const have = new Set(existing.map((t) => t.title));
  const inAWeek = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
  const steps = stepsFor({ hasAgreement: true });

  const clientTodos = steps
    .filter((s) => onboarding.steps[s.key] === "skipped" && SKIPPED_TODO[s.key] && !have.has(SKIPPED_TODO[s.key]!.title))
    .map((s) => ({
      workspaceId: project.workspaceId,
      projectId: project.id,
      side: "client" as const,
      title: SKIPPED_TODO[s.key]!.title,
      completesOn: SKIPPED_TODO[s.key]!.completesOn ?? null,
      dueOn: inAWeek,
      createdBy: actorUserId,
    }));
  const staffTodos = ["Review the project brief", "Confirm the delivery date at kickoff"]
    .filter((t) => !have.has(t))
    .map((title) => ({
      workspaceId: project.workspaceId,
      projectId: project.id,
      side: "skox" as const,
      title,
      dueOn: inAWeek,
      createdBy: actorUserId,
    }));

  try {
    await db.batch([
      ...(clientTodos.length ? [db.insert(tasks).values(clientTodos)] : []),
      ...(staffTodos.length ? [db.insert(tasks).values(staffTodos)] : []),
      eventInsert({
        workspaceId: project.workspaceId,
        projectId: project.id,
        actorId: actorUserId,
        verb: "onboarding.completed",
        subjectType: "onboarding",
        subjectId: onboarding.id,
        payload: { skipped: Object.entries(onboarding.steps).filter(([, v]) => v === "skipped").map(([k]) => k) },
      }),
    ] as unknown as Parameters<typeof db.batch>[0]);
  } catch (error) {
    // Release the claim so the next save can finish it (to-dos are de-duplicated by title).
    await db.update(onboardings).set({ status: "in_progress", completedAt: null }).where(eq(onboardings.id, onboarding.id));
    throw error;
  }

  const agreement = await agreementState(project.id, project.status);
  const contactName = onboarding.contact.name || client.name;
  notifyLater(() => staffRecipients(project.workspaceId), {
    subject: `${client.name} finished onboarding: brief ready`,
    preheader: `${contactName} completed their welcome for ${project.name}.`,
    heading: `${client.name} is ready for kickoff`,
    paragraphs: [
      `${contactName} finished onboarding for ${project.name}. Their goals, brand, access checklist and team are in the brief.`,
      ...(onboarding.recapConfirmed === false ? ["Heads up: they flagged changes to the call recap. Read their note first."] : []),
      onboarding.kickoff.status === "booked" ? "They've booked their kickoff call." : "They'd like you to reach out to schedule kickoff.",
    ],
    cta: { label: "Open the brief", href: portalLink(`/admin/projects/${project.id}/brief`) },
  });
  notifyLater(() => [onboarding.invitedEmail], {
    subject: agreement.hasAgreement && !agreement.settled ? `Your setup for ${project.name} is saved` : `You're all set for ${project.name}`,
    preheader: agreement.hasAgreement && !agreement.settled ? "One step left: the agreement and deposit." : "Your project next steps and schedule.",
    heading: agreement.hasAgreement && !agreement.settled ? "Your project setup has been saved" : "Thank you for completing your project setup",
    paragraphs: [
      agreement.hasAgreement && !agreement.settled
        ? `Your answers are saved. Signing the agreement and paying the deposit is all that's left before we start building ${project.name}.`
        : `We have everything we need to get ${project.name} moving.`,
      [
        onboarding.kickoff.status === "booked" ? "• Kickoff meeting: scheduled" : "• Kickoff: we'll reach out within one business day to schedule it",
        "• First progress update: within a week, then every week",
        project.dateTentative ? "• Launch date: we set it together at kickoff" : `• Launch: ${formatDate(project.deliveryDate)}`,
      ].join("\n"),
      "Your project information is available in the portal. We will notify you when your input or approval is required.",
    ],
    cta: { label: "Go to your project", href: portalLink(`/projects/${project.id}`) },
    footnote: workspace.teamIntro ? `${workspace.teamIntro}, UnBusy` : undefined,
  });
}
