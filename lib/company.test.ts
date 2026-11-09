import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SEATS, chainToOwner, inboxOrder, medianHoursToDecide, ownerDecision, runInput, seatByKey, seatPulse, serviceProposalTransition,
} from "./company.ts";

test("every seat reports up to Josh, and keys are unique", () => {
  assert.equal(new Set(SEATS.map((s) => s.key)).size, SEATS.length);
  for (const s of SEATS) {
    const chain = chainToOwner(s.key);
    assert.equal(chain.at(-1), "josh", `${s.key} doesn't reach Josh`);
    if (s.parent) assert.ok(seatByKey.has(s.parent), `${s.key} has an unknown parent`);
  }
  assert.deepEqual(chainToOwner("outreach-writer"), ["outreach-writer", "revenue", "claude", "josh"]);
});

test("seats can't approve: only done after approval, withdrawn while pending", () => {
  assert.equal(serviceProposalTransition("approved", "done"), "done");
  assert.equal(serviceProposalTransition("pending", "withdrawn"), "withdrawn");
  assert.ok(typeof serviceProposalTransition("pending", "done") === "object");
  assert.ok(typeof serviceProposalTransition("denied", "done") === "object");
});

test("Josh decides a card once", () => {
  assert.equal(ownerDecision("pending", "approve"), "approved");
  assert.equal(ownerDecision("pending", "deny"), "denied");
  assert.ok(typeof ownerDecision("approved", "deny") === "object");
});

test("runs validate the seat and the cards", () => {
  const ok = runInput.safeParse({ seat: "prospector", summary: "Added 12 firms", proposals: [{ kind: "message", title: "Email Long Surveying", why: "ALTA hook", confidence: 70 }] });
  assert.ok(ok.success);
  assert.ok(!runInput.safeParse({ seat: "josh", summary: "nope" }).success);
  assert.ok(!runInput.safeParse({ seat: "nobody", summary: "nope" }).success);
  assert.ok(!runInput.safeParse({ seat: "prospector", summary: "x", proposals: [{ kind: "message", title: "Hi there", why: "because", confidence: 140 }] }).success);
});

test("inbox puts high impact first, then oldest", () => {
  const d = (n: number) => new Date(2026, 10, n);
  const out = inboxOrder([
    { id: "a", impact: "low", createdAt: d(1) },
    { id: "b", impact: "high", createdAt: d(3) },
    { id: "c", impact: "high", createdAt: d(2) },
  ]);
  assert.deepEqual(out.map((c) => c.id), ["c", "b", "a"]);
});

test("pulse and median", () => {
  const now = new Date("2026-11-09T12:00:00Z");
  assert.equal(seatPulse("planned", now, now), "planned");
  assert.equal(seatPulse("live", null, now), "idle");
  assert.equal(seatPulse("live", new Date(now.getTime() - 5 * 60_000), now), "working");
  assert.equal(seatPulse("live", new Date(now.getTime() - 86_400_000), now), "active");
  assert.equal(medianHoursToDecide([]), null);
  const c = (h: number) => ({ createdAt: new Date(0), decidedAt: new Date(h * 3_600_000) });
  assert.equal(medianHoursToDecide([c(1), c(3), c(10)]), 3);
  assert.equal(medianHoursToDecide([c(2), c(4), { createdAt: new Date(0), decidedAt: null }]), 3);
});
