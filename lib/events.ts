import { getDb } from "@/lib/db";
import { events } from "@/lib/db/schema";

export type PortalEvent = {
  workspaceId: string;
  projectId?: string | null;
  actorId: string;
  verb: string;
  subjectType: string;
  subjectId?: string | null;
  payload?: Record<string, unknown>;
};

/**
 * An insert for the audit trail. Returned unexecuted so callers can put it in
 * the same `db.batch([...])` as the change it records: both land, or neither.
 */
export function eventInsert(e: PortalEvent) {
  return getDb()
    .insert(events)
    .values({
      workspaceId: e.workspaceId,
      projectId: e.projectId ?? null,
      actorId: e.actorId,
      verb: e.verb,
      subjectType: e.subjectType,
      subjectId: e.subjectId ?? null,
      payload: e.payload ?? {},
    });
}
