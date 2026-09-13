"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireViewer } from "@/lib/access";
import { getDb } from "@/lib/db";
import { memberships } from "@/lib/db/schema";
import { backWith } from "@/lib/http";

/** Turns optional emails on or off per membership. Only the viewer's own rows change. */
export async function saveEmailPreferences(formData: FormData) {
  const viewer = await requireViewer();
  const on = new Set(formData.getAll("emailUpdates").map(String));
  const db = getDb();
  await Promise.all(
    viewer.memberships.map((m) =>
      db.update(memberships).set({ emailUpdates: on.has(m.id) }).where(eq(memberships.id, m.id)),
    ),
  );
  revalidatePath("/settings");
  backWith("/settings", "notice", "Preferences saved.");
}
