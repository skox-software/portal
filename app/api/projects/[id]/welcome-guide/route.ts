import { eq } from "drizzle-orm";
import { z } from "zod";
import { getViewer } from "@/lib/access";
import { PORTAL_URL } from "@/lib/brand";
import { getDb } from "@/lib/db";
import { clients, onboardings, projects, workspaces } from "@/lib/db/schema";
import { formatDate, kindLabel } from "@/lib/format";
import { agreementState } from "@/lib/onboarding-server";
import { accessToProject } from "@/lib/permissions";
import { buildWelcomeGuide } from "@/lib/welcome-pdf";

export const maxDuration = 30;

/** The personal welcome guide PDF, for anyone with access to the project. */
export async function GET(request: Request, ctx: RouteContext<"/api/projects/[id]/welcome-guide">) {
  const { id } = await ctx.params;
  const viewer = await getViewer();
  if (!viewer) return new Response("Sign in", { status: 401 });
  if (!z.uuid().safeParse(id).success) return new Response("Not found", { status: 404 });

  const db = getDb();
  const [row] = await db
    .select({ project: projects, client: clients, workspace: workspaces })
    .from(projects)
    .innerJoin(clients, eq(clients.id, projects.clientId))
    .innerJoin(workspaces, eq(workspaces.id, projects.workspaceId))
    .where(eq(projects.id, id))
    .limit(1);
  if (!row || !accessToProject(viewer.memberships, row.project)) return new Response("Not found", { status: 404 });
  const { project, client, workspace } = row;

  const [o] = await db.select().from(onboardings).where(eq(onboardings.projectId, project.id)).limit(1);
  const agreement = await agreementState(project.id, project.status);
  const steps = o?.steps ?? {};

  const items: { label: string; done: boolean }[] = [
    ...(agreement.document ? [{ label: "Sign your agreement", done: agreement.document.status === "completed" }] : []),
    ...(agreement.invoice ? [{ label: "Settle the deposit", done: agreement.invoice.status === "paid" }] : []),
    { label: "Tell us about you and your team", done: steps.you === "done" },
    { label: "Answer the project questions", done: steps.project === "done" },
    { label: "Share your logo and brand files", done: steps.brand === "done" },
    { label: "Share the access we'll need", done: steps.access === "done" },
    { label: "Book your kickoff call", done: steps.kickoff === "done" || o?.status === "completed" },
  ];
  const nextIndex = items.findIndex((i) => !i.done);
  const checklist = items.map((item, i) => (i === nextIndex ? { ...item, note: "Next up" } : item));

  const companyName = client.name.startsWith("New client (") ? project.name : client.name;
  const goal = o?.answers.goal;
  const bytes = await buildWelcomeGuide({
    companyName,
    contactName: o?.contact.name || null,
    email: o?.invitedEmail ?? viewer.email,
    projectName: project.name,
    kindLabel: kindLabel(project.kind),
    launch: project.dateTentative ? null : formatDate(project.deliveryDate),
    recap: o?.callRecap ?? null,
    goal: typeof goal === "string" && goal ? goal : null,
    teamIntro: workspace.teamIntro,
    schedulingUrl: workspace.schedulingUrl,
    portalUrl: PORTAL_URL,
    hasAgreement: agreement.hasAgreement,
    checklist,
    preparedOn: new Date(),
  });

  const fileName = `UnBusy Welcome Guide - ${companyName}.pdf`;
  const download = new URL(request.url).searchParams.get("download") === "1";
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${fileName.replace(/["\r\n]/g, "")}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
