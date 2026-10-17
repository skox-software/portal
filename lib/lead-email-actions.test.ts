import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Run the real action with isolated auth, database and provider adapters.
// No test can reach a live mailbox or database.
function harness({ email = "reiss@skoxsoftware.com", status = "draft", production = true, key = "test", claim = true, rejected = false } = {}) {
  const calls = { send: 0, updates: 0, batches: 0 };
  const draft = { id: "saved", fromEmail: email, subject: "Saved", body: "Original", status, updatedAt: "today" };
  const deal = { id: "4e9de8c6-50f1-47cf-a564-4cafbf382c22", contactEmail: "lead@example.com", brief: { emailDraft: draft }, stage: "lead" };
  const db = {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [deal] }) }) }),
    update: () => { calls.updates++; return { set: () => ({ where: () => ({ returning: async () => claim ? [{ id: deal.id }] : [] }) }) }; },
    insert: () => ({ values: () => ({}) }),
    batch: async () => { calls.batches++; },
  };
  let payload: unknown;
  const mocks: Record<string, unknown> = {
    "drizzle-orm": { and: (...a: unknown[]) => a, eq: (...a: unknown[]) => a, sql: (...a: unknown[]) => a },
    "next/cache": { revalidatePath() {} },
    resend: { Resend: class { emails = { send: async (p: unknown) => { calls.send++; payload=p; return rejected ? { error: { message: "Rejected" } } : { data: { id: "provider-id" } }; } }; } },
    zod: { z: { object: () => ({ safeParse: (data: unknown) => ({ success: true, data }) }), uuid: () => ({}), email: () => ({}), string: () => { const v = { trim: () => v, min: () => v, max: () => v }; return v; } } },
    "@/lib/access": { requireStaff: async () => ({ viewer: { email, userId: "user" }, staff: { workspaceId: "workspace" } }) },
    "@/lib/call-brief": { readBrief: (x: unknown) => x },
    "@/lib/db": { getDb: () => db },
    "@/lib/db/schema": { deals: {}, emailMessages: {}, emailThreads: {} },
    "@/lib/events": { eventInsert: () => ({}) },
    "@/lib/lead-email": { LEAD_SENDER_EMAIL: "reiss@skoxsoftware.com", leadEmailPayload: (to: string, subject: string, body: string) => ({ from: "Reiss Skeen <reiss@skoxsoftware.com>", replyTo: "reiss@skoxsoftware.com", to, subject, text: body }) },
  };
  const exports: { updateLeadEmail?: (x: unknown) => Promise<Record<string, unknown>> } = {};
  const source = ts.transpileModule(fs.readFileSync(new URL("../app/admin/pipeline/email-actions.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, { exports, require: (id: string) => { if (!(id in mocks)) throw Error(id); return mocks[id]; }, process: { env: { NODE_ENV: production ? "production" : "development", RESEND_API_KEY: key } }, crypto: { randomUUID: () => "new-id" }, Date });
  return { calls, payload: () => payload, run: (intent = "send", to = deal.contactEmail) => exports.updateLeadEmail!({ dealId: deal.id, to, subject: "Reviewed", body: "Reviewed body", intent }) };
}

test("saving never calls the email provider", async () => { const h=harness(); assert.equal((await h.run("save")).status,"draft"); assert.equal(h.calls.send,0); });
test("another staff account cannot send as Reiss", async () => { const h=harness({email:"other@skoxsoftware.com"}); assert.match(String((await h.run()).error),/Sign in as/); assert.equal(h.calls.send,0); assert.equal(h.calls.updates,0); });
test("changed recipient, sent draft and in-progress draft never send", async () => { for (const status of ["sent","sending"]) { const h=harness({status}); assert.ok((await h.run()).error); assert.equal(h.calls.send,0); } const h=harness(); assert.ok((await h.run("send","changed@example.com")).error); assert.equal(h.calls.send,0); });
test("no production configuration means no send and no false sent record", async () => { for (const opts of [{production:false},{key:""}]) { const h=harness(opts); assert.ok((await h.run()).error); assert.equal(h.calls.send,0); assert.equal(h.calls.batches,0); } });
test("a competing claim prevents duplicate send", async () => { const h=harness({claim:false}); assert.ok((await h.run()).error); assert.equal(h.calls.send,0); });
test("accepted email records the send, while provider rejection does not", async () => { const h=harness(); assert.equal((await h.run()).status,"sent"); assert.equal(h.calls.send,1); assert.equal(h.calls.batches,1); assert.equal((h.payload() as {from:string}).from,"Reiss Skeen <reiss@skoxsoftware.com>"); const fail=harness({rejected:true}); assert.ok((await fail.run()).error); assert.equal(fail.calls.batches,0); });
