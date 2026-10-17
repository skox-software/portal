import assert from "node:assert/strict";
import { test } from "node:test";
import { describeEvent, newEvents, stageName, type LiveEvent } from "./live-feed.ts";

test("a paid invoice names the client, the invoice and the amount", () => {
  assert.deepEqual(describeEvent("invoice.paid", { title: "Deposit", amountCents: 250_000, client: "Harbor Dental" }), {
    icon: "paid",
    text: "Harbor Dental paid · Deposit",
    amountCents: 250_000,
  });
  assert.equal(describeEvent("invoice.paid", { amountCents: 100 })?.text, "Invoice paid");
});

test("new invoices carry their amount", () => {
  const line = describeEvent("invoice.created", { title: "Phase 2", amountCents: 480_000, client: "Acme" });
  assert.equal(line?.text, "New invoice for Acme · Phase 2");
  assert.equal(line?.amountCents, 480_000);
});

test("stage moves read as wins, losses or moves", () => {
  assert.deepEqual(describeEvent("deal.stage_changed", { company: "Acme", from: "negotiation", to: "won" }), { icon: "won", text: "Acme won" });
  assert.equal(describeEvent("deal.stage_changed", { company: "Acme", to: "lost" })?.icon, "lost");
  assert.equal(describeEvent("deal.updated", { company: "Acme", from: "lead", to: "proposal_sent" })?.text, "Acme moved to Proposal sent");
});

test("deal edits that didn't move stage are skipped", () => {
  assert.equal(describeEvent("deal.updated", { company: "Acme" }), null);
  assert.equal(describeEvent("deal.updated", { company: "Acme", via: "website", enquiry: "repeat" }), null);
});

test("calls show the outcome, and a stage only when it's news", () => {
  assert.equal(describeEvent("deal.call_logged", { company: "Acme", outcome: "spoke" })?.text, "Call with Acme · Spoke with them");
  // Every first call moves a lead to Initial outreach: not worth repeating.
  assert.equal(describeEvent("deal.call_logged", { company: "Acme", outcome: "voicemail", from: "lead", to: "initial_outreach" })?.text, "Call with Acme · Left voicemail");
  assert.equal(describeEvent("deal.call_logged", { company: "Acme", outcome: "not_interested", to: "lost" })?.text, "Call with Acme · Not interested · Lost");
});

test("new deals say where they came from", () => {
  assert.equal(describeEvent("deal.created", { company: "Acme", from: "website", status: "new" })?.text, "New lead: Acme from the website");
  assert.equal(describeEvent("deal.created", { company: "Acme", stage: "proposal_sent" })?.text, "New proposal sent deal: Acme");
  assert.equal(describeEvent("deal.created", { from: "project" })?.text, "New deal from a project");
  assert.equal(describeEvent("deal.created", { company: "Acme", source: "rep" })?.text, "New lead: Acme by a rep");
});

test("commission and statements carry their amounts", () => {
  assert.deepEqual(describeEvent("commission.earned", { invoice: "SK-104", amountCents: 125_000, rateBps: 5000, rep: "Reiss" }), {
    icon: "commission",
    text: "Reiss earned commission on SK-104",
    amountCents: 125_000,
  });
  assert.deepEqual(describeEvent("statement.paid", { totalCents: 90_000, rep: "Reiss" }), { icon: "statement", text: "Statement paid to Reiss", amountCents: 90_000 });
});

test("unknown verbs and missing payloads don't throw", () => {
  assert.equal(describeEvent("file.uploaded", {}), null);
  assert.equal(describeEvent("invoice.created", null)?.text, "New invoice");
  assert.equal(describeEvent("invoice.paid", { amountCents: "lots" })?.amountCents, undefined);
});

test("stage names fall back to readable text", () => {
  assert.equal(stageName("initial_outreach"), "Initial outreach");
  assert.equal(stageName("lost"), "Lost");
  assert.equal(stageName("on_hold"), "on hold");
});

test("only events not seen before count as new", () => {
  const e = (id: string): LiveEvent => ({ id, at: "2026-10-17T12:00:00Z", verb: "invoice.paid", icon: "paid", text: "" });
  assert.deepEqual(newEvents([e("a"), e("b")], [e("c"), e("a"), e("b")]).map((x) => x.id), ["c"]);
  assert.deepEqual(newEvents([], [e("a")]).map((x) => x.id), ["a"]);
});
