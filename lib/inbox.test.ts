import assert from "node:assert/strict";
import { test } from "node:test";
import {
  counterpartOf,
  matchOwner,
  messageIds,
  parseAddress,
  parseAddresses,
  replySubject,
  snippet,
  stripQuoted,
  subjectKey,
} from "./inbox.ts";

test("addresses are read with or without a display name", () => {
  assert.deepEqual(parseAddress("Dana Whitfield <Dana@Harbor.test>"), { email: "dana@harbor.test", name: "Dana Whitfield" });
  assert.deepEqual(parseAddress('"Whitfield, Dana" <dana@harbor.test>'), { email: "dana@harbor.test", name: "Whitfield, Dana" });
  assert.deepEqual(parseAddress("dana@harbor.test"), { email: "dana@harbor.test", name: null });
  assert.equal(parseAddress("not an address"), null);
  assert.deepEqual(parseAddresses('"Lee, Ann" <ann@x.test>, bo@y.test').map((a) => a.email), ["ann@x.test", "bo@y.test"]);
});

test("subjects match across Re:, Fwd: and tags", () => {
  assert.equal(subjectKey("RE: Fwd: [External] Intake form  fields"), "intake form fields");
  assert.equal(replySubject("Re: Intake form fields"), "Re: Intake form fields");
  assert.equal(replySubject("Intake form fields"), "Re: Intake form fields");
  assert.deepEqual(messageIds("<a@x> <b@y>"), ["a@x", "b@y"]);
});

test("quoted history is trimmed from replies", () => {
  const gmail = "Here you go — new patient forms.\n\nOn Sat, Sep 20, 2026 at 4:10 PM Reiss <reiss@skox.test> wrote:\n> Could you send the forms?";
  assert.equal(stripQuoted(gmail), "Here you go — new patient forms.");
  const wrapped = "Sounds good.\nOn Sat, Sep 20, 2026 at 4:10 PM Reiss Smith <reiss@skox.test>\nwrote:\n> hi";
  assert.equal(stripQuoted(wrapped), "Sounds good.");
  const outlook = "Yes please.\n\nFrom: Reiss <reiss@skox.test>\nSent: Saturday\nSubject: Re: forms";
  assert.equal(stripQuoted(outlook), "Yes please.");
  assert.equal(stripQuoted("> only quoted"), "> only quoted", "never returns an empty message");
  assert.equal(snippet("a ".repeat(100), 20).length, 20);
});

test("mail from SKOX is outbound, with the outside recipient as the counterpart", () => {
  const isStaff = (e: string) => e.endsWith("@skoxsoftware.com");
  const out = counterpartOf({ email: "reiss@skoxsoftware.com", name: "Reiss" }, [{ email: "crm@inbox.skoxsoftware.com", name: null }, { email: "dana@harbor.test", name: "Dana" }], isStaff, ["crm@inbox.skoxsoftware.com"]);
  assert.deepEqual(out, { direction: "outbound", counterpart: { email: "dana@harbor.test", name: "Dana" } });
  const inbound = counterpartOf({ email: "dana@harbor.test", name: "Dana" }, [{ email: "reiss@skoxsoftware.com", name: null }], isStaff);
  assert.equal(inbound?.direction, "inbound");
  assert.equal(counterpartOf({ email: "josh@skoxsoftware.com", name: null }, [{ email: "reiss@skoxsoftware.com", name: null }], isStaff), null, "internal mail is not a conversation");
});

test("threads land on a client by exact contact, then by company domain", () => {
  const contacts = [
    { email: "dana@harbordental.test", clientId: "harbor", dealId: null },
    { email: "marcus@northline.test", clientId: null, dealId: "northline" },
    { email: "a@gmail.com", clientId: "x", dealId: null },
    { email: "b@shared.test", clientId: "one", dealId: null },
    { email: "c@shared.test", clientId: "two", dealId: null },
  ];
  assert.deepEqual(matchOwner("DANA@harbordental.test", contacts), { clientId: "harbor", dealId: null });
  assert.deepEqual(matchOwner("frontdesk@harbordental.test", contacts), { clientId: "harbor", dealId: null });
  assert.deepEqual(matchOwner("ben@northline.test", contacts), { clientId: null, dealId: "northline" });
  assert.equal(matchOwner("someone@gmail.com", contacts), null, "free mail never matches by domain");
  assert.equal(matchOwner("d@shared.test", contacts), null, "an ambiguous domain stays unassigned");
});
