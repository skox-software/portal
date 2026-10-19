import { test } from "node:test";
import assert from "node:assert/strict";
import { leadEmailPayload, OPT_OUT_LINE } from "./lead-email.ts";
import { buildEmailDraft } from "./email-draft.ts";
import { tokenDealId, unsubscribeToken, unsubscribeUrl, verifyUnsubscribeToken } from "./unsubscribe.ts";

const footer = { postalAddress: "123 Example St, Orlando, FL 32801", unsubscribeUrl: "https://www.skoxsoftware.com/portal/u/abc.def" };
const DEAL = "4e9de8c6-50f1-47cf-a564-4cafbf382c22";

test("pipeline mail uses Reiss for From and Reply-To, preserving reviewed content", () => {
  const mail = leadEmailPayload("lead@example.com", "Their preview", "Reviewed message", footer);
  assert.equal(mail.from, "Reiss Skeen <reiss@skoxsoftware.com>");
  assert.equal(mail.replyTo, "reiss@skoxsoftware.com");
  assert.equal(mail.to, "lead@example.com");
  assert.equal(mail.subject, "Their preview");
  assert.ok(mail.text.startsWith("Reviewed message\n"));
  assert.ok(mail.html.startsWith('<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#202124">Reviewed message</div>'));
});
test("a saved personalized draft takes precedence over generated copy", () => {
  const saved = { id: "a", fromEmail: "reiss@skoxsoftware.com", subject: "Personalized preview", body: "The reviewed copy", status: "draft" as const, updatedAt: "2026-10-17" };
  assert.deepEqual(buildEmailDraft({ company: "Example", brief: { why: "Old site", emailDraft: saved } }), { subject: saved.subject, body: saved.body });
});

test("signature links to SKOX while user content stays escaped", () => {
  const mail = leadEmailPayload("lead@example.com", "Preview", "Hi A&B,<script>bad</script>\n\nBest,\nReiss Skeen\nSKOX Software\n904-792-0720", footer);
  assert.match(mail.html, /<a href="https:\/\/www.skoxsoftware.com">SKOX Software<\/a>/);
  assert.match(mail.html, /A&amp;B,&lt;script&gt;bad&lt;\/script&gt;/);
  assert.doesNotMatch(mail.html, /<script>/);
  assert.match(mail.text, /SKOX Software \(https:\/\/www.skoxsoftware.com\)/);
});

test("standalone preview links are clickable and HTML escaped", () => {
  const mail = leadEmailPayload("lead@example.com", "Preview", 'https://example.com/preview/?a=1&b="x"\njavascript:alert(1)', footer);
  assert.ok(mail.html.includes('<a href="https://example.com/preview/?a=1&amp;b=&quot;x&quot;">'));
  assert.ok(!mail.html.includes('href="javascript:'));
});

test("both versions end with the postal address and the opt-out link", () => {
  const mail = leadEmailPayload("lead@example.com", "Preview", "Hello", footer);
  assert.ok(mail.text.endsWith(`SKOX Software · ${footer.postalAddress}\n${OPT_OUT_LINE}: ${footer.unsubscribeUrl}`));
  assert.ok(mail.html.includes(footer.postalAddress));
  assert.ok(mail.html.includes(`${OPT_OUT_LINE.replace(/'/g, "&#39;")}: <a href="${footer.unsubscribeUrl}"`));
  assert.deepEqual(mail.headers, { "List-Unsubscribe": `<${footer.unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" });
});

test("no postal address or unsubscribe link means no email", () => {
  for (const postalAddress of ["", "   ", undefined as unknown as string]) {
    assert.throws(() => leadEmailPayload("lead@example.com", "Preview", "Hello", { ...footer, postalAddress }), /SKOX_POSTAL_ADDRESS/);
  }
  for (const link of ["", "http://example.com/u/x", "javascript:alert(1)"]) {
    assert.throws(() => leadEmailPayload("lead@example.com", "Preview", "Hello", { ...footer, unsubscribeUrl: link }), /unsubscribe/);
  }
});

test("unsubscribe tokens round-trip for the deal and address they were signed for", () => {
  const token = unsubscribeToken(DEAL, "Lead@Example.com", "secret");
  assert.equal(tokenDealId(token), DEAL);
  assert.ok(!token.includes("@"), "the address is never in the link");
  assert.ok(verifyUnsubscribeToken(token, ["lead@example.com"], "secret"));
  assert.ok(verifyUnsubscribeToken(token, [null, "old@example.com", "LEAD@example.com "], "secret"));
  assert.ok(!verifyUnsubscribeToken(token, ["other@example.com"], "secret"));
  assert.ok(!verifyUnsubscribeToken(token, ["lead@example.com"], "wrong"));
  assert.ok(!verifyUnsubscribeToken(token, ["lead@example.com"], ""));
  const other = unsubscribeToken("00000000-0000-4000-8000-000000000000", "lead@example.com", "secret");
  assert.ok(!verifyUnsubscribeToken(`${DEAL}.${other.split(".")[1]}`, ["lead@example.com"], "secret"), "a signature can't be moved to another deal");
  for (const bad of ["", "nope", `${DEAL}`, `${DEAL}.`, `${DEAL}.a.b`, `not-a-uuid.${token.split(".")[1]}`]) assert.ok(!verifyUnsubscribeToken(bad, ["lead@example.com"], "secret"));
  assert.throws(() => unsubscribeToken(DEAL, "lead@example.com", ""), /UNSUBSCRIBE_SECRET/);
  assert.equal(unsubscribeUrl("https://www.skoxsoftware.com/portal/", DEAL, "lead@example.com", "secret"), `https://www.skoxsoftware.com/portal/u/${token}`);
});
