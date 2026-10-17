import assert from "node:assert/strict";
import { test } from "node:test";
import { briefIsEmpty, callPriority, parseBrief, readBrief } from "./call-brief.ts";

// A nationwide lead as push_to_pipeline.mjs wrote it, with the seller's notes after it.
const NATIONWIDE = [
  "CHECK FIRST: The station became WLSQ in 2023. Confirm it hasn't been sold.",
  "CALL ABOUT: NOT MOBILE · Medical, dental & care",
  "ASK FOR: Dr. Anthony Oswick or Dr. Maria Kashlak",
  "OPENER: You advertise 24-hour emergency care, but there's no way to request a visit.",
  "WHY WE'RE CALLING: The site doesn't fit a phone screen (no mobile layout); the footer still says © 2007.",
  "ABOUT THEM: Dentist in Orlando, FL.",
  "CALL: (407) 876-0290 (number confirmed on own site) · SITE: http://www.oswickkashlakdmd.com/",
  'ALSO MENTION: "Not Secure" warning in the browser',
  "STILL ACTIVE: chamber listing live 2026-10-17",
  "UPGRADE ANGLE: A Bay Hill practice. The upgrades: online appointment requests.",
  "ASK THEM: How do visitors reach you at night?",
  "Called - receptionist said try Tuesday",
].join("\n");

test("the labeled lines become the brief and the seller's notes stay as notes", () => {
  const { brief, rest } = parseBrief(NATIONWIDE);
  assert.ok(brief);
  assert.equal(brief.tag, "NOT MOBILE");
  assert.equal(brief.vertical, "Medical, dental & care");
  assert.equal(brief.askFor, "Dr. Anthony Oswick or Dr. Maria Kashlak");
  assert.match(brief.opener!, /^You advertise/);
  assert.match(brief.why!, /phone screen/);
  assert.equal(brief.alsoMention, '"Not Secure" warning in the browser');
  assert.equal(brief.stillActive, "chamber listing live 2026-10-17");
  assert.match(brief.upgradeAngle!, /Bay Hill/);
  assert.equal(brief.askThem, "How do visitors reach you at night?");
  assert.match(brief.call!, /^\(407\) 876-0290/);
  assert.deepEqual(brief.warnings, [{ kind: "check_first", text: "The station became WLSQ in 2023. Confirm it hasn't been sold." }]);
  assert.equal(rest, "Called - receptionist said try Tuesday");
});

test("the older Florida format: quoted opener, NO WEBSITE tag, weak-lead warning, bookkeeping dropped", () => {
  const { brief, rest } = parseBrief(
    [
      "WEAK LEAD: individual agent; no own site found in search",
      "ASK FOR: Tom Langmann",
      "PHONE: (321) 229-2041",
      'OPENER: "I looked you up and couldn\'t find a website. Can I show you an example?"',
      "WHY (NO WEBSITE): No website on its Google Maps listing.",
      "BUSINESS: 76 Google reviews, 5.0 stars",
      "STATE (Sunbiz, 2026-10-16): active LLC",
      "SOURCES: Google Maps listing ; https://www.google.com/maps/search/?api=1&query=x",
      "Not contacted yet. Added 2026-10-16 from docs/prospects/leads-old-sites-2026-10-16.csv (rank 30).",
    ].join("\n"),
  );
  assert.ok(brief);
  assert.equal(brief.tag, "NO WEBSITE");
  assert.equal(brief.opener, "I looked you up and couldn't find a website. Can I show you an example?");
  assert.equal(brief.call, "(321) 229-2041");
  assert.equal(brief.about, "76 Google reviews, 5.0 stars. active LLC");
  assert.equal(brief.warnings?.[0].kind, "weak_lead");
  assert.match(brief.sources!, /google\.com\/maps/);
  assert.equal(rest, "");
});

test("hand-written notes with no labels are left alone", () => {
  const notes = "Away for 2 weeks - call back end of October\r\nEmail Sent with website preview.";
  const { brief, rest } = parseBrief(notes);
  assert.equal(brief, null);
  assert.equal(rest, "Away for 2 weeks - call back end of October\nEmail Sent with website preview.");
  assert.deepEqual(parseBrief(null), { brief: null, rest: "" });
});

test("phone-unverified warnings and preview links are picked up", () => {
  const { brief } = parseBrief("PHONE UNVERIFIED: only on a 2019 directory\nPREVIEW: https://preview.skoxsoftware.com/acme");
  assert.deepEqual(brief?.warnings, [{ kind: "phone_unverified", text: "only on a 2019 directory" }]);
  assert.equal(brief?.preview, "https://preview.skoxsoftware.com/acme");
});

test("reading the jsonb column never trusts a non-object", () => {
  assert.equal(readBrief(null), null);
  assert.equal(readBrief("x"), null);
  assert.equal(readBrief([1]), null);
  assert.deepEqual(readBrief({ tag: "SITE DOWN" }), { tag: "SITE DOWN" });
  assert.equal(briefIsEmpty({ warnings: [] }), true);
  assert.equal(briefIsEmpty({ askFor: "the owner" }), false);
});

test("call-sheet order: due follow-ups, then dead sites, then not-mobile; warnings last", () => {
  const p = (tag: string, extra: Partial<Parameters<typeof callPriority>[0]> = {}) =>
    callPriority({ brief: { tag }, followUp: "none", contacted: false, ...extra });
  assert.ok(p("NOT MOBILE", { followUp: "overdue" }) < p("SITE DOWN"));
  assert.ok(p("SITE DOWN") < p("NO WEBSITE"));
  assert.ok(p("NO WEBSITE") < p("NOT MOBILE"));
  assert.ok(p("NOT MOBILE") < callPriority({ brief: { tag: "SITE DOWN", warnings: [{ kind: "check_first", text: "x" }] }, followUp: "none", contacted: false }));
  // A named contact and a specific upgrade beat a bare "ask for the owner".
  assert.ok(callPriority({ brief: { tag: "NOT MOBILE", askFor: "Jenna", upgradeAngle: "x" }, followUp: "none", contacted: false }) < p("NOT MOBILE"));
});
