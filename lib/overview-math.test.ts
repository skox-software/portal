import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildQueue,
  daysLate,
  followUpTier,
  goalPace,
  lateLabel,
  openCommissionFlags,
  parseWho,
  rankQueue,
  visibleTo,
  weeklyActivity,
  withinDays,
  type QueueItem,
} from "./overview-math.ts";

const item = (key: string, tier: QueueItem["tier"], owner: string | null, at?: string): QueueItem => ({ key, tier, owner, at, source: "deal", text: key, href: "/" });

test("the queue ranks by tier, then oldest first, undated last", () => {
  const ranked = rankQueue([
    item("week-old", "week", null, "2026-10-01"),
    item("today-undated", "today", null),
    item("now-new", "now", null, "2026-10-18"),
    item("today-old", "today", null, "2026-10-10"),
    item("now-old", "now", null, "2026-10-02"),
  ]);
  assert.deepEqual(ranked.map((i) => i.key), ["now-old", "now-new", "today-old", "today-undated", "week-old"]);
});

test("Mine keeps my items and the team's, and hides someone else's", () => {
  const me = "Josh@skox.com";
  assert.equal(visibleTo({ owner: "josh@skox.com" }, "me", me), true);
  assert.equal(visibleTo({ owner: null }, "me", me), true);
  assert.equal(visibleTo({ owner: "reiss@skox.com" }, "me", me), false);
  assert.equal(visibleTo({ owner: "reiss@skox.com" }, "all", me), true);
});

test("buildQueue counts what the rest of the team has", () => {
  const items = [item("a", "now", "josh@x.com"), item("b", "now", "reiss@x.com"), item("c", "today", null)];
  const mine = buildQueue(items, "me", "josh@x.com");
  assert.deepEqual(mine.items.map((i) => i.key), ["a", "c"]);
  assert.equal(mine.othersCount, 1);
  assert.equal(mine.teamCount, 3);
  assert.equal(buildQueue(items, "all", "josh@x.com").items.length, 3);
});

test("who defaults to me", () => {
  assert.equal(parseWho(undefined), "me");
  assert.equal(parseWho("all"), "all");
  assert.equal(parseWho("nonsense"), "me");
});

test("follow-ups: overdue is Now, due today is Today, with a plain label", () => {
  assert.equal(followUpTier("2026-10-17", "2026-10-19"), "now");
  assert.equal(followUpTier("2026-10-19", "2026-10-19"), "today");
  assert.equal(daysLate("2026-10-16", "2026-10-19"), 3);
  assert.equal(daysLate("2026-10-20", "2026-10-19"), 0);
  assert.equal(lateLabel("2026-10-19", "2026-10-19"), "Due today");
  assert.equal(lateLabel("2026-10-18", "2026-10-19"), "1 day overdue");
  assert.equal(lateLabel("2026-09-30", "2026-10-19"), "19 days overdue");
});

test("withinDays covers today through the next n-1 days", () => {
  assert.equal(withinDays("2026-10-19", "2026-10-19", 7), true);
  assert.equal(withinDays("2026-10-25", "2026-10-19", 7), true);
  assert.equal(withinDays("2026-10-26", "2026-10-19", 7), false);
  assert.equal(withinDays("2026-10-18", "2026-10-19", 7), false);
});

test("weekly activity pivots counts per person and drops system actors", () => {
  const rows = weeklyActivity([
    { verb: "deal.call_logged", actor: "reiss@x.com", n: 12 },
    { verb: "deal.email_sent", actor: "reiss@x.com", n: 3 },
    { verb: "deal.created", actor: "josh@x.com", n: 5 },
    { verb: "deal.won", actor: "josh@x.com", n: 1 },
    { verb: "deal.created", actor: null, n: 40 },
    { verb: "deal.updated", actor: "josh@x.com", n: 9 },
  ]);
  assert.deepEqual(rows, [
    { person: "josh@x.com", calls: 0, emails: 0, created: 5, won: 1, total: 6 },
    { person: "reiss@x.com", calls: 12, emails: 3, created: 0, won: 0, total: 15 },
  ]);
});

test("goal pace: projection, share of goal and whether we're on track", () => {
  assert.equal(goalPace(5_000_00, null, "2026-07-02"), null);
  // 2026-07-02 is day 183 of 365.
  const pace = goalPace(60_000_00, 100_000_00, "2026-07-02")!;
  assert.equal(pace.percentOfGoal, 60);
  assert.equal(pace.onTrack, true);
  assert.equal(pace.projectedCents, Math.round((60_000_00 / 183) * 365));
  assert.equal(goalPace(10_000_00, 100_000_00, "2026-07-02")!.onTrack, false);
});

test("commission flags close once the ledger has a later entry for the invoice", () => {
  const flags = [
    { invoiceId: "i1", number: "SK-1", reason: "no profile", at: "2026-10-10T10:00:00Z" },
    { invoiceId: "i1", number: "SK-1", reason: "no profile again", at: "2026-10-12T10:00:00Z" },
    { invoiceId: "i2", number: "SK-2", reason: "two owners", at: "2026-10-11T10:00:00Z" },
    { invoiceId: "i3", number: "SK-3", reason: "paused", at: "2026-10-11T10:00:00Z" },
  ];
  const ledger = new Map([
    ["i1", "2026-10-11T00:00:00Z"], // before the latest flag: still open
    ["i2", "2026-10-15T00:00:00Z"], // fixed
  ]);
  const open = openCommissionFlags(flags, ledger);
  assert.deepEqual(open.map((f) => [f.invoiceId, f.reason]), [
    ["i1", "no profile again"],
    ["i3", "paused"],
  ]);
});
