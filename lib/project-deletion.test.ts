import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { after, before, beforeEach, describe, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { count, eq } from "drizzle-orm";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import * as schema from "./db/schema.ts";
import { deleteProjectInput, projectDeletionQuery, removeProjectBlobs } from "./project-deletion.ts";

const workspaceId = crypto.randomUUID();
const otherWorkspaceId = crypto.randomUUID();
const clientId = crypto.randomUUID();
const otherClientId = crypto.randomUUID();
const projectId = crypto.randomUUID();
const siblingId = crypto.randomUUID();
const outsideId = crypto.randomUUID();
const projectName = "Booking portal";
const actorId = "staff-user";
const input = { projectId, confirmation: projectName, workspaceId, actorId };

describe("project deletion against the portal's Postgres migrations", () => {
  let pg: PGlite;
  let db: PgliteDatabase<typeof schema>;

  before(async () => {
    pg = new PGlite();
    db = drizzle(pg, { schema });
    const directory = new URL("../drizzle/", import.meta.url);
    for (const file of (await readdir(directory)).filter((f) => f.endsWith(".sql")).sort()) {
      await pg.exec(await readFile(new URL(file, directory), "utf8"));
    }
  });
  after(async () => { await pg?.close(); });

  beforeEach(async () => {
    await pg.exec("TRUNCATE workspaces CASCADE");
    await db.insert(schema.workspaces).values([
      { id: workspaceId, name: "SKOX test", slug: "skox-test" },
      { id: otherWorkspaceId, name: "Other test", slug: "other-test" },
    ]);
    await db.insert(schema.clients).values([
      { id: clientId, workspaceId, name: "Example client" },
      { id: otherClientId, workspaceId: otherWorkspaceId, name: "Other client" },
    ]);
    await db.insert(schema.memberships).values([
      { workspaceId, userId: actorId, email: "staff@example.test", role: "staff" },
      { workspaceId, clientId, userId: "client-user", email: "client@example.test", role: "client_approver" },
      { workspaceId: otherWorkspaceId, userId: "other-staff", email: "other@example.test", role: "staff_owner" },
      { workspaceId, clientId, userId: "client-attached-staff", email: "invalid@example.test", role: "staff" },
    ]);
    await db.insert(schema.projects).values([
      { id: projectId, workspaceId, clientId, name: projectName, kind: "web-app", deliveryDate: "2026-10-27" },
      { id: siblingId, workspaceId, clientId, name: "Keep this project", kind: "website", deliveryDate: "2026-10-27" },
      { id: outsideId, workspaceId: otherWorkspaceId, clientId: otherClientId, name: projectName, kind: "website", deliveryDate: "2026-10-27" },
    ]);
  });

  async function seedProjectData(id: string) {
    const base = { workspaceId, projectId: id };
    const authored = { ...base, createdBy: actorId };
    const [preview] = await db.insert(schema.previews).values({ ...authored, url: "https://example.test", imageKey: `projects/${id}/screenshot/preview.png` }).returning();
    const [update] = await db.insert(schema.updates).values({ ...base, authorId: actorId, previewId: preview.id }).returning();
    const [feedback] = await db.insert(schema.feedback).values({ ...base, previewId: preview.id, pageUrl: "/", tag: "change", body: "Test", authorId: actorId }).returning();
    const [request] = await db.insert(schema.supportRequests).values({ ...authored, title: "Request", body: "Test", createdByEmail: "client@example.test" }).returning();
    await db.insert(schema.comments).values([
      { workspaceId, parentType: "update", parentId: update.id, authorId: actorId, body: "Update comment" },
      { workspaceId, parentType: "feedback", parentId: feedback.id, authorId: actorId, body: "Feedback comment" },
      { workspaceId, parentType: "request", parentId: request.id, authorId: actorId, body: "Request comment" },
    ]);
    const [document] = await db.insert(schema.documents).values({ ...authored, title: "Agreement", kind: "contract", storageKey: `projects/${id}/document/original.pdf`, signedStorageKey: `projects/${id}/document/signed.pdf`, fileName: "agreement.pdf", sha256: "test" }).returning();
    await db.insert(schema.documentSigners).values({ workspaceId, documentId: document.id, email: "client@example.test" });
    await db.insert(schema.invoices).values({ ...authored, number: "TEST-1", title: "Deposit", amountCents: 1000, dueOn: "2026-10-27", documentId: document.id });
    await db.insert(schema.files).values({ ...base, uploadedBy: actorId, storageKey: `projects/${id}/file/logo.png`, name: "logo.png" });
    await db.insert(schema.tasks).values({ ...authored, side: "client", title: "Send content" });
    await db.insert(schema.milestones).values({ ...base, title: "Kickoff", kind: "kickoff" });
    await db.insert(schema.approvals).values({ ...base, kind: "launch", previewId: preview.id, requestedBy: actorId });
    await db.insert(schema.dateChanges).values({ ...base, fromDate: "2026-10-20", toDate: "2026-10-27", reason: "Test", changedBy: actorId });
    await db.insert(schema.carePlans).values({ ...base, name: "Care plan" });
    await db.insert(schema.reports).values({ ...authored, month: "2026-10-01" });
    await db.insert(schema.ideas).values({ ...authored, title: "Idea", pitch: "Test" });
    await db.insert(schema.resources).values({ ...authored, title: "Guide", kind: "guide" });
    await db.insert(schema.shareLinks).values({ ...authored, tokenHash: `share-${id}`, expiresAt: new Date("2026-12-01") });
    await db.insert(schema.onboardings).values({ ...base, invitedEmail: "client@example.test", invitedBy: actorId });
    await db.insert(schema.events).values({ ...base, actorId, verb: "project.created", subjectType: "project", subjectId: id });
  }

  test("deletes all project data and comments, keeps the client, siblings and audit history", async () => {
    await seedProjectData(projectId);
    await seedProjectData(siblingId);
    const result = await db.execute(projectDeletionQuery(input));
    assert.deepEqual(result.rows, [{ id: projectId, name: projectName, clientId }]);
    const remaining = await db.select().from(schema.projects);
    assert.deepEqual(remaining.map((p) => p.id).sort(), [siblingId, outsideId].sort());
    assert.equal((await db.select().from(schema.clients)).length, 2);
    assert.equal((await db.select().from(schema.memberships)).length, 4);

    for (const table of [schema.previews, schema.updates, schema.feedback, schema.supportRequests, schema.documents, schema.invoices, schema.files, schema.tasks, schema.milestones, schema.approvals, schema.dateChanges, schema.carePlans, schema.reports, schema.ideas, schema.resources, schema.shareLinks, schema.onboardings]) {
      const [gone] = await db.select({ n: count() }).from(table).where(eq(table.projectId, projectId));
      const [kept] = await db.select({ n: count() }).from(table).where(eq(table.projectId, siblingId));
      assert.equal(gone.n, 0);
      assert.equal(kept.n, 1);
    }
    assert.equal((await db.select().from(schema.documentSigners)).length, 1);
    const comments = await db.select().from(schema.comments);
    assert.equal(comments.length, 3);
    const [remainingUpdate] = await db.select().from(schema.updates);
    assert.ok(comments.some((c) => c.parentType === "update" && c.parentId === remainingUpdate.id));
    const audit = await db.select().from(schema.events);
    assert.equal(audit.length, 3);
    const deletion = audit.find((e) => e.verb === "project.deleted")!;
    assert.equal(deletion.projectId, null);
    assert.equal(deletion.subjectId, projectId);
    assert.equal(deletion.actorId, actorId);
    assert.deepEqual(deletion.payload, { name: projectName, clientId });
    assert.equal(audit.find((e) => e.subjectId === projectId && e.verb === "project.created")?.projectId, null);

    assert.deepEqual((await db.execute(projectDeletionQuery(input))).rows, []);
    assert.equal((await db.select().from(schema.events)).length, 3, "repeated submissions must not write phantom deletion events");
  });

  for (const [label, overrides] of [
    ["client approver", { actorId: "client-user" }],
    ["another workspace's owner", { actorId: "other-staff" }],
    ["a staff role attached to a client", { actorId: "client-attached-staff" }],
    ["an unknown user", { actorId: "unknown" }],
    ["another workspace's project", { projectId: outsideId }],
    ["a tampered workspace", { workspaceId: otherWorkspaceId }],
    ["a missing project", { projectId: crypto.randomUUID() }],
    ["a mismatched confirmation", { confirmation: "Booking" }],
    ["SQL in the confirmation", { confirmation: "' OR true --" }],
  ] as const) {
    test(`rejects ${label} without deleting or auditing anything`, async () => {
      assert.deepEqual((await db.execute(projectDeletionQuery({ ...input, ...overrides }))).rows, []);
      assert.equal((await db.select().from(schema.projects)).length, 3);
      assert.equal((await db.select().from(schema.events)).length, 0);
    });
  }

  test("a workspace owner can delete a project", async () => {
    await db.update(schema.memberships).set({ role: "staff_owner" }).where(eq(schema.memberships.userId, actorId));
    assert.equal((await db.execute(projectDeletionQuery(input))).rows.length, 1);
  });

  test("a project renamed after opening the dialog requires fresh confirmation", async () => {
    await db.update(schema.projects).set({ name: "New name" }).where(eq(schema.projects.id, projectId));
    assert.deepEqual((await db.execute(projectDeletionQuery(input))).rows, []);
    assert.equal((await db.select().from(schema.projects)).length, 3);
  });

  test("an audit failure rolls back the project, cascades and comment removal", async (t) => {
    await seedProjectData(projectId);
    await pg.exec("ALTER TABLE events ADD CONSTRAINT test_reject_deletion CHECK (verb <> 'project.deleted')");
    t.after(async () => { await pg.exec("ALTER TABLE events DROP CONSTRAINT test_reject_deletion"); });
    await assert.rejects(db.execute(projectDeletionQuery(input)));
    assert.equal((await db.select().from(schema.projects)).length, 3);
    assert.equal((await db.select().from(schema.files)).length, 1);
    assert.equal((await db.select().from(schema.documents)).length, 1);
    assert.equal((await db.select().from(schema.documentSigners)).length, 1);
    assert.equal((await db.select().from(schema.comments)).length, 3);
    assert.equal((await db.select().from(schema.events))[0].projectId, projectId);
  });
});

test("deletion input requires a UUID and a nonempty confirmation", () => {
  assert.equal(deleteProjectInput.safeParse({ projectId: "../", confirmation: projectName }).success, false);
  assert.equal(deleteProjectInput.safeParse({ projectId, confirmation: "  " }).success, false);
  assert.equal(deleteProjectInput.safeParse({ projectId }).success, false);
  assert.equal(deleteProjectInput.parse({ projectId, confirmation: ` ${projectName} ` }).confirmation, projectName);
});

test("file cleanup lists every page before deleting, includes unlinked uploads and batches removals", async () => {
  const prefix = `projects/${projectId}/`;
  const firstPage = Array.from({ length: 1000 }, (_, i) => ({ pathname: `${prefix}file/${i}` }));
  const removed: string[][] = [];
  let lists = 0;
  await removeProjectBlobs(projectId, {
    list: async (options) => {
      assert.equal(options.prefix, prefix);
      assert.equal(removed.length, 0);
      lists++;
      if (lists === 1) return { blobs: firstPage, hasMore: true, cursor: "next" };
      assert.equal(options.cursor, "next");
      return { blobs: [{ pathname: `${prefix}document/signed.pdf` }, { pathname: `${prefix}screenshot/unlinked.png` }, firstPage[0]], hasMore: false };
    },
    delete: async (paths) => { removed.push(paths); },
  });
  assert.equal(lists, 2);
  assert.deepEqual(removed.map((batch) => batch.length), [1000, 2]);
  assert.equal(new Set(removed.flat()).size, 1002);
});

test("file cleanup refuses paths from another project", async () => {
  await assert.rejects(removeProjectBlobs(projectId, {
    list: async () => ({ blobs: [{ pathname: `projects/${siblingId}/file/logo.png` }], hasMore: false }),
    delete: async () => assert.fail("must not delete another project's files"),
  }), /Unexpected project file path/);
});

test("file cleanup rejects invalid project IDs before touching storage", async () => {
  await assert.rejects(removeProjectBlobs("../", {
    list: async () => { throw new Error("must not list files"); },
    delete: async () => assert.fail("must not delete files"),
  }), /Invalid UUID/);
});
