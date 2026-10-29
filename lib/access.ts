import { and, eq, isNull } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { getAuth } from "@/lib/auth/server";
import { getDb } from "@/lib/db";
import { clients, memberships, projects, type Membership } from "@/lib/db/schema";
import {
  accessToProject,
  normalizeEmail,
  repMembershipIn,
  staffMembershipIn,
  type ProjectAccess,
} from "@/lib/permissions";

export type Viewer = {
  userId: string;
  email: string;
  name: string | null;
  memberships: Membership[];
};

/**
 * The signed-in person and their memberships, or null when signed out.
 *
 * Invitations are stored against an email address. They are attached to the
 * account only when that address is verified (a magic-link sign-in verifies
 * it), so nobody can claim someone else's invitation by signing up with their
 * address and a password.
 */
export async function getViewer(): Promise<Viewer | null> {
  let session: Awaited<ReturnType<ReturnType<typeof getAuth>["getSession"]>>["data"] = null;
  try {
    ({ data: session } = await getAuth().getSession());
  } catch (error) {
    // An expired session outside the proxy (e.g. the sign-in page) tries to
    // refresh cookies during render, which Next forbids. Treat it as signed out.
    console.warn("[access] could not read session; treating as signed out", (error as Error).message);
    return null;
  }
  const user = session?.user;
  if (!user?.id || !user.email) return null;
  // The portal only signs people in by emailed code, which verifies the address.
  // An unverified account (e.g. created some other way) gets no access at all.
  if (!user.emailVerified) return null;

  const email = normalizeEmail(user.email);
  const db = getDb();

  if (user.emailVerified) {
    await db
      .update(memberships)
      .set({ userId: user.id, acceptedAt: new Date() })
      .where(and(eq(memberships.email, email), isNull(memberships.userId)));
  }

  const rows = await db.select().from(memberships).where(eq(memberships.userId, user.id));
  return { userId: user.id, email, name: user.name || null, memberships: rows };
}

export async function requireViewer() {
  const viewer = await getViewer();
  if (!viewer) redirect("/sign-in");
  return viewer;
}

/** UnBusy team only. Everyone else gets a 404 rather than a hint the page exists. */
export async function requireStaff() {
  const viewer = await requireViewer();
  const staff = staffMembershipIn(viewer.memberships);
  if (!staff) notFound();
  return { viewer, staff };
}

/** Sales reps only. Staff and clients get a 404 too: the rep area is a separate world. */
export async function requireRep() {
  const viewer = await requireViewer();
  const rep = repMembershipIn(viewer.memberships);
  if (!rep) notFound();
  return { viewer, rep };
}

const uuid = z.uuid();

/** Loads a project the viewer is allowed to see, or 404s. */
export async function requireProjectAccess(projectId: string): Promise<{
  viewer: Viewer;
  project: typeof projects.$inferSelect;
  client: typeof clients.$inferSelect;
  access: ProjectAccess;
}> {
  const viewer = await requireViewer();
  if (!uuid.safeParse(projectId).success) notFound();

  const [row] = await getDb()
    .select({ project: projects, client: clients })
    .from(projects)
    .innerJoin(clients, eq(clients.id, projects.clientId))
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!row) notFound();

  const access = accessToProject(viewer.memberships, row.project);
  if (!access) notFound();

  return { viewer, project: row.project, client: row.client, access };
}
