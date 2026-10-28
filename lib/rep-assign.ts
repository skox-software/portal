import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { deals, memberships, projects, repProfiles } from "@/lib/db/schema";
import { sendEmail } from "@/lib/email";
import { portalLink } from "@/lib/notify";

/** Staff-side helpers for crediting sales reps on deals and projects. */

export type RepOption = { id: string; name: string; active: boolean };

export async function repOptions(workspaceId: string): Promise<RepOption[]> {
  const rows = await getDb()
    .select({ id: repProfiles.membershipId, name: repProfiles.displayName, status: repProfiles.status })
    .from(repProfiles)
    .where(eq(repProfiles.workspaceId, workspaceId))
    .orderBy(repProfiles.displayName);
  return rows.map((r) => ({ id: r.id, name: r.name, active: r.status === "active" }));
}

/**
 * Reads the "Sales rep" field: "" clears it, a uuid must be a rep in this
 * workspace, and a missing field leaves things as they are.
 */
export async function readRepField(formData: FormData, workspaceId: string): Promise<{ ok: true; value: string | null | undefined } | { ok: false }> {
  if (!formData.has("repMembershipId")) return { ok: true, value: undefined };
  const raw = String(formData.get("repMembershipId") ?? "");
  if (!raw) return { ok: true, value: null };
  const [row] = await getDb()
    .select({ id: repProfiles.membershipId })
    .from(repProfiles)
    .where(and(eq(repProfiles.membershipId, raw), eq(repProfiles.workspaceId, workspaceId)))
    .limit(1);
  return row ? { ok: true, value: row.id } : { ok: false };
}

/**
 * When a won deal already has a project and the project has no credited rep
 * yet, the deal's rep becomes the project's. An explicit project choice wins.
 */
export async function creditProjectFromDeal(projectId: string | null, repId: string | null | undefined) {
  if (!projectId || !repId) return;
  const db = getDb();
  const [project] = await db.select({ rep: projects.repMembershipId }).from(projects).where(eq(projects.id, projectId)).limit(1);
  if (project && !project.rep) await db.update(projects).set({ repMembershipId: repId }).where(eq(projects.id, projectId));
}

/** Tells reps about newly assigned leads, if they want those emails. */
export async function emailAssignedLeads(repId: string, dealIds: string[]) {
  if (!dealIds.length) return;
  const db = getDb();
  const [rep] = await db
    .select({ email: memberships.email, emailUpdates: memberships.emailUpdates, name: repProfiles.displayName })
    .from(memberships)
    .innerJoin(repProfiles, eq(repProfiles.membershipId, memberships.id))
    .where(eq(memberships.id, repId))
    .limit(1);
  if (!rep?.emailUpdates) return;
  const rows = await db.select({ company: deals.company }).from(deals).where(inArray(deals.id, dealIds)).limit(25);
  const n = dealIds.length;
  await sendEmail([rep.email], {
    subject: n === 1 ? `New lead: ${rows[0]?.company ?? "from UnBusy"}` : `${n} new leads from UnBusy`,
    preheader: "They're in your portal, ready to call.",
    heading: n === 1 ? "You have a new lead" : `You have ${n} new leads`,
    paragraphs: [rows.map((r) => r.company).join(", ") + (n > rows.length ? ` and ${n - rows.length} more` : "") + "."],
    cta: { label: "Open my leads", href: portalLink(n === 1 ? `/rep/leads/${dealIds[0]}` : "/rep/leads") },
  });
}
