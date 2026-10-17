import { test } from "node:test";
import assert from "node:assert/strict";
import { leadEmailPayload } from "./lead-email.ts";
import { buildEmailDraft } from "./email-draft.ts";

test("pipeline mail uses Reiss for From and Reply-To, preserving reviewed content", () => {
  assert.deepEqual(leadEmailPayload("lead@example.com", "Their preview", "Reviewed message"), {
    from: "Reiss Skeen <reiss@skoxsoftware.com>", replyTo: "reiss@skoxsoftware.com", to: "lead@example.com", subject: "Their preview", text: "Reviewed message", html: '<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#202124">Reviewed message</div>',
  });
});
test("a saved personalized draft takes precedence over generated copy", () => {
  const saved = { id: "a", fromEmail: "reiss@skoxsoftware.com", subject: "Personalized preview", body: "The reviewed copy", status: "draft" as const, updatedAt: "2026-10-17" };
  assert.deepEqual(buildEmailDraft({ company: "Example", brief: { why: "Old site", emailDraft: saved } }), { subject: saved.subject, body: saved.body });
});


test("signature links to SKOX while user content stays escaped", () => {
  const mail = leadEmailPayload("lead@example.com", "Preview", "Hi A&B,<script>bad</script>\n\nBest,\nReiss Skeen\nSKOX Software\n904-792-0720");
  assert.match(mail.html, /<a href="https:\/\/www.skoxsoftware.com">SKOX Software<\/a>/);
  assert.match(mail.html, /A&amp;B,&lt;script&gt;bad&lt;\/script&gt;/);
  assert.doesNotMatch(mail.html, /<script>/);
  assert.match(mail.text, /SKOX Software \(https:\/\/www.skoxsoftware.com\)/);
});
