import {
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * SKOX Client Portal — phase 1 data model.
 *
 * Every table carries `workspace_id`: SKOX is one workspace, and a future
 * customer of the portal as a product is simply another. Signed-in users live
 * in Neon Auth's own `neon_auth` schema; the portal refers to them by
 * `user_id` (text) and never copies them. What someone may do is decided by
 * `memberships.role`, not by the auth provider.
 */

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const workspaceId = () =>
  uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" });
const projectId = () =>
  uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" });

export const portalRole = pgEnum("portal_role", [
  "staff_owner",
  "staff",
  "client_approver",
  "client_member",
]);
export const projectStatus = pgEnum("project_status", [
  "kickoff",
  "building",
  "review",
  "launched",
  "paused",
]);
export const milestoneKind = pgEnum("milestone_kind", [
  "kickoff",
  "halfway",
  "launch",
  "custom",
]);
export const milestoneState = pgEnum("milestone_state", [
  "upcoming",
  "in_progress",
  "done",
]);
export const feedbackTag = pgEnum("feedback_tag", ["love", "change", "must_fix"]);
export const feedbackStatus = pgEnum("feedback_status", [
  "open",
  "in_progress",
  "done",
  "wont_do",
]);
export const approvalKind = pgEnum("approval_kind", ["halfway", "launch", "other"]);
export const approvalState = pgEnum("approval_state", [
  "requested",
  "approved",
  "changes_requested",
]);
export const taskSide = pgEnum("task_side", ["client", "skox"]);
export const commentParent = pgEnum("comment_parent", ["feedback", "update"]);

export const workspaces = pgTable("workspaces", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt: createdAt(),
});

export const clients = pgTable(
  "clients",
  {
    id: id(),
    workspaceId: workspaceId(),
    name: text("name").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("clients_workspace_idx").on(t.workspaceId)],
);

/**
 * Who can see what. Staff rows have no client; client rows name one client.
 * Invitations are rows with an email and no user yet; they are claimed when
 * someone signs in with that (verified) address.
 */
export const memberships = pgTable(
  "memberships",
  {
    id: id(),
    workspaceId: workspaceId(),
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    userId: text("user_id"),
    role: portalRole("role").notNull(),
    invitedBy: text("invited_by"),
    createdAt: createdAt(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  },
  (t) => [
    unique("memberships_workspace_client_email_key")
      .on(t.workspaceId, t.clientId, t.email)
      .nullsNotDistinct(),
    index("memberships_email_idx").on(t.email),
    index("memberships_user_idx").on(t.userId),
  ],
);

export const projects = pgTable(
  "projects",
  {
    id: id(),
    workspaceId: workspaceId(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    status: projectStatus("status").notNull().default("kickoff"),
    startedOn: date("started_on", { mode: "string" }),
    deliveryDate: date("delivery_date", { mode: "string" }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("projects_workspace_idx").on(t.workspaceId),
    index("projects_client_idx").on(t.clientId),
  ],
);

/** Every move of the delivery date, and the reason it moved. */
export const dateChanges = pgTable(
  "date_changes",
  {
    id: id(),
    workspaceId: workspaceId(),
    projectId: projectId(),
    fromDate: date("from_date", { mode: "string" }).notNull(),
    toDate: date("to_date", { mode: "string" }).notNull(),
    reason: text("reason").notNull(),
    changedBy: text("changed_by").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("date_changes_project_idx").on(t.projectId)],
);

export const milestones = pgTable(
  "milestones",
  {
    id: id(),
    workspaceId: workspaceId(),
    projectId: projectId(),
    kind: milestoneKind("kind").notNull(),
    title: text("title").notNull(),
    dueOn: date("due_on", { mode: "string" }),
    state: milestoneState("state").notNull().default("upcoming"),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("milestones_project_idx").on(t.projectId)],
);

export const previews = pgTable(
  "previews",
  {
    id: id(),
    workspaceId: workspaceId(),
    projectId: projectId(),
    url: text("url").notNull(),
    label: text("label"),
    notes: text("notes"),
    createdBy: text("created_by").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("previews_project_idx").on(t.projectId)],
);

/** The weekly "shipped / next / needed from you" post. */
export const updates = pgTable(
  "updates",
  {
    id: id(),
    workspaceId: workspaceId(),
    projectId: projectId(),
    shipped: text("shipped").notNull().default(""),
    next: text("next").notNull().default(""),
    needed: text("needed").notNull().default(""),
    videoUrl: text("video_url"),
    previewId: uuid("preview_id").references(() => previews.id, { onDelete: "set null" }),
    authorId: text("author_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("updates_project_idx").on(t.projectId, t.createdAt)],
);

/** A comment pinned to a spot on a preview. */
export const feedback = pgTable(
  "feedback",
  {
    id: id(),
    workspaceId: workspaceId(),
    projectId: projectId(),
    previewId: uuid("preview_id")
      .notNull()
      .references(() => previews.id, { onDelete: "cascade" }),
    pageUrl: text("page_url").notNull(),
    x: real("x"),
    y: real("y"),
    selector: text("selector"),
    screenshotKey: text("screenshot_key"),
    tag: feedbackTag("tag").notNull(),
    status: feedbackStatus("status").notNull().default("open"),
    body: text("body").notNull(),
    authorId: text("author_id").notNull(),
    createdAt: createdAt(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [index("feedback_project_idx").on(t.projectId, t.status)],
);

export const comments = pgTable(
  "comments",
  {
    id: id(),
    workspaceId: workspaceId(),
    parentType: commentParent("parent_type").notNull(),
    parentId: uuid("parent_id").notNull(),
    body: text("body").notNull(),
    authorId: text("author_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("comments_parent_idx").on(t.parentType, t.parentId)],
);

/** A decision recorded against a specific preview. */
export const approvals = pgTable(
  "approvals",
  {
    id: id(),
    workspaceId: workspaceId(),
    projectId: projectId(),
    kind: approvalKind("kind").notNull(),
    previewId: uuid("preview_id").references(() => previews.id, { onDelete: "set null" }),
    state: approvalState("state").notNull().default("requested"),
    note: text("note"),
    requestedBy: text("requested_by").notNull(),
    decidedBy: text("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("approvals_project_idx").on(t.projectId, t.state)],
);

/** "Waiting on you" (client side) and our own to-dos (skox side). */
export const tasks = pgTable(
  "tasks",
  {
    id: id(),
    workspaceId: workspaceId(),
    projectId: projectId(),
    side: taskSide("side").notNull(),
    title: text("title").notNull(),
    dueOn: date("due_on", { mode: "string" }),
    doneAt: timestamp("done_at", { withTimezone: true }),
    doneBy: text("done_by"),
    createdBy: text("created_by").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("tasks_project_idx").on(t.projectId, t.side)],
);

export const files = pgTable(
  "files",
  {
    id: id(),
    workspaceId: workspaceId(),
    projectId: projectId(),
    storageKey: text("storage_key").notNull(),
    name: text("name").notNull(),
    sizeBytes: integer("size_bytes"),
    contentType: text("content_type"),
    uploadedBy: text("uploaded_by").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("files_project_idx").on(t.projectId)],
);

/** Read-only access without a login. Only a hash of the token is stored. */
export const shareLinks = pgTable(
  "share_links",
  {
    id: id(),
    workspaceId: workspaceId(),
    projectId: projectId(),
    tokenHash: text("token_hash").notNull().unique(),
    createdBy: text("created_by").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("share_links_project_idx").on(t.projectId)],
);

/** The audit trail. Every meaningful change writes one row. */
export const events = pgTable(
  "events",
  {
    id: id(),
    workspaceId: workspaceId(),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    actorId: text("actor_id"),
    verb: text("verb").notNull(),
    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id"),
    payload: jsonb("payload").notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    index("events_workspace_idx").on(t.workspaceId, t.createdAt),
    index("events_project_idx").on(t.projectId, t.createdAt),
  ],
);

export type Membership = typeof memberships.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Client = typeof clients.$inferSelect;
