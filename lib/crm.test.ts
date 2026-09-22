import assert from "node:assert/strict";
import { test } from "node:test";
import {
  daysInStage,
  formatDealValue,
  initialsFor,
  isStalled,
  newMessageId,
  normalizeSubject,
  parseAddress,
  parseDollars,
  parseMessageIds,
  replySubject,
  snippetOf,
  stageStamps,
} from "./crm.ts";

test("parseAddress handles display names, quotes and bare addresses", () => {
  assert.deepEqual(parseAddress('"Dana Whitfield" <Dana@Harbor.com>'), { email: "dana@harbor.com", name: "Dana Whitfield" });
  assert.deepEqual(parseAddress("Dana <dana@harbor.com>"), { email: "dana@harbor.com", name: "Dana" });
  assert.deepEqual(parseAddress(" Dana@Harbor.com "), { email: "dana@harbor.com", name: null });
  assert.deepEqual(parseAddress("<dana@harbor.com>"), { email: "dana@harbor.com", name: null });
});

test("normalizeSubject strips reply and forward prefixes", () => {
  assert.equal(normalizeSubject("Re: Fwd: Booking  flow"), "booking flow");
  assert.equal(normalizeSubject("RE: re: FW: Booking flow"), "booking flow");
  assert.equal(normalizeSubject("Re[2]: Booking flow"), "booking flow");
  assert.equal(normalizeSubject("Booking flow"), "booking flow");
  assert.equal(normalizeSubject(null), "");
});

test("replySubject adds Re: only once", () => {
  assert.equal(replySubject("Proposal"), "Re: Proposal");
  assert.equal(replySubject("Re: Proposal"), "Re: Proposal");
  assert.equal(replySubject("RE:Proposal"), "RE:Proposal");
});

test("parseMessageIds reads In-Reply-To and References", () => {
  assert.deepEqual(parseMessageIds("<a@x.com> <b@y.com>"), ["<a@x.com>", "<b@y.com>"]);
  assert.deepEqual(parseMessageIds(null), []);
  assert.deepEqual(parseMessageIds("garbage"), []);
});

test("new message ids are angle-bracketed on our domain", () => {
  assert.equal(newMessageId("skoxsoftware.com", "abc"), "<abc@skoxsoftware.com>");
});

test("stalled only applies to selling stages past ten days", () => {
  assert.equal(isStalled("lead", 10), false);
  assert.equal(isStalled("lead", 11), true);
  assert.equal(isStalled("negotiation", 30), true);
  assert.equal(isStalled("in_build", 30), false);
  assert.equal(isStalled("shipped", 30), false);
  assert.equal(isStalled("lost", 30), false);
});

test("daysInStage counts whole days and never goes negative", () => {
  const now = Date.parse("2026-09-22T12:00:00Z");
  assert.equal(daysInStage(new Date("2026-09-11T13:00:00Z"), now), 10);
  assert.equal(daysInStage(new Date("2026-09-23T00:00:00Z"), now), 0);
});

test("stage stamps are set once and not overwritten", () => {
  const now = new Date("2026-09-22T00:00:00Z");
  const empty = { wonAt: null, shippedAt: null, lostAt: null };
  assert.deepEqual(stageStamps("won", empty, now), { wonAt: now });
  assert.deepEqual(stageStamps("shipped", empty, now), { wonAt: now, shippedAt: now });
  assert.deepEqual(stageStamps("won", { ...empty, wonAt: new Date(0) }, now), {});
  assert.deepEqual(stageStamps("lost", empty, now), { lostAt: now });
  assert.deepEqual(stageStamps("lead", empty, now), {});
});

test("dollar parsing accepts what people type and rejects the rest", () => {
  assert.equal(parseDollars("18,500"), 1_850_000);
  assert.equal(parseDollars("$18500.50"), 1_850_050);
  assert.equal(parseDollars(""), 0);
  assert.equal(parseDollars("18k"), null);
  assert.equal(parseDollars("-5"), null);
  assert.equal(formatDealValue(1_850_000), "$18,500");
});

test("initials come from the email local part", () => {
  assert.equal(initialsFor("reiss@skoxsoftware.com"), "RE");
  assert.equal(initialsFor("josh.b@skoxsoftware.com"), "JB");
  assert.equal(initialsFor(null), "—");
});

test("snippet prefers text and strips html otherwise", () => {
  assert.equal(snippetOf("Hello\n\nthere", null), "Hello there");
  assert.equal(snippetOf(null, "<style>p{}</style><p>Hi&nbsp;<b>you</b></p>"), "Hi you");
});
