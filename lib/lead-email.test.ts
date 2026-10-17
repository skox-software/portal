import { test } from "node:test";
import assert from "node:assert/strict";
import { leadEmailPayload } from "./lead-email.ts";
import { buildEmailDraft } from "./email-draft.ts";

test("pipeline mail uses Reiss for From and Reply-To, preserving reviewed content", () => {
  assert.deepEqual(leadEmailPayload("lead@example.com", "Their preview", "Reviewed message"), {
    from: "Reiss Skeen <reiss@skoxsoftware.com>", replyTo: "reiss@skoxsoftware.com", to: "lead@example.com", subject: "Their preview", text: "Reviewed message",
  });
});
test("a saved personalized draft takes precedence over generated copy", () => {
  const saved = { id: "a", fromEmail: "reiss@skoxsoftware.com", subject: "Personalized preview", body: "The reviewed copy", status: "draft" as const, updatedAt: "2026-10-17" };
  assert.deepEqual(buildEmailDraft({ company: "Example", brief: { why: "Old site", emailDraft: saved } }), { subject: saved.subject, body: saved.body });
});
