"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { clients, memberships, onboardings, projects, type Onboarding } from "@/lib/db/schema";
import { eventInsert } from "@/lib/events";
import { PROJECT_KINDS } from "@/lib/format";
import { backWith } from "@/lib/http";
import { notifyLater, portalLink, staffRecipients } from "@/lib/notify";
import { accessFor, questionsFor } from "@/lib/onboarding-content";
import { canSkip, isComplete, isStepKey, nextStep, stepsFor } from "@/lib/onboarding-flow";
import { addClientPerson, agreementState, completeOnboarding } from "@/lib/onboarding-server";
import { can, canInviteRole, normalizeEmail } from "@/lib/permissions";
import { projectForAction } from "@/lib/project-access";

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * Saves one step of the welcome flow and moves the client forward. Each step
 * saves on its own, so a client can leave at any point and pick up later.
 */
export async function saveWelcomeStep(formData: FormData) {
  const ctx = await projectForAction(formData.get("projectId"));
  if (!ctx.ok) redirect("/");
  const { project, client, viewer, access } = ctx;
  const step = formData.get("step");
  if (!isStepKey(step)) redirect(`/projects/${project.id}/welcome`);
  const intentRaw = String(formData.get("intent") ?? "continue");
  const intent = intentRaw === "skip" || intentRaw === "kind" ? intentRaw : "continue";
  const base = `/projects/${project.id}/welcome`;
  const here = `${base}?step=${step}`;
  const db = getDb();
  const [o] = await db.select().from(onboardings).where(eq(onboardings.projectId, project.id)).limit(1);
  if (!o) redirect(`/projects/${project.id}`);
  // Setup belongs to the client's approvers (and SKOX). Teammates can look, not edit,
  // and once it's finished only SKOX can change the answers.
  if (!access.isStaff && (!can.approve(access) || o.status === "completed")) {
    backWith(`${base}?step=${step}`, "notice", o.status === "completed" ? "Setup is finished. Ask SKOX if something needs changing." : "Your approver handles setup. You can look around.");
  }

  const text = (key: string, max = 4000) => String(formData.get(key) ?? "").trim().slice(0, max);
  const all = (key: string) => formData.getAll(key).map((v) => String(v).trim()).filter(Boolean);
  const patch: Partial<Onboarding> = {};
  let state: "done" | "skipped" = intent === "skip" ? "skipped" : "done";
  const agreement = await agreementState(project.id, project.status);

  if (intent === "skip" && !canSkip(step)) {
    backWith(here, "error", "This one matters most to your project. It only takes a couple of minutes.");
  }

  if (intent === "kind") {
    const kind = text("project_kind", 40);
    if (PROJECT_KINDS.some((k) => k.value === kind) && kind !== project.kind) {
      await db.update(projects).set({ kind }).where(eq(projects.id, project.id));
      revalidatePath(base);
    }
    backWith(here, "notice", "Updated. These questions fit your project now.");
  }

  if (intent !== "skip") {
    switch (step) {
      case "welcome": {
        if (o.callRecap) {
          const answer = text("recap_answer", 10);
          if (answer !== "yes" && answer !== "add") backWith(here, "error", "Let us know whether our recap sounds right.");
          const feedback = text("recap_feedback", 4000);
          if (answer === "add" && !feedback) backWith(here, "error", "Tell us what to add or adjust so we get it right.");
          patch.recapConfirmed = answer === "yes";
          patch.recapFeedback = answer === "add" ? feedback : null;
          if (answer === "add" && feedback !== (o.recapFeedback ?? "")) {
            notifyLater(() => staffRecipients(project.workspaceId), {
              subject: `${client.name} added to the call recap`,
              preheader: feedback.slice(0, 140),
              heading: "A note on the call recap",
              paragraphs: [`${viewer.email} added this to what we heard on the call for ${project.name}:`, feedback],
              cta: { label: "Open the brief", href: portalLink(`/admin/projects/${project.id}/brief`) },
            });
          }
        }
        break;
      }
      case "agreement": {
        // Only counts as done once it's signed and paid; otherwise the Get started card keeps it visible.
        state = agreement.settled ? "done" : "skipped";
        break;
      }
      case "you": {
        const name = text("contact_name", 120);
        const company = text("company_name", 120);
        if (!name || !company) backWith(here, "error", "Add your name and your company name.");
        const website = text("company_website", 300);
        if (website && !/^https?:\/\/\S+\.\S+/.test(website)) backWith(here, "error", "Website addresses start with https://");
        patch.contact = {
          name,
          role: text("contact_role", 120),
          phone: text("contact_phone", 40),
          preferred: text("contact_preferred", 40),
          times: all("contact_times").join(", "),
          website,
        };
        if (company !== client.name) {
          await db.update(clients).set({ name: company }).where(eq(clients.id, client.id));
        }
        break;
      }
      case "team": {
        const invites = [1, 2, 3]
          .map((i) => ({ email: normalizeEmail(text(`invite_email_${i}`, 200)), role: text(`invite_role_${i}`, 30) }))
          .filter((r) => r.email);
        for (const r of invites) {
          if (!z.email().safeParse(r.email).success) backWith(here, "error", `${r.email} doesn't look like an email address.`);
        }
        const roleEmails = {
          approver: normalizeEmail(text("team_approver", 200)),
          signer: normalizeEmail(text("team_signer", 200)),
          billing: normalizeEmail(text("team_billing", 200)),
        };
        for (const v of Object.values(roleEmails)) {
          if (v && !z.email().safeParse(v).success) backWith(here, "error", `${v} doesn't look like an email address.`);
        }
        const toAdd = new Map<string, "client_approver" | "client_member">();
        for (const r of invites) toAdd.set(r.email, r.role === "client_approver" ? "client_approver" : "client_member");
        // Whoever approves, signs or pays needs approver rights in the portal.
        for (const v of Object.values(roleEmails)) if (v) toAdd.set(v, "client_approver");
        const existing = await db.select().from(memberships).where(eq(memberships.clientId, client.id));
        for (const [email, role] of toAdd) {
          const current = existing.find((m) => m.email === email);
          if (current) {
            if (role === "client_approver" && current.role === "client_member" && canInviteRole(access, "client_approver")) {
              await db.update(memberships).set({ role: "client_approver" }).where(and(eq(memberships.id, current.id)));
            }
            continue;
          }
          if (!canInviteRole(access, role)) backWith(here, "error", "Only an approver can add teammates. Ask whoever invited you.");
          await addClientPerson({
            workspaceId: project.workspaceId,
            clientId: client.id,
            projectId: project.id,
            projectName: project.name,
            companyName: client.name,
            email,
            role,
            invitedByUserId: viewer.userId,
            invitedByLabel: o.contact.name || viewer.email,
          });
        }
        patch.team = roleEmails;
        break;
      }
      case "project": {
        const answers: Record<string, string | string[]> = {};
        let missing: string | null = null;
        for (const q of questionsFor(project.kind)) {
          const value = q.type === "multi" ? all(`q_${q.id}`).slice(0, 20) : text(`q_${q.id}`, 4000);
          if (!missing && q.required && (Array.isArray(value) ? value.length === 0 : !value)) missing = q.label;
          answers[q.id] = value;
        }
        if (missing) {
          // Keep everything they typed, then point at the one that's missing.
          await db.update(onboardings).set({ answers, lastActivityAt: new Date() }).where(eq(onboardings.id, o.id));
          backWith(here, "error", `One more: “${missing}”. Everything else you wrote is saved.`);
        }
        patch.answers = answers;
        break;
      }
      case "brand": {
        const color = (k: string, fallback: string) => (HEX.test(text(k, 7)) ? text(k, 7) : fallback);
        patch.brand = {
          none: formData.get("brand_none") === "on",
          primary: color("brand_primary", "#1c201d"),
          secondary: color("brand_secondary", "#faf9f6"),
          accent: color("brand_accent", "#e4a907"),
          fonts: text("brand_fonts", 200),
          tone: all("brand_tone").slice(0, 3),
          notes: text("brand_notes", 2000),
        };
        break;
      }
      case "access": {
        const accessState: Record<string, { status: string; note?: string }> = {};
        for (const item of accessFor(project.kind)) {
          const status = text(`access_${item.id}`, 10);
          accessState[item.id] = {
            status: ["done", "help", "na"].includes(status) ? status : "pending",
            note: text(`accessnote_${item.id}`, 500) || undefined,
          };
        }
        const other = text("access_other", 2000);
        if (other) accessState.other = { status: "note", note: other };
        patch.access = accessState;
        break;
      }
      case "kickoff": {
        const status = text("kickoff_status", 20);
        patch.kickoff = {
          status: status === "booked" ? "booked" : "reach_out",
          times: text("kickoff_times", 300),
          notes: text("kickoff_notes", 2000),
        };
        break;
      }
    }
  }

  const now = new Date();
  // Merge in SQL so two tabs (or a double click) never overwrite each other's
  // steps, and never move a finished setup back to "in progress".
  const [saved] = await db.batch([
    db
      .update(onboardings)
      .set({
        ...patch,
        steps: sql`${onboardings.steps} || ${JSON.stringify({ [step]: state })}::jsonb`,
        status: sql`case when ${onboardings.status} = 'completed' then 'completed'::onboarding_status else 'in_progress'::onboarding_status end`,
        startedAt: sql`coalesce(${onboardings.startedAt}, now())`,
        lastActivityAt: now,
      })
      .where(eq(onboardings.id, o.id))
      .returning({ steps: onboardings.steps, status: onboardings.status }),
    eventInsert({
      workspaceId: project.workspaceId,
      projectId: project.id,
      actorId: viewer.userId,
      verb: "onboarding.step_saved",
      subjectType: "onboarding",
      subjectId: o.id,
      payload: { step, state },
    }),
  ]);

  const steps = saved[0]?.steps ?? { ...o.steps, [step]: state };
  const flow = stepsFor({ hasAgreement: agreement.hasAgreement });
  revalidatePath(base);
  revalidatePath(`/projects/${project.id}`);
  if (saved[0]?.status !== "completed" && isComplete(steps, flow)) {
    await completeOnboarding({ ...o, ...patch, steps } as Onboarding, viewer.userId);
    redirect(`${base}?step=done`);
  }
  redirect(`${base}?step=${nextStep(steps, flow) ?? "done"}`);
}
