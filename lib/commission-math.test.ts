import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clawbackCents,
  commissionCents,
  formatRate,
  monthPeriod,
  parseRatePercent,
  previousMonth,
  statementLines,
} from "./commission-math.ts";

test("commission is rate times cash, rounded half up to the cent", () => {
  assert.equal(commissionCents(500_000, 1500), 75_000);
  assert.equal(commissionCents(25_000, 1000), 2_500);
  assert.equal(commissionCents(1_001, 1250), 125); // 125.125
  assert.equal(commissionCents(1_004, 1250), 126); // 125.5
});

test("a refund claws back the same rate, as a negative", () => {
  assert.equal(clawbackCents(250_000, 1500), -37_500);
  assert.equal(clawbackCents(0, 1500), -0);
});

test("rates read and print as percentages", () => {
  assert.equal(formatRate(1500), "15%");
  assert.equal(formatRate(1250), "12.5%");
  assert.equal(parseRatePercent("12.5"), 1250);
  assert.equal(parseRatePercent("15%"), 1500);
  assert.equal(parseRatePercent("x"), null);
});

test("statement periods are whole calendar months", () => {
  assert.deepEqual(previousMonth("2026-11-01"), { start: "2026-10-01", end: "2026-10-31" });
  assert.deepEqual(previousMonth("2027-01-01"), { start: "2026-12-01", end: "2026-12-31" });
  assert.deepEqual(monthPeriod(2028, 2), { start: "2028-02-01", end: "2028-02-29" });
});

test("a statement takes everything pending through the period end", () => {
  const pending = [
    { amountCents: 75_000, earnedOn: "2026-10-03" },
    { amountCents: 3_750, earnedOn: "2026-09-12" },
    { amountCents: 3_750, earnedOn: "2026-11-02" },
  ];
  const s = statementLines(pending, "2026-10-31");
  assert.equal(s.lines.length, 2);
  assert.equal(s.total, 78_750);
});

test("a month where refunds outweigh payments carries forward", () => {
  const s = statementLines(
    [
      { amountCents: 3_750, earnedOn: "2026-10-03" },
      { amountCents: -75_000, earnedOn: "2026-10-20" },
    ],
    "2026-10-31",
  );
  assert.deepEqual(s, { lines: [], total: 0 });
});

// Business allocation is independent of Stripe balances and operating expenses.
import * as math from "./commission-math.ts";
const reiss = { id: "reiss", role: "staff_owner" };
const josh = { id: "josh", role: "staff_owner" };
const rep = { id: "rep", role: "rep" };
test("a founder-owned $625 invoice credits its owner the full $625", () => {
  assert.equal(typeof math.dealAllocations, "function");
  assert.deepEqual(math.dealAllocations(62500, reiss, [reiss, josh]), [{ id: "reiss", rateBps: 10000, amountCents: 62500 }]);
  assert.deepEqual(math.dealAllocations(62500, josh, [reiss, josh]), [{ id: "josh", rateBps: 10000, amountCents: 62500 }]);
});
test("rep-owned cash splits 20% to the rep and 40% to each founder", () => {
  assert.equal(typeof math.dealAllocations, "function");
  assert.deepEqual(math.dealAllocations(125000, rep, [reiss, josh]), [
    { id: "rep", rateBps: 2000, amountCents: 25000 },
    { id: "josh", rateBps: 4000, amountCents: 50000 },
    { id: "reiss", rateBps: 4000, amountCents: 50000 },
  ]);
});
test("odd cents are conserved and founder ordering cannot change the split", () => {
  assert.equal(typeof math.dealAllocations, "function");
  for (let cents = 1; cents < 100; cents++) {
    const a = math.dealAllocations(cents, rep, [reiss, josh]);
    assert.equal(a.reduce((sum, x) => sum + x.amountCents, 0), cents);
    assert.deepEqual(a, math.dealAllocations(cents, rep, [josh, reiss]));
  }
});
test("rep allocations fail closed if both founders are not configured", () => {
  assert.equal(typeof math.dealAllocations, "function");
  assert.throws(() => math.dealAllocations(100, rep, [reiss]), /two founders/);
  assert.throws(() => math.dealAllocations(100, rep, [reiss, reiss]), /two founders/);
});

test("partial refunds reverse every allocation and final refund clears odd cents", () => {
  assert.equal(typeof math.refundAllocations, "function");
  const shares = math.dealAllocations(101, rep, [reiss, josh]);
  const first = math.refundAllocations(101, shares, 0, 33);
  const last = math.refundAllocations(101, shares, 33, 68);
  assert.equal(first.reduce((sum, x) => sum + x.amountCents, 0), -33);
  shares.forEach((share, i) => assert.equal(first[i].amountCents + last[i].amountCents, -share.amountCents));
});

const person = (id: string, role: string, status = "active") => ({ id, role, email: `${id}@skox.test`, status, name: id[0].toUpperCase() + id.slice(1) });
const team = [person("reiss", "staff_owner"), person("josh", "staff_owner"), person("rep", "rep")];

test("deal shares: founder close is 100%, rep deal is 20/40/40", () => {
  assert.deepEqual(math.planDealShares({ baseCents: 62500, projectRepId: "reiss", deals: [], people: team }), {
    allocations: [{ id: "reiss", rateBps: 10000, amountCents: 62500 }], notes: [],
  });
  const rep = math.planDealShares({ baseCents: 125000, projectRepId: null, deals: [{ repId: "rep", ownerEmail: null }], people: team });
  assert.ok(rep && "allocations" in rep);
  assert.deepEqual(rep.allocations.map(a => [a.id, a.amountCents]), [["rep", 25000], ["josh", 50000], ["reiss", 50000]]);
  // A founder deal owner is the fallback credit.
  const owned = math.planDealShares({ baseCents: 100, projectRepId: null, deals: [{ repId: null, ownerEmail: "JOSH@skox.test" }], people: team });
  assert.ok(owned && "allocations" in owned);
  assert.deepEqual(owned.allocations, [{ id: "josh", rateBps: 10000, amountCents: 100 }]);
});

test("deal shares never throw: broken setup asks for attention", () => {
  const attention = (r: ReturnType<typeof math.planDealShares>) => assert.ok(r && "attention" in r, JSON.stringify(r));
  attention(math.planDealShares({ baseCents: 100, projectRepId: "ghost", deals: [], people: team }));
  attention(math.planDealShares({ baseCents: 100, projectRepId: null, deals: [{ repId: "rep", ownerEmail: null }, { repId: null, ownerEmail: "reiss@skox.test" }], people: team }));
  attention(math.planDealShares({ baseCents: 100, projectRepId: "rep", deals: [], people: [team[0], team[2]] }));
  attention(math.planDealShares({ baseCents: 100, projectRepId: "rep", deals: [], people: [...team, person("third", "staff")] }));
  attention(math.planDealShares({ baseCents: 100, projectRepId: "client", deals: [], people: [...team, person("client", "client_member")] }));
  // Nobody credited: nothing to record.
  assert.equal(math.planDealShares({ baseCents: 100, projectRepId: null, deals: [], people: team }), null);
});

test("founders are staff with an active profile; a paused third staffer doesn't count", () => {
  const r = math.planDealShares({ baseCents: 1000, projectRepId: "rep", deals: [], people: [...team, person("old", "staff", "paused")] });
  assert.ok(r && "allocations" in r);
  assert.deepEqual(r.allocations.map(a => a.id), ["rep", "josh", "reiss"]);
});

test("a paused rep's 20% is left unallocated; the founders keep 40/40", () => {
  const r = math.planDealShares({ baseCents: 125000, projectRepId: "rep", deals: [], people: [team[0], team[1], person("rep", "rep", "paused")] });
  assert.ok(r && "allocations" in r);
  assert.deepEqual(r.allocations, [{ id: "josh", rateBps: 4000, amountCents: 50000 }, { id: "reiss", rateBps: 4000, amountCents: 50000 }]);
  assert.match(r.notes[0], /Rep is paused.*20%.*25000/);
});

test("a paused founder's line is skipped and noted", () => {
  const people = [person("reiss", "staff_owner", "paused"), team[1], team[2]];
  const rep = math.planDealShares({ baseCents: 125000, projectRepId: "rep", deals: [], people });
  assert.ok(rep && "allocations" in rep);
  assert.deepEqual(rep.allocations.map(a => [a.id, a.amountCents]), [["rep", 25000], ["josh", 50000]]);
  assert.match(rep.notes[0], /Reiss is paused/);
  const own = math.planDealShares({ baseCents: 62500, projectRepId: "reiss", deals: [], people });
  assert.ok(own && "allocations" in own);
  assert.deepEqual(own.allocations, []);
  assert.equal(own.notes.length, 1);
});

test("base 7¢, already 3¢, refund 1¢: no positive or 0¢ clawback lines", () => {
  const shares = math.dealAllocations(7, rep, [reiss, josh]);
  // The raw cumulative difference flips the rep's line positive...
  assert.deepEqual(math.refundAllocations(7, shares, 3, 1).map(x => x.amountCents), [1, -1, -1]);
  // ...so it carries into the next line.
  assert.deepEqual(math.carryPositive([1, -1, -1]), [0, 0, -1]);
  const first = math.refundClawbackLines(7, shares, [0, 0, 0], 3);
  assert.deepEqual(first.map(x => [x.id, x.amountCents]), [["rep", -1], ["josh", -1], ["reiss", -1]]);
  const second = math.refundClawbackLines(7, shares, [1, 1, 1], 4);
  assert.deepEqual(second.map(x => [x.id, x.amountCents, x.index]), [["reiss", -1, 2]]);
});

test("ledger-based clawbacks still clear every cent on a full refund", () => {
  for (const base of [7, 101, 125000, 99_999]) {
    const shares = math.dealAllocations(base, rep, [reiss, josh]);
    const clawed = shares.map(() => 0);
    let refunded = 0;
    for (const step of [3, 1, 5, 2, base]) {
      const amount = Math.min(step, base - refunded);
      if (amount <= 0) break;
      refunded += amount;
      const lines = math.refundClawbackLines(base, shares, clawed, refunded);
      for (const line of lines) {
        assert.ok(line.amountCents < 0, `line ${JSON.stringify(line)} must be negative`);
        clawed[line.index] -= line.amountCents;
      }
      assert.equal(clawed.reduce((s, x) => s + x, 0), -math.refundAllocations(base, shares, 0, refunded).reduce((s, x) => s + x.amountCents, 0));
    }
    shares.forEach((share, i) => assert.equal(clawed[i], share.amountCents));
  }
});

test("a founder closing a lead the other founder sourced keeps 60%; the sourcer gets 40%", () => {
  const people = team.map((p) => ({ ...p, userId: `user-${p.id}` }));
  const plan = (credited: string, createdBy: string | null, base = 100_000) =>
    math.planDealShares({ baseCents: base, projectRepId: credited, deals: [{ repId: null, ownerEmail: null, createdBy }], people, defaultSourceEmail: "josh@skox.test" });
  const lines = (r: ReturnType<typeof math.planDealShares>) => {
    assert.ok(r && "allocations" in r, JSON.stringify(r));
    return r.allocations.map((a) => [a.id, a.rateBps, a.amountCents]);
  };
  // Reiss closes a lead Josh added: 60 / 40.
  assert.deepEqual(lines(plan("reiss", "user-josh")), [["reiss", 6000, 60_000], ["josh", 4000, 40_000]]);
  // Reiss closes a lead he added himself: all his.
  assert.deepEqual(lines(plan("reiss", "user-reiss")), [["reiss", 10000, 100_000]]);
  // Leads nobody added by hand (website, imports) are Josh's.
  assert.deepEqual(lines(plan("reiss", "website")), [["reiss", 6000, 60_000], ["josh", 4000, 40_000]]);
  assert.deepEqual(lines(plan("josh", "website")), [["josh", 10000, 100_000]]);
  // And the other way round.
  assert.deepEqual(lines(plan("josh", "user-reiss")), [["josh", 6000, 60_000], ["reiss", 4000, 40_000]]);
  // Odd cents: the sourcer's 40% rounds half up, the closer gets exactly the rest.
  const odd = lines(plan("reiss", "user-josh", 100_007));
  assert.deepEqual(odd, [["reiss", 6000, 60_004], ["josh", 4000, 40_003]]);
  // Rep deals are unchanged by who added the lead.
  const rep = math.planDealShares({ baseCents: 125_000, projectRepId: "rep", deals: [{ repId: null, ownerEmail: null, createdBy: "user-josh" }], people, defaultSourceEmail: "josh@skox.test" });
  assert.ok(rep && "allocations" in rep);
  assert.deepEqual(rep.allocations.map((a) => a.rateBps), [2000, 4000, 4000]);
  // Two leads behind one project, added by different founders: a person decides.
  const mixed = math.planDealShares({
    baseCents: 100, projectRepId: "reiss", people, defaultSourceEmail: "josh@skox.test",
    deals: [{ repId: null, ownerEmail: null, createdBy: "user-josh" }, { repId: null, ownerEmail: null, createdBy: "user-reiss" }],
  });
  assert.ok(mixed && "attention" in mixed);
});
