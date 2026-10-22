import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPreviewEmail } from "./preview-email.ts";
import { linksPreview } from "./preview-tracking.ts";

const author = { name: "Reiss Skeen", firstName: "Reiss", title: "Co-founder, SKOX Software" };
const url = "https://previews.skoxsoftware.com/foster-rentals-24ff";

test("the preview email greets them, carries the link on its own line and is signed by the sender", () => {
  const e = buildPreviewEmail({ company: "Foster Rentals", contactName: "Grace Macy", url, author });
  assert.equal(e.subject, "Foster Rentals: your website preview");
  assert.match(e.body, /^Hi Grace,/);
  assert.ok(e.body.split("\n").includes(url));
  assert.ok(linksPreview(e.body, url), "sending it must mark the preview sent");
  assert.match(e.body, /Reiss Skeen\nCo-founder, SKOX Software/);
  assert.doesNotMatch(e.body, /\$\d/);
});

test("without a contact name it says Hi there", () => {
  assert.match(buildPreviewEmail({ company: "X", url, author }).body, /^Hi there,/);
});
