import { test } from "node:test";
import assert from "node:assert/strict";
import { deskIssues, headline } from "./command.ts";
import { FLOOR_APPS, statsFor } from "./floor.ts";

const app = FLOOR_APPS[0];
const tue = new Date("2026-11-10T15:00:00Z");
const job = (h: number, ok = true) => ({ kind: "job", ok, at: new Date(tue.getTime() - h * 3_600_000), seconds: 40, user: "MG", detail: { result: ok ? "done" : "error" } });

test("a failed self-test makes a desk down, naming the counties", () => {
  const stats = statsFor(app, [job(1), { kind: "selftest", ok: false, at: new Date(tue.getTime() - 5 * 3_600_000), seconds: null, user: null, detail: { failedCounties: ["polk"] } }], tue, 1);
  assert.deepEqual(deskIssues([{ app, stats, reporting: true }], tue).map((i) => [i.level, i.why]), [["down", "Morning self-test failed: Polk"]]);
});

test("quiet on a workday, or failing often, needs a look; healthy is silent", () => {
  const quiet = statsFor(app, [job(60)], tue, 1);
  assert.equal(deskIssues([{ app, stats: quiet, reporting: true }], tue)[0].why, "No jobs in 3 days");
  const flaky = statsFor(app, [...Array.from({ length: 8 }, (_, i) => job(i + 1)), job(10, false), job(11, false)], tue, 10);
  assert.match(deskIssues([{ app, stats: flaky, reporting: true }], tue)[0].why, /2 of 10 jobs failed/);
  const fine = statsFor(app, Array.from({ length: 12 }, (_, i) => job(i + 1)), tue, 12);
  assert.deepEqual(deskIssues([{ app, stats: fine, reporting: true }], tue), []);
});

test("the headline says only what's true", () => {
  assert.deepEqual(headline("Josh", 8, 2, []), { greeting: "Good morning, Josh.", rest: ["2 decisions are waiting."] });
  assert.deepEqual(headline("Josh", 20, 0, []).rest, ["Nothing needs you right now."]);
  assert.deepEqual(headline("Josh", 14, 1, [{ key: "a", name: "", client: "", level: "down", why: "", lastAt: null }]).rest, ["1 decision is waiting.", "1 desk is down."]);
});
