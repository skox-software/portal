import { timingSafeEqual } from "node:crypto";
import { asc } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { workspaces } from "@/lib/db/schema";

/**
 * Seats call /api/company with `Authorization: Bearer $COMPANY_SERVICE_SECRET`.
 * Without the secret set, the API is closed. A seat can read the company,
 * log a run with proposals, and mark its own approved cards done. It can
 * never approve: that is a staff action on /admin/company.
 */
export function companyServiceAuthorized(request: Request) {
  const secret = process.env.COMPANY_SERVICE_SECRET;
  if (!secret) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** The workspace the company belongs to: COMPANY_WORKSPACE_ID, or the first workspace (UnBusy is the only one). */
export async function companyWorkspaceId(): Promise<string | null> {
  if (process.env.COMPANY_WORKSPACE_ID) return process.env.COMPANY_WORKSPACE_ID;
  const [ws] = await getDb().select({ id: workspaces.id }).from(workspaces).orderBy(asc(workspaces.createdAt)).limit(1);
  return ws?.id ?? null;
}
