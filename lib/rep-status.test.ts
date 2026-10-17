import assert from "node:assert/strict";
import { test } from "node:test";
import { repCanWork, repStatus } from "./rep-status.ts";

test("early stages are the rep's to work", () => {
  assert.equal(repStatus({ stage: "lead", meetingAt: null }), "working");
  assert.equal(repStatus({ stage: "initial_outreach", meetingAt: null }), "working");
});

test("a booked meeting shows as booked until SKOX quotes", () => {
  assert.equal(repStatus({ stage: "initial_outreach", meetingAt: new Date() }), "booked");
  assert.equal(repStatus({ stage: "proposal_sent", meetingAt: new Date() }), "with_skox");
  assert.equal(repStatus({ stage: "negotiation", meetingAt: null }), "with_skox");
});

test("won and lost are final, and an onboarded project is always won", () => {
  assert.equal(repStatus({ stage: "won", meetingAt: null }), "won");
  assert.equal(repStatus({ stage: "lead", meetingAt: null, projectId: "p1" }), "won");
  assert.equal(repStatus({ stage: "lost", meetingAt: new Date() }), "lost");
});

test("reps only work leads that haven't reached SKOX yet", () => {
  assert.equal(repCanWork("working"), true);
  assert.equal(repCanWork("booked"), true);
  assert.equal(repCanWork("with_skox"), false);
  assert.equal(repCanWork("won"), false);
  assert.equal(repCanWork("lost"), false);
});
