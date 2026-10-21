import assert from "node:assert/strict";
import { test } from "node:test";
import { activeMetrics, formatPct, outreachMetrics, rate, type ContactEvent } from "./pipeline-metrics.ts";

// 2026-10-21 15:00 in Florida.
const now = new Date("2026-10-21T19:00:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);
const call = (dealId: string, outcome: string, at = hoursAgo(1)): ContactEvent => ({ dealId, verb: "deal.call_logged", outcome, at });

test("a rate has no value without a sample, and always carries its n", () => {
  assert.deepEqual(rate(0, 0), { hits: 0, n: 0, pct: null });
  assert.equal(formatPct(rate(0, 0)), "–");
  assert.deepEqual(rate(1, 3), { hits: 1, n: 3, pct: 33 });
  assert.equal(formatPct(rate(2, 4)), "50%");
});

test("outreach: attempts today, then connect, interest and preview rates per call", () => {
  const events: ContactEvent[] = [
    call("a", "no_answer"),
    call("a", "voicemail"),
    call("b", "spoke"),
    call("c", "interested"),
    call("d", "preview"),
    call("e", "not_interested"),
    call("f", "gatekeeper"),
    // A cold email logged by hand is an attempt but not a dial.
    call("g", "emailed"),
    { dealId: "h", verb: "deal.email_sent", outcome: null, at: hoursAgo(2) },
    // A note isn't an attempt.
    { dealId: "a", verb: "deal.call_logged", outcome: null, at: hoursAgo(1) },
    // Yesterday counts for rates, not for today.
    call("i", "no_answer", hoursAgo(30)),
    // Older than the 30-day window counts for nothing.
    call("j", "interested", hoursAgo(24 * 40)),
  ];
  const industry = new Map<string, string | null>([["c", "Legal"], ["d", "Legal"], ["e", "Legal"], ["b", " "]]);
  const m = outreachMetrics(events, industry, now);
  assert.equal(m.attemptsToday, 9);
  assert.equal(m.dials, 8);
  assert.deepEqual(m.connect, { hits: 4, n: 8, pct: 50 });
  assert.deepEqual(m.interest, { hits: 2, n: 4, pct: 50 });
  assert.deepEqual(m.preview, { hits: 1, n: 4, pct: 25 });
  const legal = m.industries.find((i) => i.industry === "Legal")!;
  assert.equal(legal.dials, 3);
  assert.equal(legal.comparable, false);
  assert.deepEqual(legal.interest, { hits: 2, n: 3, pct: 67 });
  // Blank and missing industries group as "Not set", biggest first.
  assert.equal(m.industries[0].industry, "Not set");
});

test("outreach with no calls shows no rates", () => {
  const m = outreachMetrics([], new Map(), now);
  assert.equal(m.attemptsToday, 0);
  assert.equal(m.connect.pct, null);
  assert.deepEqual(m.industries, []);
});

test("pipeline: open value, win rate, days to close and deals with no next step", () => {
  const d = (over: Partial<Parameters<typeof activeMetrics>[0][number]>) => ({
    stage: "replied" as const,
    valueCents: null,
    nextStepOn: null,
    createdAt: new Date("2026-09-01T12:00:00Z"),
    promotedAt: null,
    wonAt: null,
    ...over,
  });
  const m = activeMetrics(
    [
      d({ valueCents: 300_000, nextStepOn: "2026-10-22" }),
      d({ stage: "meeting", nextStepOn: "2026-10-01" }),
      d({ stage: "proposal_sent", valueCents: 500_000 }),
      d({ stage: "won", valueCents: 400_000, promotedAt: new Date("2026-10-01T12:00:00Z"), wonAt: new Date("2026-10-11T12:00:00Z") }),
      d({ stage: "won", createdAt: new Date("2026-10-01T12:00:00Z"), wonAt: new Date("2026-10-21T12:00:00Z") }),
      d({ stage: "lost" }),
      // Outreach leads aren't in the Pipeline's numbers.
      d({ stage: "outreach_2", valueCents: 900_000 }),
    ],
    "2026-10-21",
  );
  assert.equal(m.openCents, 800_000);
  assert.equal(m.openCount, 3);
  assert.equal(m.unvalued, 1);
  assert.deepEqual(m.winRate, { hits: 2, n: 3, pct: 67 });
  assert.equal(m.avgDaysToClose, 15);
  assert.equal(m.closedN, 2);
  // The overdue one and the one with nothing set.
  assert.equal(m.needsNext, 2);
});
