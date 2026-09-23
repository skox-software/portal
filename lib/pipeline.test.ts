import assert from "node:assert/strict";
import { test } from "node:test";
import {
  boardTotals,
  buildBoard,
  columnForProject,
  dealStageForColumn,
  initials,
  isStalled,
  projectStatusForColumn,
  type BoardInput,
} from "./pipeline.ts";

const now = new Date("2026-09-22T12:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);

const project = (over: Partial<BoardInput["projects"][number]> = {}): BoardInput["projects"][number] => ({
  id: "p1",
  name: "Booking Portal",
  kind: "portal",
  status: "building",
  clientId: "c1",
  clientName: "Tasman Tails",
  contact: "owner@tasman.test",
  deliveryDate: "2026-10-14",
  dateTentative: false,
  launchedOn: null,
  createdAt: daysAgo(20),
  billedCents: 1_850_000,
  invoiceCount: 2,
  unpaidCount: 1,
  milestonesDone: 1,
  milestonesTotal: 3,
  ...over,
});

const deal = (over: Partial<BoardInput["deals"][number]> = {}): BoardInput["deals"][number] => ({
  id: "d1",
  company: "Lumen Physio",
  contactName: "Sofia Reyes",
  contactEmail: null,
  kind: "web-app",
  valueCents: 1_200_000,
  stage: "lead",
  ownerEmail: "reiss@skoxsoftware.com",
  source: "manual",
  referralId: null,
  projectId: null,
  stageChangedAt: daysAgo(3),
  ...over,
});

test("project status places the card: kickoff is won, launched is shipped", () => {
  assert.equal(columnForProject("kickoff"), "won");
  assert.equal(columnForProject("building"), "in_build");
  assert.equal(columnForProject("review"), "in_build");
  assert.equal(columnForProject("paused"), "in_build");
  assert.equal(columnForProject("launched"), "shipped");
  assert.equal(projectStatusForColumn("shipped"), "launched");
  assert.equal(projectStatusForColumn("lead"), null);
});

test("a deal can't be dragged into build without becoming a project", () => {
  assert.equal(dealStageForColumn("in_build"), null);
  assert.equal(dealStageForColumn("shipped"), null);
  assert.equal(dealStageForColumn("negotiation"), "negotiation");
  assert.equal(dealStageForColumn("lost"), "lost");
});

test("existing projects appear on the board with invoiced value and progress", () => {
  const { columns } = buildBoard({ deals: [], projects: [project(), project({ id: "p2", status: "kickoff" })], referrals: [] });
  const build = columns.find((c) => c.key === "in_build")!;
  assert.equal(build.cards.length, 1);
  assert.equal(build.totalCents, 1_850_000);
  assert.deepEqual(build.cards[0].progress, { done: 1, total: 3 });
  assert.equal(build.cards[0].paid, false);
  assert.equal(columns.find((c) => c.key === "won")!.cards.length, 1);
});

test("an onboarded deal shows once, as its project, carrying the deal's owner and value", () => {
  const { columns } = buildBoard({
    deals: [deal({ stage: "won", projectId: "p1", valueCents: 2_000_000 })],
    projects: [project()],
    referrals: [],
  });
  const all = columns.flatMap((c) => c.cards);
  assert.equal(all.length, 1);
  assert.equal(all[0].type, "project");
  assert.equal(all[0].valueCents, 2_000_000);
  assert.equal(all[0].ownerEmail, "reiss@skoxsoftware.com");
});

test("unworked referrals are leads; worked, won and lost ones are not repeated", () => {
  const { columns } = buildBoard({
    deals: [deal({ referralId: "r2" })],
    projects: [],
    referrals: [
      { id: "r1", name: "Ana", email: "ana@x.test", company: "Fern & Finch", referrerEmail: "dana@x.test", status: "new", createdAt: daysAgo(1) },
      { id: "r2", name: "Bo", email: "bo@x.test", company: null, referrerEmail: null, status: "contacted", createdAt: daysAgo(1) },
      { id: "r3", name: "Cy", email: "cy@x.test", company: null, referrerEmail: null, status: "lost", createdAt: daysAgo(1) },
    ],
  });
  const leads = columns.find((c) => c.key === "lead")!.cards;
  assert.deepEqual(leads.map((c) => c.key).sort(), ["deal:d1", "referral:r1"]);
});

test("lost deals leave the board; only pre-sale cards stall after 10 days", () => {
  const { columns, lost } = buildBoard({
    deals: [deal({ id: "a", stage: "lost" }), deal({ id: "b", stageChangedAt: daysAgo(16) })],
    projects: [project({ createdAt: daysAgo(40) })],
    referrals: [],
  });
  assert.equal(lost.length, 1);
  const totals = boardTotals(columns, now);
  assert.equal(totals.stalled, 1);
  assert.equal(totals.openCents, 1_200_000);
  assert.equal(totals.wonCents, 1_850_000);
  assert.equal(isStalled("in_build", daysAgo(40), now), false);
});

test("initials come from a name or the local part of an email", () => {
  assert.equal(initials("reiss@skoxsoftware.com"), "RE");
  assert.equal(initials("josh.fox@x.com"), "JF");
  assert.equal(initials("Reiss Smith"), "RS");
  assert.equal(initials(null), "");
});
