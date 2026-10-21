import assert from "node:assert/strict";
import { test } from "node:test";
import {
  allowedColumns,
  boardTotals,
  canDemote,
  closeReasonLabel,
  crossesTracks,
  demotedStage,
  previewInFlight,
  promotionTarget,
  readTrack,
  retiredEmailedStage,
  statusAfterDecision,
  callQueue,
  buildBoard,
  cardMatches,
  columnForProject,
  dealStageForColumn,
  initials,
  isStalled,
  migratedStage,
  nextOutreach,
  trackOf,
  projectStatusForColumn,
  queueable,
  searchText,
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
  stage: "outreach_1",
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
  assert.equal(projectStatusForColumn("outreach_1"), null);
});

test("a deal can't be dragged into build without becoming a project", () => {
  assert.equal(dealStageForColumn("in_build"), null);
  assert.equal(dealStageForColumn("shipped"), null);
  assert.equal(dealStageForColumn("proposal_sent"), "proposal_sent");
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
  const leads = columns.find((c) => c.key === "outreach_1")!.cards;
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
  // Real opportunities stall after a week; cold leads after 10 days.
  assert.equal(isStalled("meeting", daysAgo(8), now), true);
  assert.equal(isStalled("outreach_2", daysAgo(8), now), false);
});

test("initials come from a name or the local part of an email", () => {
  assert.equal(initials("reiss@skoxsoftware.com"), "RE");
  assert.equal(initials("josh.fox@x.com"), "JF");
  assert.equal(initials("Reiss Smith"), "RS");
  assert.equal(initials(null), "");
});

test("search matches every word anywhere on the card; owner narrows to one person or nobody", () => {
  const card = { search: searchText(["Brinkerhoff Property Management", "Eric Brinkerhoff", "(386) 258-3802", "Daytona Beach, FL", null]), ownerEmail: "reiss@skoxsoftware.com" };
  assert.equal(cardMatches(card, { q: "", owner: "" }), true);
  assert.equal(cardMatches(card, { q: "daytona eric", owner: "" }), true);
  assert.equal(cardMatches(card, { q: "258-3802", owner: "" }), true);
  assert.equal(cardMatches(card, { q: "tampa", owner: "" }), false);
  assert.equal(cardMatches(card, { q: "", owner: "reiss@skoxsoftware.com" }), true);
  assert.equal(cardMatches(card, { q: "", owner: "founders@skoxsoftware.com" }), false);
  assert.equal(cardMatches(card, { q: "", owner: "none" }), false);
  assert.equal(cardMatches({ ...card, ownerEmail: null }, { q: "", owner: "none" }), true);
});

test("the call queue: open leads with a working number, business hours there, best first", () => {
  const today = "2026-10-16";
  const open = { stage: "outreach_1" as const, phone: "(303) 555-0100", badNumber: false, nextStepOn: null };
  assert.equal(queueable(open, today), true);
  assert.equal(queueable({ ...open, badNumber: true }, today), false);
  assert.equal(queueable({ ...open, phone: null }, today), false);
  assert.equal(queueable({ ...open, stage: "won" }, today), false);
  assert.equal(queueable({ ...open, nextStepOn: "2026-10-20" }, today), false);
  assert.equal(queueable({ ...open, nextStepOn: "2026-10-15" }, today), true);

  // Friday 11 am Eastern: 8 am on the West Coast is too early.
  const now = new Date("2026-10-16T15:00:00Z");
  const cards = [
    { id: "pt", queueable: true, zone: "America/Los_Angeles", priority: 0 },
    { id: "ct-late", queueable: true, zone: "America/Chicago", priority: 40 },
    { id: "et-first", queueable: true, zone: "America/New_York", priority: 0 },
    { id: "parked", queueable: false, zone: "America/New_York", priority: -200 },
    { id: "nowhere", queueable: true, zone: null, priority: 0 },
  ];
  assert.deepEqual(callQueue(cards, now).map((c) => c.id), ["et-first", "ct-late"]);
});

test("two tracks: outreach attempts, then the Pipeline", () => {
  assert.equal(trackOf("outreach_1"), "outreach");
  assert.equal(trackOf("outreach_closed"), "outreach");
  assert.equal(trackOf("replied"), "active");
  assert.equal(trackOf("lost"), "active");
  assert.equal(nextOutreach("outreach_1"), "outreach_2");
  assert.equal(nextOutreach("outreach_3"), "outreach_4");
  assert.equal(nextOutreach("outreach_4"), null);
  assert.equal(nextOutreach("replied"), null);
  // Old links said track=deals.
  assert.equal(readTrack("deals"), "active");
  assert.equal(readTrack("outreach"), "outreach");
  assert.equal(readTrack("anything"), null);
});

test("promotion: a signal moves an Outreach lead to Interested, a booked call to Scope call", () => {
  for (const signal of ["replied", "interested", "preview", "inbound", "direct"] as const) {
    assert.equal(promotionTarget("outreach_2", signal), "replied", signal);
  }
  assert.equal(promotionTarget("outreach_1", "meeting"), "meeting");
  assert.equal(promotionTarget("outreach_closed", "replied"), "replied");
  // In the Pipeline, only a booked call moves Interested on.
  assert.equal(promotionTarget("replied", "meeting"), "meeting");
  assert.equal(promotionTarget("replied", "replied"), null);
  assert.equal(promotionTarget("proposal_sent", "meeting"), null);
  assert.equal(promotionTarget("won", "replied"), null);
  assert.equal(promotionTarget("lost", "interested"), null);
});

test("crossing tracks is only by promotion or demotion; bulk and drag stay inside", () => {
  assert.ok(crossesTracks("outreach_4", "replied"));
  assert.ok(crossesTracks("proposal_sent", "outreach_1"));
  assert.ok(!crossesTracks("outreach_1", "outreach_closed"));
  assert.ok(!crossesTracks("replied", "lost"));
  assert.deepEqual(allowedColumns("deal", "outreach_2"), ["outreach_1", "outreach_2", "outreach_3", "outreach_4", "outreach_closed"]);
  assert.deepEqual(allowedColumns("deal", "meeting"), ["replied", "meeting", "proposal_sent", "won", "lost"]);
  assert.deepEqual(allowedColumns("referral", "outreach_1"), allowedColumns("deal", "outreach_1"));
  assert.deepEqual(allowedColumns("project", "won"), ["won", "in_build", "shipped"]);
});

test("demotion lands on the attempt after the ones made, never past 4; only open deals go back", () => {
  assert.equal(demotedStage(0), "outreach_1");
  assert.equal(demotedStage(2), "outreach_3");
  assert.equal(demotedStage(9), "outreach_4");
  assert.ok(canDemote("replied") && canDemote("meeting") && canDemote("proposal_sent"));
  assert.ok(!canDemote("won") && !canDemote("lost") && !canDemote("outreach_2"));
});

test("close reasons and previews read in plain words", () => {
  assert.equal(closeReasonLabel("not_interested", "retiring"), "Not interested · Retiring");
  assert.equal(closeReasonLabel("no_answer", null), "No answer after 4 tries");
  assert.equal(closeReasonLabel(null, null), null);
  assert.ok(previewInFlight("requested") && previewInFlight("opened"));
  assert.ok(!previewInFlight("none") && !previewInFlight("archived"));
  assert.equal(statusAfterDecision("go"), "building");
  assert.equal(statusAfterDecision("go_with_changes"), "building");
  assert.equal(statusAfterDecision("no_go"), "archived");
});

test("retiring Emailed (migration 0022): only a reply or a meeting keeps a deal in the Pipeline", () => {
  const base = { meetingAt: null, replied: false, attempts: 0, lastOutcome: null };
  assert.equal(retiredEmailedStage({ ...base, meetingAt: now, replied: true }), "meeting");
  assert.equal(retiredEmailedStage({ ...base, replied: true, attempts: 3 }), "replied");
  // Sent but never answered: back to the attempt its calls and emails reached.
  assert.equal(retiredEmailedStage({ ...base, attempts: 1 }), "outreach_2");
  assert.equal(retiredEmailedStage({ ...base, attempts: 2, lastOutcome: "voicemail" }), "outreach_3");
  assert.equal(retiredEmailedStage({ ...base, attempts: 6 }), "outreach_4");
  // Moved to Emailed by hand with nothing logged.
  assert.equal(retiredEmailedStage(base), "outreach_1");
  assert.equal(retiredEmailedStage({ ...base, attempts: 2, lastOutcome: "not_interested" }), "outreach_closed");
});

test("old stages map by what already happened (matches migration 0021)", () => {
  const base = { stage: "lead", meetingAt: null, emailed: false, calls: 0, lastOutcome: null };
  assert.equal(migratedStage(base), "outreach_1");
  assert.equal(migratedStage({ ...base, stage: "initial_outreach", calls: 1, lastOutcome: "voicemail" }), "outreach_2");
  assert.equal(migratedStage({ ...base, calls: 7, lastOutcome: "no_answer" }), "outreach_4");
  assert.equal(migratedStage({ ...base, calls: 2, lastOutcome: "not_interested" }), "outreach_closed");
  assert.equal(migratedStage({ ...base, calls: 2, emailed: true }), "emailed");
  assert.equal(migratedStage({ ...base, emailed: true, meetingAt: now }), "meeting");
  assert.equal(migratedStage({ ...base, stage: "negotiation" }), "proposal_sent");
  assert.equal(migratedStage({ ...base, stage: "won", emailed: true }), "won");
  assert.equal(migratedStage({ ...base, stage: "lost", calls: 3 }), "lost");
});
