import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOutreachRows, filterRows, inPeriod, senderName, summarize, type SentEmail, type StatusEvent } from "./outreach-log.ts";

const at = (d: number, h = 12) => `2026-10-${String(d).padStart(2, "0")}T${String(h).padStart(2, "0")}:00:00.000Z`;
const email = (over: Partial<SentEmail> & { key: string }): SentEmail => ({
  kind: "lead",
  dealId: "d1",
  lead: "Acme Roofing",
  sentAt: at(19),
  to: "owner@acme.test",
  subject: "A website concept",
  from: "reiss@outreach.skoxsoftware.com",
  replyTo: "reiss@skoxsoftware.com",
  senderEmail: null,
  providerId: null,
  ...over,
});
const report = (providerId: string, status: StatusEvent["status"], when: string, reason?: string): StatusEvent => ({ providerId, status, at: when, ...(reason ? { reason } : {}) });

test("each email gets its own reports, by Resend id, newest email first", () => {
  const rows = buildOutreachRows(
    [email({ key: "a", providerId: "re_1", sentAt: at(10) }), email({ key: "b", providerId: "re_2", sentAt: at(15) })],
    [report("re_1", "delivered", at(10, 13)), report("re_1", "opened", at(11)), report("re_2", "bounced", at(15, 13), "550 no mailbox")],
  );
  assert.deepEqual(rows.map((r) => [r.key, r.status]), [["b", "bounced"], ["a", "opened"]], "same lead, separate statuses");
  assert.equal(rows[0].reason, "550 no mailbox");
  assert.equal(rows[1].lastActivity, at(11), "last activity is the newest report");
});

test("a late delivered report doesn't hide an open, and spam outranks a click", () => {
  const rows = buildOutreachRows(
    [email({ key: "a", providerId: "re_1" }), email({ key: "b", providerId: "re_2" })],
    [report("re_1", "opened", at(19, 13)), report("re_1", "delivered", at(19, 14)), report("re_2", "clicked", at(19, 13)), report("re_2", "complained", at(19, 14))],
  );
  assert.equal(rows.find((r) => r.key === "a")?.status, "opened");
  assert.equal(rows.find((r) => r.key === "b")?.status, "complained");
  assert.equal(rows.find((r) => r.key === "a")?.lastActivity, at(19, 14));
});

test("the campaign sent before tracking says so, unless a report came in later", () => {
  const rows = buildOutreachRows(
    [email({ key: "old", kind: "scheduled", providerId: "re_9" }), email({ key: "old2", kind: "scheduled", providerId: "re_8" }), email({ key: "new", providerId: "re_7" })],
    [report("re_8", "opened", at(20))],
  );
  const by = (k: string) => rows.find((r) => r.key === k)!;
  assert.equal(by("old").status, "untracked");
  assert.equal(by("old").note, "Sent before tracking");
  assert.equal(by("old2").status, "opened");
  assert.equal(by("new").status, "sent");
  assert.equal(by("new").note, "No report yet");
});

test("an inbox copy of a lead-panel send is shown once; replies are their own rows", () => {
  const rows = buildOutreachRows(
    [
      email({ key: "event", providerId: "re_1" }),
      email({ key: "copy", kind: "reply", providerId: "sent:re_1", sentAt: at(19, 13) }),
      email({ key: "reply", kind: "reply", providerId: "sent:re_2", sentAt: at(20), subject: "Re: A website concept" }),
    ],
    [report("re_1", "delivered", at(19, 13))],
  );
  assert.deepEqual(rows.map((r) => r.key), ["reply", "event"]);
  assert.equal(rows[0].providerId, "re_2", "the inbox prefix is dropped");
});

test("the sender is Josh or Reiss, whichever address is known", () => {
  assert.equal(senderName({ senderEmail: "founders@skoxsoftware.com", replyTo: null, from: null }), "Josh");
  assert.equal(senderName({ senderEmail: null, replyTo: "reiss@skoxsoftware.com", from: null }), "Reiss");
  assert.equal(senderName({ senderEmail: null, replyTo: null, from: "josh@outreach.skoxsoftware.com" }), "Josh");
  assert.equal(senderName({ senderEmail: null, replyTo: null, from: "founders@skoxsoftware.com" }), "Josh");
  assert.equal(senderName({ senderEmail: null, replyTo: null, from: null }), "Unknown");
});

test("the summary counts each stage reached; rates leave out what can't be tracked", () => {
  const rows = buildOutreachRows(
    [
      email({ key: "1", providerId: "re_1" }),
      email({ key: "2", providerId: "re_2" }),
      email({ key: "3", providerId: "re_3" }),
      email({ key: "4", providerId: "re_4" }),
      email({ key: "old", kind: "scheduled", providerId: "re_5" }),
    ],
    // A click with no delivered or opened report still counts as both.
    [report("re_1", "clicked", at(19, 13)), report("re_2", "delivered", at(19, 13)), report("re_3", "bounced", at(19, 13)), report("re_4", "complained", at(19, 13))],
  );
  const { tiles, tracked, untracked } = summarize(rows);
  const n = Object.fromEntries(tiles.map((t) => [t.key, [t.count, t.rate]]));
  assert.equal(tracked, 4);
  assert.equal(untracked, 1);
  assert.deepEqual(n.sent, [5, null]);
  assert.deepEqual(n.delivered, [3, 0.75], "clicked, delivered and the spam report were all delivered");
  assert.deepEqual(n.opened, [1, 0.25]);
  assert.deepEqual(n.clicked, [1, 0.25]);
  assert.deepEqual(n.bounced, [1, 0.25]);
  assert.deepEqual(n.complained, [1, 0.25]);
  assert.equal(summarize([]).tiles[1].rate, null, "nothing to divide by");
});

test("periods count back from now; filters combine", () => {
  const rows = buildOutreachRows(
    [
      email({ key: "today", providerId: "re_1", sentAt: at(19), lead: "Acme Roofing", replyTo: "reiss@skoxsoftware.com" }),
      email({ key: "week", providerId: "re_2", sentAt: at(13), lead: "Bayside HVAC", to: "ops@bayside.test", replyTo: "founders@skoxsoftware.com" }),
      email({ key: "month", providerId: "re_3", sentAt: at(1), lead: "Coastal Lawn", subject: "Quick question" }),
    ],
    [report("re_2", "opened", at(14))],
  );
  const now = new Date(at(19, 15));
  assert.deepEqual(inPeriod(rows, "7d", now).map((r) => r.key), ["today", "week"]);
  assert.equal(inPeriod(rows, "30d", now).length, 3);
  assert.equal(inPeriod(rows, "all", now).length, 3);
  assert.deepEqual(filterRows(rows, { sender: "Josh" }).map((r) => r.key), ["week"]);
  assert.deepEqual(filterRows(rows, { status: "sent" }).map((r) => r.key), ["today", "month"]);
  assert.deepEqual(filterRows(rows, { q: "bayside" }).map((r) => r.key), ["week"], "matches the lead");
  assert.deepEqual(filterRows(rows, { q: "QUICK question" }).map((r) => r.key), ["month"], "matches the subject, any case");
  assert.deepEqual(filterRows(rows, { q: "ops@bayside", status: "opened", sender: "Josh" }).map((r) => r.key), ["week"]);
  assert.deepEqual(filterRows(rows, { q: "acme", sender: "Josh" }), []);
});
