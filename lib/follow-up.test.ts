import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addWorkdays,
  defaultFollowUp,
  describeFollowUp,
  followUpAfterCall,
  nextStepAfterCall,
  followUpState,
  isDue,
  remindersByPerson,
  remindIn,
  salesToday,
  stageAfterCall,
  untouchedFor,
} from "./follow-up.ts";

test("today is the Florida date, not the UTC one", () => {
  // 9pm in Florida on Oct 16 is already Oct 17 in UTC.
  assert.equal(salesToday(new Date("2026-10-17T01:00:00Z")), "2026-10-16");
  assert.equal(salesToday(new Date("2026-10-17T13:00:00Z")), "2026-10-17");
});

test("follow-ups skip the weekend", () => {
  // 2026-10-16 is a Friday.
  assert.equal(addWorkdays("2026-10-16", 1), "2026-10-19");
  assert.equal(addWorkdays("2026-10-16", 5), "2026-10-23");
  assert.equal(defaultFollowUp("voicemail", "2026-10-16"), "2026-10-20");
  assert.equal(defaultFollowUp("not_interested", "2026-10-16"), null);
});

test("a first attempt moves a lead to Initial outreach; not interested closes it", () => {
  assert.equal(stageAfterCall("lead", "no_answer"), "initial_outreach");
  assert.equal(stageAfterCall("proposal_sent", "spoke"), "proposal_sent");
  assert.equal(stageAfterCall("initial_outreach", "not_interested"), "lost");
});

test("follow-up labels and states", () => {
  const today = "2026-10-16";
  assert.equal(followUpState(null, today), "none");
  assert.equal(followUpState("2026-10-14", today), "overdue");
  assert.equal(followUpState(today, today), "today");
  assert.equal(followUpState("2026-10-19", today), "upcoming");
  assert.equal(describeFollowUp("2026-10-14", today), "Overdue 2d");
  assert.equal(describeFollowUp(today, today), "Due today");
  assert.equal(describeFollowUp("2026-10-17", today), "Tomorrow");
  assert.equal(describeFollowUp("2026-10-23", today), "Fri, Oct 23");
});

test("untouched counts from the last call, or from when it entered the stage", () => {
  const now = new Date("2026-10-16T12:00:00Z");
  const since = new Date("2026-10-01T12:00:00Z");
  assert.equal(untouchedFor(null, since, now, 7), true);
  assert.equal(untouchedFor(new Date("2026-10-14T12:00:00Z"), since, now, 7), false);
});

test("one-tap outcomes: each sets its own follow-up; dead ends set none", () => {
  // 2026-10-16 is a Friday.
  assert.equal(followUpAfterCall("no_answer", "", "2026-10-16"), "2026-10-19");
  assert.equal(followUpAfterCall("gatekeeper", "", "2026-10-16"), "2026-10-19");
  assert.equal(followUpAfterCall("spoke", "", "2026-10-16"), "2026-10-21");
  assert.equal(followUpAfterCall("spoke", "2026-11-02", "2026-10-16"), "2026-11-02");
  assert.equal(followUpAfterCall("bad_number", "2026-11-02", "2026-10-16"), null);
  assert.equal(followUpAfterCall("not_interested", "", "2026-10-16"), null);
});

test("a bad number leaves the stage alone; the gatekeeper's name goes in the next step", () => {
  assert.equal(stageAfterCall("lead", "bad_number"), "lead");
  assert.equal(stageAfterCall("lead", "gatekeeper"), "initial_outreach");
  assert.equal(nextStepAfterCall("gatekeeper", "Sarah"), "Call back; Sarah answered last time");
  assert.equal(nextStepAfterCall("spoke", ""), null);
});

test("remind me in: lands on a workday, months clamp to the month's end", () => {
  // 2026-10-16 is a Friday.
  assert.equal(remindIn("1d", "2026-10-16"), "2026-10-19");
  assert.equal(remindIn("3d", "2026-10-16"), "2026-10-19"); // Mon 19 (Sat 17+3 = Mon)
  assert.equal(remindIn("3d", "2026-10-14"), "2026-10-19"); // Wed + 3 = Sat → Mon
  assert.equal(remindIn("1w", "2026-10-16"), "2026-10-23");
  assert.equal(remindIn("2w", "2026-10-16"), "2026-10-30");
  assert.equal(remindIn("1m", "2026-01-31"), "2026-03-02"); // Feb 28 2026 is a Saturday, so Monday
  assert.equal(remindIn("3m", "2026-10-16"), "2027-01-18"); // Jan 16 2027 is a Saturday
});

test("a follow-up is due on its day and every day after", () => {
  assert.equal(isDue(null, "2026-10-16"), false);
  assert.equal(isDue("2026-10-17", "2026-10-16"), false);
  assert.equal(isDue("2026-10-16", "2026-10-16"), true);
  assert.equal(isDue("2026-10-01", "2026-10-16"), true);
});

test("reminders go to each owner; unowned or ex-team ones go to everyone", () => {
  const item = (name: string, owner: string | null) => ({ kind: "deal" as const, id: name, name, dueOn: "2026-10-16", note: null, owner, href: "/" });
  const out = remindersByPerson([item("A", "josh@x.com"), item("B", null), item("C", "gone@x.com"), item("D", "reiss@x.com")], ["Josh@x.com", "reiss@x.com"]);
  const by = Object.fromEntries(out.map(([email, list]) => [email, list.map((i) => i.name)]));
  assert.deepEqual(by["josh@x.com"], ["A", "B", "C"]);
  assert.deepEqual(by["reiss@x.com"], ["B", "C", "D"]);
});
