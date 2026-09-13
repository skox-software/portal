import assert from "node:assert/strict";
import { test } from "node:test";
import { invoiceLocked, startSteps } from "./onboarding.ts";

const doc = { id: "d1", title: "Build agreement", status: "out_for_signature" as const };
const invoice = { id: "i1", number: "SKX-001", status: "open" as const };

test("no agreement and no deposit means no Get started card", () => {
  assert.equal(startSteps({ projectId: "p", projectStatus: "kickoff", document: null, invoice: null }), null);
});

test("signing comes first, paying is locked until then", () => {
  const steps = startSteps({ projectId: "p", projectStatus: "kickoff", document: doc, invoice })!;
  assert.deepEqual(steps.map((s) => s.state), ["current", "locked", "locked"]);
  assert.equal(steps[1].href, undefined, "a locked step has no link");
});

test("after signing, the deposit is the current step", () => {
  const steps = startSteps({ projectId: "p", projectStatus: "kickoff", document: { ...doc, status: "completed" }, invoice })!;
  assert.deepEqual(steps.map((s) => [s.key, s.state]), [["sign", "done"], ["pay", "current"], ["build", "locked"]]);
});

test("the card disappears once signed, paid and building", () => {
  assert.equal(
    startSteps({ projectId: "p", projectStatus: "building", document: { ...doc, status: "completed" }, invoice: { ...invoice, status: "paid" } }),
    null,
  );
});

test("a cancelled agreement drops out of the path", () => {
  const steps = startSteps({ projectId: "p", projectStatus: "kickoff", document: { ...doc, status: "void" }, invoice })!;
  assert.deepEqual(steps.map((s) => s.key), ["pay", "build"]);
});

test("a deposit tied to an unsigned agreement is locked", () => {
  assert.equal(invoiceLocked({ documentId: "d1" }, "out_for_signature"), true);
  assert.equal(invoiceLocked({ documentId: "d1" }, "completed"), false);
  assert.equal(invoiceLocked({ documentId: null }, undefined), false);
});
