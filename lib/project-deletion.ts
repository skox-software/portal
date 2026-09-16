import { sql } from "drizzle-orm";
import { z } from "zod";
import { comments, events, feedback, memberships, projects, supportRequests, updates } from "./db/schema.ts";

export type DeleteProjectState = { error: string | null };
export type DeletedProject = { id: string; name: string; clientId: string };

export const deleteProjectInput = z.object({
  projectId: z.uuid(),
  confirmation: z.string().trim().min(1).max(140),
});

/** Delete and audit atomically, including when two staff members submit at once. */
export function projectDeletionQuery(input: {
  projectId: string;
  confirmation: string;
  workspaceId: string;
  actorId: string;
}) {
  return sql`
    WITH deleted_project AS (
      DELETE FROM ${projects}
      WHERE ${projects.id} = ${input.projectId}
        AND ${projects.workspaceId} = ${input.workspaceId}
        AND ${projects.name} = ${input.confirmation}
        AND EXISTS (
          SELECT 1 FROM ${memberships}
          WHERE ${memberships.workspaceId} = ${input.workspaceId}
            AND ${memberships.userId} = ${input.actorId}
            AND ${memberships.clientId} IS NULL
            AND ${memberships.role} IN ('staff_owner', 'staff')
        )
      RETURNING id, name, client_id, workspace_id
    ), deleted_comments AS (
      -- Comments have polymorphic parents, so no foreign key can cascade them.
      -- Sibling CTEs share a snapshot: the parent rows are still readable here.
      DELETE FROM ${comments}
      WHERE ${comments.workspaceId} = ${input.workspaceId}
        AND (${comments.parentType}::text, ${comments.parentId}) IN (
          SELECT 'feedback', ${feedback.id} FROM ${feedback}
            INNER JOIN deleted_project ON deleted_project.id = ${feedback.projectId}
          UNION ALL
          SELECT 'update', ${updates.id} FROM ${updates}
            INNER JOIN deleted_project ON deleted_project.id = ${updates.projectId}
          UNION ALL
          SELECT 'request', ${supportRequests.id} FROM ${supportRequests}
            INNER JOIN deleted_project ON deleted_project.id = ${supportRequests.projectId}
        )
    ), deletion_event AS (
      INSERT INTO ${events} (workspace_id, actor_id, verb, subject_type, subject_id, payload)
      SELECT workspace_id, ${input.actorId}, 'project.deleted', 'project', id::text,
        jsonb_build_object('name', name, 'clientId', client_id)
      FROM deleted_project
      RETURNING id
    )
    SELECT id, name, client_id AS "clientId" FROM deleted_project
  `;
}

type ProjectBlobStore = {
  list: (options: { prefix: string; cursor?: string; limit: number }) => Promise<{
    blobs: { pathname: string }[];
    hasMore: boolean;
    cursor?: string;
  }>;
  delete: (paths: string[]) => Promise<void>;
};

/** Call only after the database deletion commits. Includes unlinked uploads. */
export async function removeProjectBlobs(projectId: string, store: ProjectBlobStore) {
  const prefix = `projects/${z.uuid().parse(projectId)}/`;
  const paths = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await store.list({ prefix, cursor, limit: 1000 });
    for (const blob of page.blobs) {
      if (!blob.pathname.startsWith(prefix)) throw new Error("Unexpected project file path");
      paths.add(blob.pathname);
    }
    if (page.hasMore && (!page.cursor || page.cursor === cursor)) {
      throw new Error("Missing project file cursor");
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);

  // Finish listing before deleting so cleanup cannot shift pagination.
  const all = [...paths];
  for (let i = 0; i < all.length; i += 1000) {
    await store.delete(all.slice(i, i + 1000));
  }
}
