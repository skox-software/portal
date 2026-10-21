import assert from "node:assert/strict";
import { test } from "node:test";
import { funnelRows } from "./funnel-math.ts";

test("each deal counts once per stage it entered", () => {
  const rows = funnelRows([
    { dealId: "a", stage: "lead", valueCents: 1000 },
    { dealId: "b", stage: "lead", valueCents: 2000 },
    { dealId: "a", stage: "initial_outreach", valueCents: 1000 },
    { dealId: "a", stage: "initial_outreach", valueCents: 1000 },
    { dealId: "a", stage: "proposal_sent", valueCents: null },
    { dealId: "a", stage: "lost", valueCents: 1000 },
  ]);
  // Old Lead and Initial outreach both fold into Outreach.
  assert.deepEqual(rows.map((r) => r.count), [2, 0, 0, 0, 1, 0]);
  assert.equal(rows[0].valueCents, 3000);
  assert.equal(rows[4].valueCents, 0);
});

test("conversion is the next stage over this one", () => {
  const rows = funnelRows([
    { dealId: "a", stage: "outreach_1", valueCents: 0 },
    { dealId: "b", stage: "outreach_2", valueCents: 0 },
    { dealId: "c", stage: "outreach_1", valueCents: 0 },
    { dealId: "c", stage: "emailed", valueCents: 0 },
  ]);
  assert.equal(rows[0].conversion, 1 / 3);
  assert.equal(rows[1].conversion, 0);
  assert.equal(rows[2].conversion, null);
  assert.equal(rows[5].conversion, null);
});
