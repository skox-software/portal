import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  type AnyPgColumn,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

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
  /** Outside sales rep: sees only their own leads and earnings, never the delivery side. */
  "rep",
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
export const commentParent = pgEnum("comment_parent", ["feedback", "update", "request"]);
export const documentKind = pgEnum("document_kind", ["proposal", "sow", "contract", "nda", "change_order", "other"]);
export const documentStatus = pgEnum("document_status", ["out_for_signature", "completed", "void"]);
export const signerStatus = pgEnum("signer_status", ["pending", "viewed", "signed"]);
export const invoiceStatus = pgEnum("invoice_status", ["open", "paid", "void"]);
export const requestPriority = pgEnum("request_priority", ["low", "normal", "urgent"]);
export const requestStatus = pgEnum("request_status", ["new", "in_progress", "waiting_on_client", "done"]);
export const ideaStatus = pgEnum("idea_status", ["proposed", "interested", "not_now", "planned"]);
export const referralStatus = pgEnum("referral_status", ["new", "contacted", "won", "lost"]);
export const resourceKind = pgEnum("resource_kind", ["video", "guide", "link", "login_note"]);
export const taskTrigger = pgEnum("task_trigger", ["file_upload"]);
export const onboardingStatus = pgEnum("onboarding_status", ["invited", "in_progress", "completed"]);
/** Pre-sale stages only. Once a deal becomes a project, the project's status drives the board. */
export const dealStage = pgEnum("deal_stage", ["lead", "initial_outreach", "proposal_sent", "negotiation", "won", "lost"]);

export const workspaces = pgTable("workspaces", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  /** Where happy clients leave a public review (Google, Clutch…). */
  reviewUrl: text("review_url"),
  /** What a referrer gets, shown on the referral card. */
  referralReward: text("referral_reward"),
  /** Google appointment schedule, or an existing external kickoff booking link. */
  schedulingUrl: text("scheduling_url"),
  projectReviewSchedulingUrl: text("project_review_scheduling_url"),
  checkInSchedulingUrl: text("check_in_scheduling_url"),
  /** Loom/YouTube welcome from the founders, shown at the start of onboarding. */
  welcomeVideoUrl: text("welcome_video_url"),
  /** One line introducing the team, e.g. "Josh & Sam, co-founders". */
  teamIntro: text("team_intro"),
  /** Revenue target (cash collected) for `revenueGoalYear`, shown as the dial on Finance. */
  revenueGoalCents: integer("revenue_goal_cents"),
  revenueGoalYear: integer("revenue_goal_year"),
  createdAt: createdAt(),
});

export const clients = pgTable(
  "clients",
  {
    id: id(),
    workspaceId: workspaceId(),
    name: text("name").notNull(),
    /** The next time someone should reach out, what for, and who gets reminded. Like a deal's follow-up. */
    nextStepOn: date("next_step_on", { mode: "string" }),
    nextStep: text("next_step"),
    nextStepOwner: text("next_step_owner"),
    createdAt: createdAt(),
  },
  (t) => [index("clients_workspace_idx").on(t.workspaceId), index("clients_next_step_idx").on(t.workspaceId, t.nextStepOn)],
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
    /** Drives "since your last visit" and the client health score. */
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    emailUpdates: boolean("email_updates").notNull().default(true),
    /** Personal refer-a-friend code, created on first use. */
    referralCode: text("referral_code").unique(),
  },
  (t) => [
    unique("memberships_workspace_client_email_key")
      .on(t.workspaceId, t.clientId, t.email)
      .nullsNotDistinct(),
    index("memberships_email_idx").on(t.email),
    index("memberships_user_idx").on(t.userId),
    index("memberships_client_idx").on(t.clientId),
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
    liveUrl: text("live_url"),
    launchedOn: date("launched_on", { mode: "string" }),
    /** A target set at onboarding, confirmed at kickoff. */
    dateTentative: boolean("date_tentative").notNull().default(false),
    /** The rep who sourced this client. Every paid invoice on the project earns them commission. */
    repMembershipId: uuid("rep_membership_id").references((): AnyPgColumn => memberships.id, { onDelete: "set null" }),
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
    /** A screenshot clients can drop pins on (private blob key). */
    imageKey: text("image_key"),
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
    /** Ticks itself off when this happens (e.g. the client uploads a file). */
    completesOn: taskTrigger("completes_on"),
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
    uploadedByEmail: text("uploaded_by_email"),
    fromClient: boolean("from_client").notNull().default(false),
    /** logo | brand | content | other, so the brand kit can find its files. */
    category: text("category"),
    createdAt: createdAt(),
  },
  (t) => [index("files_project_idx").on(t.projectId)],
);

/** A PDF sent for signature. The hash pins exactly what people signed. */
export const documents = pgTable(
  "documents",
  {
    id: id(),
    workspaceId: workspaceId(),
    projectId: projectId(),
    title: text("title").notNull(),
    kind: documentKind("kind").notNull(),
    message: text("message"),
    storageKey: text("storage_key").notNull(),
    fileName: text("file_name").notNull(),
    sha256: text("sha256").notNull(),
    status: documentStatus("status").notNull().default("out_for_signature"),
    signedStorageKey: text("signed_storage_key"),
    signedSha256: text("signed_sha256"),
    createdBy: text("created_by").notNull(),
    createdAt: createdAt(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
  },
  (t) => [index("documents_project_idx").on(t.projectId, t.status)],
);

export const documentSigners = pgTable(
  "document_signers",
  {
    id: id(),
    workspaceId: workspaceId(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    label: text("label"),
    status: signerStatus("status").notNull().default("pending"),
    userId: text("user_id"),
    typedName: text("typed_name"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    signedSha256: text("signed_sha256"),
    viewedAt: timestamp("viewed_at", { withTimezone: true }),
    signedAt: timestamp("signed_at", { withTimezone: true }),
    lastRemindedAt: timestamp("last_reminded_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    unique("document_signers_document_email_key").on(t.documentId, t.email),
    index("document_signers_email_idx").on(t.email, t.status),
  ],
);

export const invoices = pgTable(
  "invoices",
  {
    id: id(),
    workspaceId: workspaceId(),
    projectId: projectId(),
    number: text("number").notNull(),
    title: text("title").notNull(),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("usd"),
    dueOn: date("due_on", { mode: "string" }).notNull(),
    status: invoiceStatus("status").notNull().default("open"),
    /** Stripe payment link, or any pay page. */
    payUrl: text("pay_url"),
    /** A deposit that unlocks once this agreement is signed ("Get started" flow). */
    documentId: uuid("document_id").references(() => documents.id, { onDelete: "set null" }),
    notes: text("notes"),
    createdBy: text("created_by").notNull(),
    createdAt: createdAt(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    lastRemindedAt: timestamp("last_reminded_at", { withTimezone: true }),
    /** Set by the Stripe webhook; the payment intent matches later refunds. */
    stripeSessionId: text("stripe_session_id"),
    stripePaymentIntentId: text("stripe_payment_intent_id"),
  },
  (t) => [
    index("invoices_project_idx").on(t.projectId, t.status),
    index("invoices_document_idx").on(t.documentId),
    index("invoices_workspace_idx").on(t.workspaceId, t.status),
    index("invoices_payment_intent_idx").on(t.stripePaymentIntentId),
  ],
);

/** "Request a change" after (or during) the build. */
export const supportRequests = pgTable(
  "support_requests",
  {
    id: id(),
    workspaceId: workspaceId(),
    projectId: projectId(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    priority: requestPriority("priority").notNull().default("normal"),
    status: requestStatus("status").notNull().default("new"),
    createdBy: text("created_by").notNull(),
    createdByEmail: text("created_by_email").notNull(),
    createdAt: createdAt(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [index("support_requests_project_idx").on(t.projectId, t.status)],
);

/** The monthly "what your product did for you" report. */
export const reports = pgTable(
  "reports",
  {
    id: id(),
    workspaceId: workspaceId(),
    projectId: projectId(),
    month: date("month", { mode: "string" }).notNull(),
    visitors: integer("visitors"),
    leads: integer("leads"),
    uptimePct: real("uptime_pct"),
    speedScore: integer("speed_score"),
    hoursUsed: real("hours_used"),
    highlights: text("highlights").notNull().default(""),
    createdBy: text("created_by").notNull(),
    createdAt: createdAt(),
  },
  (t) => [unique("reports_project_month_key").on(t.projectId, t.month)],
);

export const carePlans = pgTable("care_plans", {
  id: id(),
  workspaceId: workspaceId(),
  projectId: uuid("project_id")
    .notNull()
    .unique()
    .references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  hoursIncluded: real("hours_included").notNull().default(0),
  priceNote: text("price_note"),
  includes: text("includes").notNull().default(""),
  startedOn: date("started_on", { mode: "string" }),
  createdAt: createdAt(),
});

/** "What we could build next": ideas SKOX pitches, clients react to. */
export const ideas = pgTable(
  "ideas",
  {
    id: id(),
    workspaceId: workspaceId(),
    projectId: projectId(),
    title: text("title").notNull(),
    pitch: text("pitch").notNull(),
    estimate: text("estimate"),
    status: ideaStatus("status").notNull().default("proposed"),
    respondedByEmail: text("responded_by_email"),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    createdBy: text("created_by").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("ideas_project_idx").on(t.projectId)],
);

/** Launch kit: walkthrough videos, guides, useful links. */
export const resources = pgTable(
  "resources",
  {
    id: id(),
    workspaceId: workspaceId(),
    projectId: projectId(),
    kind: resourceKind("kind").notNull(),
    title: text("title").notNull(),
    url: text("url"),
    note: text("note"),
    createdBy: text("created_by").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("resources_project_idx").on(t.projectId)],
);

export const referrals = pgTable(
  "referrals",
  {
    id: id(),
    workspaceId: workspaceId(),
    referrerMembershipId: uuid("referrer_membership_id").references(() => memberships.id, {
      onDelete: "set null",
    }),
    referrerEmail: text("referrer_email"),
    name: text("name").notNull(),
    email: text("email").notNull(),
    company: text("company"),
    idea: text("idea"),
    status: referralStatus("status").notNull().default("new"),
    createdAt: createdAt(),
  },
  (t) => [index("referrals_workspace_idx").on(t.workspaceId, t.createdAt)],
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

/**
 * The welcome flow a new client walks after saying yes. One per project.
 * Answers are JSON validated by zod at the edges (lib/onboarding-content.ts),
 * so question sets can evolve without migrations.
 */
export const onboardings = pgTable(
  "onboardings",
  {
    id: id(),
    workspaceId: workspaceId(),
    projectId: uuid("project_id")
      .notNull()
      .unique()
      .references(() => projects.id, { onDelete: "cascade" }),
    invitedEmail: text("invited_email").notNull(),
    invitedBy: text("invited_by").notNull(),
    status: onboardingStatus("status").notNull().default("invited"),
    /** "What we heard on our call", written by SKOX, confirmed by the client. */
    callRecap: text("call_recap"),
    recapConfirmed: boolean("recap_confirmed"),
    recapFeedback: text("recap_feedback"),
    internalNotes: text("internal_notes"),
    /** step key -> "done" | "skipped" */
    steps: jsonb("steps").$type<Record<string, "done" | "skipped">>().notNull().default({}),
    contact: jsonb("contact").$type<Record<string, string>>().notNull().default({}),
    answers: jsonb("answers").$type<Record<string, string | string[]>>().notNull().default({}),
    brand: jsonb("brand").$type<Record<string, string | string[] | boolean>>().notNull().default({}),
    access: jsonb("access").$type<Record<string, { status: string; note?: string }>>().notNull().default({}),
    team: jsonb("team").$type<Record<string, string>>().notNull().default({}),
    kickoff: jsonb("kickoff").$type<Record<string, string>>().notNull().default({}),
    /** Null while SKOX is still attaching the agreement and deposit. */
    welcomeSentAt: timestamp("welcome_sent_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }),
    lastRemindedAt: timestamp("last_reminded_at", { withTimezone: true }),
    remindersSent: integer("reminders_sent").notNull().default(0),
    staffAlertedAt: timestamp("staff_alerted_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("onboardings_workspace_idx").on(t.workspaceId, t.status)],
);

/**
 * A sale before it becomes a project: the pipeline's Lead → Won columns.
 * Won deals are onboarded into a client + project, and from then on the
 * project (status, invoices, milestones) is the source of truth; the deal
 * keeps only what the project doesn't know: owner, contact, agreed value.
 */
export const deals = pgTable(
  "deals",
  {
    id: id(),
    workspaceId: workspaceId(),
    company: text("company").notNull(),
    contactName: text("contact_name"),
    contactEmail: text("contact_email"),
    phone: text("phone"),
    website: text("website"),
    /** One of PROJECT_KINDS, or "retainer". */
    kind: text("kind").notNull().default("web-app"),
    valueCents: integer("value_cents"),
    stage: dealStage("stage").notNull().default("lead"),
    /** Staff email; shown as initials on the card. */
    ownerEmail: text("owner_email"),
    /** manual | referral | import | website | rep */
    source: text("source").notNull().default("manual"),
    referralId: uuid("referral_id")
      .unique()
      .references(() => referrals.id, { onDelete: "set null" }),
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "set null" }),
    projectId: uuid("project_id")
      .unique()
      .references(() => projects.id, { onDelete: "set null" }),
    /** The seller's own notes. The researched call brief lives in `brief`. */
    notes: text("notes"),
    /** Cold leads: the call brief (lib/call-brief.ts): who to ask for, the opener, why we're calling, warnings. */
    brief: jsonb("brief"),
    /** Set when a call found the number dead or wrong; cleared when the phone is changed. */
    badNumber: boolean("bad_number").notNull().default(false),
    /** The contact opted out of email (unsubscribe link or a "no thanks" reply). Never cleared by sending code. */
    doNotEmail: boolean("do_not_email").notNull().default(false),
    /** e.g. "Dental clinics", shown under the company on the Clients list. */
    industry: text("industry"),
    /** e.g. "Tampa, FL". */
    location: text("location"),
    /** Where the lead came from, in words: "Scoping form", "LinkedIn", "Referral · Harbor". */
    leadSource: text("lead_source"),
    /** Google's click id from a website lead, for uploading the deal back to Google Ads when it's won. */
    gclid: text("gclid"),
    /** Website leads: campaign tags, pages viewed, device and the Clarity recording tag (lib/inbound-lead.ts). */
    attribution: jsonb("attribution"),
    /** First time it reached Won. Fixed, unlike stageChangedAt, so a Google Ads re-upload is recognised as the same conversion. */
    wonAt: timestamp("won_at", { withTimezone: true }),
    lostReason: text("lost_reason"),
    /** The follow-up: what to do next and the day it's due. Drives the Today queue. */
    nextStep: text("next_step"),
    nextStepOn: date("next_step_on"),
    /** Last call, voicemail or email logged against the deal. */
    lastContactedAt: timestamp("last_contacted_at", { withTimezone: true }),
    /** The sales rep working this lead (a `rep` membership). Separate from the SKOX owner who closes it. */
    repMembershipId: uuid("rep_membership_id").references(() => memberships.id, { onDelete: "set null" }),
    /** assigned (SKOX gave it to the rep) | self (the rep brought it) */
    repSource: text("rep_source"),
    /** The rep's own notes. Internal `notes` are never shown to reps. */
    repNotes: text("rep_notes"),
    /** When the rep booked the scope call with SKOX. */
    meetingAt: timestamp("meeting_at", { withTimezone: true }),
    stageChangedAt: timestamp("stage_changed_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("deals_workspace_idx").on(t.workspaceId, t.stage),
    index("deals_next_step_idx").on(t.workspaceId, t.nextStepOn),
    index("deals_rep_idx").on(t.repMembershipId),
  ],
);

export const emailDirection = pgEnum("email_direction", ["inbound", "outbound"]);

/**
 * A conversation with someone outside SKOX. Threads belong to a client or a
 * deal once someone (or a matching address) assigns them; until then they
 * wait in the Inbox under "Needs a client".
 */
export const emailThreads = pgTable(
  "email_threads",
  {
    id: id(),
    workspaceId: workspaceId(),
    subject: text("subject").notNull(),
    /** The outside person this thread is with. */
    counterpartEmail: text("counterpart_email").notNull(),
    counterpartName: text("counterpart_name"),
    /** The SKOX address the conversation is on, e.g. reiss@skoxsoftware.com. */
    mailbox: text("mailbox"),
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "set null" }),
    dealId: uuid("deal_id").references(() => deals.id, { onDelete: "set null" }),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
    lastInboundAt: timestamp("last_inbound_at", { withTimezone: true }),
    /** Set when a staff member opens the thread after its latest inbound message. */
    readAt: timestamp("read_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("email_threads_workspace_idx").on(t.workspaceId, t.lastMessageAt),
    index("email_threads_counterpart_idx").on(t.workspaceId, t.counterpartEmail),
    index("email_threads_client_idx").on(t.clientId),
    index("email_threads_deal_idx").on(t.dealId),
  ],
);

export const emailMessages = pgTable(
  "email_messages",
  {
    id: id(),
    workspaceId: workspaceId(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => emailThreads.id, { onDelete: "cascade" }),
    direction: emailDirection("direction").notNull(),
    fromEmail: text("from_email").notNull(),
    fromName: text("from_name"),
    to: jsonb("to").$type<string[]>().notNull().default([]),
    cc: jsonb("cc").$type<string[]>().notNull().default([]),
    subject: text("subject").notNull(),
    text: text("text").notNull().default(""),
    /** The RFC 5322 Message-ID, used to thread replies. */
    messageId: text("message_id"),
    inReplyTo: text("in_reply_to"),
    references: text("references"),
    /** Resend's id for a received email, so a retried webhook never duplicates it. */
    providerId: text("provider_id").unique(),
    attachments: jsonb("attachments")
      .$type<{ name: string; size: number; contentType: string; storageKey: string | null }[]>()
      .notNull()
      .default([]),
    sentBy: text("sent_by"),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    index("email_messages_thread_idx").on(t.threadId, t.sentAt),
    index("email_messages_message_id_idx").on(t.workspaceId, t.messageId),
  ],
);

/** Throttle for anything that sends email on behalf of an anonymous visitor. */
export const rateEvents = pgTable(
  "rate_events",
  {
    id: id(),
    /** e.g. "otp:email:jane@x.com", "otp:ip:1.2.3.4", "referral:code:abc" */
    key: text("key").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("rate_events_key_idx").on(t.key, t.createdAt)],
);

/* ---------------------------------------------------------------------------
 * Sales reps and commissions.
 *
 * Reps are 1099 contractors paid a percentage of cash SKOX collects from the
 * clients they bring. The ledger is append-only: a payment adds an `earned`
 * entry, a refund adds a negative `clawback`, corrections are `adjustment`s.
 * Each month's pending entries roll into a statement that the workspace owner
 * approves and marks paid.
 * ------------------------------------------------------------------------- */

export const commissionKind = pgEnum("commission_kind", ["earned", "clawback", "adjustment"]);
export const commissionStatus = pgEnum("commission_status", ["pending", "approved", "paid", "void"]);
export const statementStatus = pgEnum("statement_status", ["draft", "approved", "paid", "void"]);

/** One per `rep` membership: their rate and paperwork. */
export const repProfiles = pgTable("rep_profiles", {
  id: id(),
  workspaceId: workspaceId(),
  membershipId: uuid("membership_id")
    .notNull()
    .unique()
    .references(() => memberships.id, { onDelete: "cascade" }),
  displayName: text("display_name").notNull(),
  /** Commission rate in basis points: 1500 = 15%. */
  rateBps: integer("rate_bps").notNull(),
  /** active | paused. Paused reps keep their history but earn nothing new. */
  status: text("status").notNull().default("active"),
  phone: text("phone"),
  /** How SKOX pays them, in words ("Zelle to phone"). Never bank numbers. */
  payoutNotes: text("payout_notes"),
  w9ReceivedAt: timestamp("w9_received_at", { withTimezone: true }),
  agreementSignedAt: timestamp("agreement_signed_at", { withTimezone: true }),
  startedOn: date("started_on", { mode: "string" }),
  createdAt: createdAt(),
});

/** Money returned to a client. Each refund claws back the rep's share once. */
export const invoiceRefunds = pgTable(
  "invoice_refunds",
  {
    id: id(),
    workspaceId: workspaceId(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    amountCents: integer("amount_cents").notNull(),
    reason: text("reason"),
    stripeRefundId: text("stripe_refund_id").unique(),
    createdBy: text("created_by").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("invoice_refunds_invoice_idx").on(t.invoiceId)],
);

export const commissionStatements = pgTable(
  "commission_statements",
  {
    id: id(),
    workspaceId: workspaceId(),
    repMembershipId: uuid("rep_membership_id")
      .notNull()
      .references(() => memberships.id, { onDelete: "restrict" }),
    periodStart: date("period_start", { mode: "string" }).notNull(),
    periodEnd: date("period_end", { mode: "string" }).notNull(),
    totalCents: integer("total_cents").notNull(),
    status: statementStatus("status").notNull().default("draft"),
    approvedBy: text("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    paidBy: text("paid_by"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    /** Transfer memo or confirmation number. */
    paymentReference: text("payment_reference"),
    notes: text("notes"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("commission_statements_rep_period_key").on(t.repMembershipId, t.periodStart),
    index("commission_statements_workspace_idx").on(t.workspaceId, t.status),
  ],
);

export const commissionEntries = pgTable(
  "commission_entries",
  {
    id: id(),
    workspaceId: workspaceId(),
    repMembershipId: uuid("rep_membership_id")
      .notNull()
      .references(() => memberships.id, { onDelete: "restrict" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    invoiceId: uuid("invoice_id").references(() => invoices.id, { onDelete: "set null" }),
    reversalOf: uuid("reversal_of").unique(),
    refundId: uuid("refund_id")
      .references(() => invoiceRefunds.id, { onDelete: "set null" }),
    kind: commissionKind("kind").notNull(),
    /** What the rate applied to: the invoice paid, or the refund. Zero for adjustments. */
    baseCents: integer("base_cents").notNull(),
    rateBps: integer("rate_bps").notNull(),
    /** Signed: clawbacks are negative. */
    amountCents: integer("amount_cents").notNull(),
    status: commissionStatus("status").notNull().default("pending"),
    /** When the money moved (invoice paid, refund issued). Decides the statement month. */
    earnedAt: timestamp("earned_at", { withTimezone: true }).notNull(),
    statementId: uuid("statement_id").references(() => commissionStatements.id, { onDelete: "set null" }),
    /** Client company at the time, so the rep's ledger never needs to read the project. */
    clientName: text("client_name"),
    note: text("note"),
    createdBy: text("created_by").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    // One earning per payment: a webhook retry carries the same paid-at time and is ignored.
    uniqueIndex("commission_entries_earned_payment_key")
      .on(t.invoiceId, t.earnedAt, t.repMembershipId)
      .where(sql`kind = 'earned'`),
    unique("commission_entries_refund_rep_key").on(t.refundId, t.repMembershipId),
    index("commission_entries_rep_idx").on(t.repMembershipId, t.earnedAt),
    index("commission_entries_statement_idx").on(t.statementId),
  ],
);

export type RepProfile = typeof repProfiles.$inferSelect;
export type CommissionEntry = typeof commissionEntries.$inferSelect;
export type CommissionStatement = typeof commissionStatements.$inferSelect;
export type Onboarding = typeof onboardings.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Client = typeof clients.$inferSelect;
export type Deal = typeof deals.$inferSelect;
export type EmailThread = typeof emailThreads.$inferSelect;
export type EmailMessage = typeof emailMessages.$inferSelect;

/** Recorded business spending charged against a person's withdrawals, never gross ownership. */
export const withdrawalExpenses = pgTable("withdrawal_expenses", {
  id: id(),
  workspaceId: workspaceId(),
  membershipId: uuid("membership_id").notNull().references(() => memberships.id, { onDelete: "restrict" }),
  reference: text("reference").notNull(),
  description: text("description").notNull(),
  amountCents: integer("amount_cents").notNull(),
  createdAt: createdAt(),
}, t => [unique("withdrawal_expenses_workspace_reference").on(t.workspaceId, t.reference)]);
