import assert from "node:assert/strict";
import { test } from "node:test";
import { companyFromEmail, lines, questionsFor } from "./onboarding-content.ts";
import { canSkip, isComplete, neighbours, nextStep, progress, shouldRemind, stepsFor } from "./onboarding-flow.ts";

const withAgreement = stepsFor({ hasAgreement: true });
const without = stepsFor({ hasAgreement: false });

test("the agreement step only appears when there's something to sign", () => {
  assert.ok(withAgreement.some((s) => s.key === "agreement"));
  assert.ok(!without.some((s) => s.key === "agreement"));
});

test("progress counts done and skipped, and minutes left shrink", () => {
  const p0 = progress({}, without);
  const p1 = progress({ welcome: "done", team: "skipped" }, without);
  assert.equal(p0.percent, 0);
  assert.equal(p1.finished, 2);
  assert.ok(p1.minutesLeft < p0.minutesLeft);
});

test("next step is the first untouched one; null at the end", () => {
  assert.equal(nextStep({}, without), "welcome");
  assert.equal(nextStep({ welcome: "done", you: "done" }, without), "team");
  const all = Object.fromEntries(without.map((s) => [s.key, "done" as const]));
  assert.equal(nextStep(all, without), null);
});

test("required steps can't be skipped and must be done to complete", () => {
  assert.equal(canSkip("project"), false);
  assert.equal(canSkip("brand"), true);
  const skippedEverythingOptional = { welcome: "done", you: "done", project: "done", team: "skipped", brand: "skipped", access: "skipped", kickoff: "skipped" } as const;
  assert.equal(isComplete(skippedEverythingOptional, without), true);
  assert.equal(isComplete({ ...skippedEverythingOptional, project: "skipped" }, without), false);
});

test("the agreement comes straight after the welcome, before the long questions", () => {
  assert.deepEqual(withAgreement.slice(0, 3).map((s) => s.key), ["welcome", "agreement", "you"]);
});

test("neighbours give back/next navigation", () => {
  assert.deepEqual(neighbours("welcome", without), { prev: null, next: "you" });
  assert.deepEqual(neighbours("welcome", withAgreement), { prev: null, next: "agreement" });
  assert.equal(neighbours("kickoff", without).next, null);
});

test("reminders: two idle days, three days apart, never more than three", () => {
  const now = new Date("2026-09-20T12:00:00Z");
  const base = { status: "in_progress", createdAt: new Date("2026-09-10T00:00:00Z"), lastRemindedAt: null, remindersSent: 0 };
  assert.equal(shouldRemind({ ...base, lastActivityAt: new Date("2026-09-19T12:00:00Z") }, now), false, "active yesterday");
  assert.equal(shouldRemind({ ...base, lastActivityAt: new Date("2026-09-17T12:00:00Z") }, now), true);
  assert.equal(shouldRemind({ ...base, lastActivityAt: null, lastRemindedAt: new Date("2026-09-19T00:00:00Z") }, now), false, "reminded recently");
  assert.equal(shouldRemind({ ...base, lastActivityAt: null, remindersSent: 3 }, now), false);
  assert.equal(shouldRemind({ ...base, status: "completed", lastActivityAt: null }, now), false);
});

test("questions are tailored by project type and always include the core brief", () => {
  const dash = questionsFor("dashboard").map((q) => q.id);
  const site = questionsFor("website").map((q) => q.id);
  assert.ok(dash.includes("goal") && dash.includes("metrics"));
  assert.ok(site.includes("pages") && !site.includes("metrics"));
  assert.ok(questionsFor("unknown-kind").some((q) => q.id === "describe"));
});

test("placeholder company names come from business domains only", () => {
  assert.equal(companyFromEmail("jane@harbor-dental.com"), "Harbor Dental");
  assert.equal(companyFromEmail("jane@gmail.com"), null);
  assert.deepEqual(lines("a\n\n b \n"), ["a", "b"]);
});
