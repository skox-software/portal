import { test } from "node:test";
import assert from "node:assert/strict";
import { FLOOR_APPS, floorBatch, hoursSaved, statsFor } from "./floor.ts";

const app = FLOOR_APPS[0];
const now = new Date("2026-11-09T17:00:00Z");
// Event times must not be in the future, so the sample batch uses a real "now".
const nowReal = new Date();
const at = (h: number) => new Date(now.getTime() - h * 3_600_000);
const job = (h: number, ok = true, extra: Partial<{ seconds: number; user: string; detail: unknown }> = {}) =>
  ({ kind: "job", ok, at: at(h), seconds: extra.seconds ?? 40, user: extra.user ?? null, detail: extra.detail ?? null });

test("hours saved needs both measured times", () => {
  assert.equal(hoursSaved({ baselineMinutes: null, withDeskMinutes: 5 }, 100), null);
  assert.equal(hoursSaved({ baselineMinutes: 45, withDeskMinutes: null }, 100), null);
  assert.equal(hoursSaved({ baselineMinutes: 45, withDeskMinutes: 5 }, 30), 20);
});

test("stats count finished jobs, failures, users and trouble counties", () => {
  const s = statsFor(app, [
    job(0.1, true, { user: "MG", detail: { county: "Orange", failed: 2 } }),
    job(2, true, { seconds: 60, user: "MG" }),
    job(30, false, { user: "AB", detail: { county: "Polk", failed: 3 } }),
    job(24 * 10),
    { kind: "selftest", ok: false, at: at(10), seconds: null, user: null, detail: { failedCounties: ["Polk"] } },
  ], now, 120);
  assert.equal(s.week, 2);
  assert.equal(s.month, 3);
  assert.equal(s.failedMonth, 1);
  assert.equal(s.total, 120);
  assert.equal(s.activeNow, true);
  assert.deepEqual(s.users.sort(), ["AB", "MG"]);
  assert.deepEqual(s.selftest, { at: at(10).toISOString(), ok: false, failed: ["Polk"] });
  assert.deepEqual(s.troubleCounties.map((c) => c.county), ["Polk", "Orange"]);
  assert.equal(s.spark.length, 14);
  assert.equal(s.hoursSavedMonth, null);
});

test("events refuse anything that could carry client data", () => {
  const ok = { app: "job-paperwork", events: [{ id: "r1", at: nowReal.toISOString(), kind: "job", ok: true, seconds: 41, user: "MG", detail: { county: "Seminole", found: 6 } }] };
  assert.ok(floorBatch.safeParse(ok).success);
  const withAddress = structuredClone(ok) as { events: { detail: Record<string, unknown> }[] };
  withAddress.events[0].detail.address = "1723 Pine Creek Ct";
  assert.ok(!floorBatch.safeParse(withAddress).success);
  const withEmail = structuredClone(ok) as { events: { user: string }[] };
  withEmail.events[0].user = "pat@x.com";
  assert.ok(!floorBatch.safeParse(withEmail).success);
  assert.ok(!floorBatch.safeParse({ ...ok, app: "unknown" }).success);
  const emailId = structuredClone(ok) as { events: { id: string }[] };
  emailId.events[0].id = "2026-11-09T14:00Z-a@b.com";
  assert.ok(!floorBatch.safeParse(emailId).success);
  const future = structuredClone(ok) as { events: { at: string }[] };
  future.events[0].at = new Date(Date.now() + 3_600_000).toISOString();
  assert.ok(!floorBatch.safeParse(future).success);
});

test("website checks give live/down and uptime", () => {
  // No website is watched today; the check still works for one that is.
  const site = { ...FLOOR_APPS[0], key: "example-site", kind: "website" as const, siteUrl: "https://example.com" };
  const hb = (h: number, ok: boolean) => ({ kind: "heartbeat", ok, at: at(h), seconds: null, user: null, detail: { status: ok ? 200 : 503, ms: 140 } });
  const s = statsFor(site, [hb(0.1, true), hb(5, false), hb(10, true), hb(20, true)], now, 0);
  assert.deepEqual(s.site && { up: s.site.up, status: s.site.status, uptime: s.site.uptime, checks: s.site.checks }, { up: true, status: 200, uptime: 75, checks: 4 });
  assert.equal(statsFor(site, [], now, 0).site, null);
});
